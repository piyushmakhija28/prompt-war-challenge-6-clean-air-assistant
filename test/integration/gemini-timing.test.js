/**
 * @fileoverview Deadlines and cancellation of GeminiPlanProvider under mocked timers:
 * per-model timeouts, the overall generation budget, stalled response bodies and supersede.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  SecureKeyStore,
  GeminiPlanProvider,
  GEMINI_MODELS_CASCADE,
  GEMINI_MODEL_TIMEOUTS,
  GENERATION_BUDGET_MS,
  MIN_ATTEMPT_MS
} from '../../src/js/gemini-service.js';
import { DEFAULT_PRESET } from '../../src/js/config.js';
import {
  FAKE_KEY, installNetworkGuard, captureConsole, createFakeFetch, settle, reply
} from './helpers/fakes.js';

const escaped = installNetworkGuard();
const CONTEXT = Object.freeze({ ...DEFAULT_PRESET, aqiSource: 'manual', lang: 'en' });
const START = Date.parse('2026-11-28T06:00:00Z');

/**
 * Builds a keyed provider that reads the mocked clock.
 *
 * @param {Object} fake - Fake transport.
 * @returns {GeminiPlanProvider}
 */
function setup(fake) {
  const keyStore = new SecureKeyStore();
  keyStore.setKey(FAKE_KEY);
  return new GeminiPlanProvider(keyStore, { now: () => Date.now(), fetchImpl: fake.fetch });
}

/**
 * Observes a promise without awaiting it.
 *
 * @param {Promise<*>} promise - Operation under test.
 * @returns {{done: boolean, value: *, error: *}} Live view of the outcome.
 */
function track(promise) {
  const outcome = { done: false, value: undefined, error: undefined };
  promise.then(
    (value) => Object.assign(outcome, { done: true, value }),
    (error) => Object.assign(outcome, { done: true, error })
  );
  return outcome;
}

/**
 * Advances mocked time and lets the resulting promise chains finish.
 *
 * @param {number} ms - Time to advance.
 * @returns {Promise<void>}
 */
async function advance(ms) {
  mock.timers.tick(ms);
  await settle();
}

describe('Gemini deadlines and cancellation', () => {
  beforeEach(() => {
    captureConsole();
    globalThis.__CLEANAIR_TELEMETRY__ = [];
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    assert.deepEqual(escaped, []);
  });

  it('aborts a silent model exactly at its own deadline and moves on', async () => {
    const fake = createFakeFetch(reply.hang(), reply.ok('second'));
    const outcome = track(setup(fake).getPlan(CONTEXT));
    await settle();

    await advance(GEMINI_MODEL_TIMEOUTS[GEMINI_MODELS_CASCADE[0]] - 1);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].init.signal.aborted, false);

    await advance(1);
    assert.equal(fake.calls[0].init.signal.aborted, true);
    assert.equal(outcome.value.model, GEMINI_MODELS_CASCADE[1]);
    assert.equal(globalThis.__CLEANAIR_TELEMETRY__.at(-1).traces[0].status, 'TIMEOUT');
  });

  it('spends at most the generation budget when every model stays silent', async () => {
    const fake = createFakeFetch().otherwise(reply.hang());
    const provider = setup(fake);
    const outcome = track(provider.getPlan(CONTEXT));
    await settle();

    await advance(15000);
    await advance(15000);
    await advance(14999);
    assert.equal(outcome.done, false);

    await advance(1);
    assert.equal(outcome.done, true);
    assert.equal(Date.now() - START, GENERATION_BUDGET_MS);
    assert.equal(fake.calls.length, 3);
    assert.ok(fake.calls.every((call) => call.init.signal.aborted));
    assert.equal(outcome.value.strategy, 'OFFLINE_FALLBACK');
    assert.match(outcome.value.warning, /TIMEOUT/);
    assert.equal(provider.circuitBreaker.failureCount, 1);
  });

  it('shortens the last attempt to the remaining budget', async () => {
    const fake = createFakeFetch(
      () => new Promise((resolve) => setTimeout(() => resolve(reply.status(503)()), 14000)),
      () => new Promise((resolve) => setTimeout(() => resolve(reply.status(503)()), 14000)),
      () => new Promise((resolve) => setTimeout(() => resolve(reply.status(503)()), 10000))
    ).otherwise(reply.hang());
    const outcome = track(setup(fake).getPlan(CONTEXT));
    await settle();

    await advance(14000);
    await advance(14000);
    await advance(10000);
    assert.equal(fake.calls.length, 4);

    await advance(6999);
    assert.equal(outcome.done, false);
    await advance(1);
    assert.equal(outcome.done, true);
    assert.equal(Date.now() - START, GENERATION_BUDGET_MS);
    assert.equal(fake.calls.length, 4);
  });

  for (const [remaining, attempts] of [[MIN_ATTEMPT_MS, 4], [MIN_ATTEMPT_MS - 1, 3]]) {
    it(`makes ${attempts} attempts when ${remaining} ms remain after the third`, async () => {
      const spent = [14000, 14000, GENERATION_BUDGET_MS - 28000 - remaining];
      const slow = spent.map((ms) => () => new Promise((resolve) => setTimeout(() => resolve(reply.status(503)()), ms)));
      const fake = createFakeFetch(...slow, reply.ok());
      const outcome = track(setup(fake).getPlan(CONTEXT));
      await settle();

      for (const ms of spent) await advance(ms);

      assert.equal(fake.calls.length, attempts);
      assert.equal(outcome.done, true);
      assert.equal(outcome.value.strategy, attempts === 4 ? 'GEMINI_3_8_FLASH' : 'OFFLINE_FALLBACK');
    });
  }

  for (const status of [200, 503]) {
    it(`applies the deadline to a stalled ${status} response body`, async () => {
      const fake = createFakeFetch(reply.stalledBody(status), reply.ok('after-stall'));
      const outcome = track(setup(fake).getPlan(CONTEXT));
      await settle();

      await advance(14999);
      assert.equal(outcome.done, false);
      await advance(1);

      assert.equal(outcome.value.model, GEMINI_MODELS_CASCADE[1]);
      assert.equal(fake.calls[0].init.signal.aborted, true);
    });
  }

  it('enforces the deadline even when the transport ignores abort', async () => {
    const fake = createFakeFetch(() => new Promise(() => {}), reply.ok('independent'));
    const outcome = track(setup(fake).getPlan(CONTEXT));
    await settle();

    await advance(15000);

    assert.equal(outcome.value.model, GEMINI_MODELS_CASCADE[1]);
  });

  const stages = [
    ['while waiting for headers', reply.hang()],
    ['while reading the body', reply.stalledBody(200)],
    ['against a transport that ignores abort', () => new Promise(() => {})]
  ];

  for (const [label, behaviour] of stages) {
    it(`rejects with AbortError when superseded ${label}`, async () => {
      const fake = createFakeFetch(behaviour);
      const provider = setup(fake);
      const controller = new AbortController();
      const outcome = track(provider.getPlan(CONTEXT, { signal: controller.signal }));
      await settle();

      controller.abort('SUPERSEDED');
      await settle();

      assert.equal(outcome.done, true);
      assert.equal(outcome.error.name, 'AbortError');
      assert.equal(fake.calls[0].init.signal.aborted, true);
      await advance(GENERATION_BUDGET_MS * 2);
      assert.equal(fake.calls.length, 1);
      assert.equal(provider.circuitBreaker.failureCount, 0);
    });
  }

  it('rejects with AbortError when superseded during a later model', async () => {
    const fake = createFakeFetch(reply.status(503), reply.hang());
    const provider = setup(fake);
    const controller = new AbortController();
    const outcome = track(provider.getPlan(CONTEXT, { signal: controller.signal }));
    await settle();

    controller.abort('SUPERSEDED');
    await settle();

    assert.equal(outcome.error.name, 'AbortError');
    assert.equal(fake.calls.length, 2);
    assert.equal(provider.circuitBreaker.failureCount, 0);
  });

  it('sends nothing when the signal was aborted before the call', async () => {
    const fake = createFakeFetch(reply.ok());
    const controller = new AbortController();
    controller.abort('SUPERSEDED');
    const outcome = track(setup(fake).getPlan(CONTEXT, { signal: controller.signal }));
    await settle();

    assert.equal(outcome.error.name, 'AbortError');
    assert.equal(fake.calls.length, 0);
  });

  it('does not let a late abort disturb a finished generation', async () => {
    const fake = createFakeFetch(reply.ok());
    const provider = setup(fake);
    const controller = new AbortController();
    const result = await provider.getPlan(CONTEXT, { signal: controller.signal });

    controller.abort('SUPERSEDED');
    await advance(GENERATION_BUDGET_MS * 2);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(fake.calls[0].init.signal.aborted, false);
  });
});
