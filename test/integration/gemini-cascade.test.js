/**
 * @fileoverview Cascade behaviour of GeminiPlanProvider against a fake transport: every row of
 * failure classification, model fallthrough, unusable payloads, hostile model text and offline.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { SecureKeyStore, GeminiPlanProvider, GEMINI_MODELS_CASCADE } from '../../src/js/gemini-service.js';
import { generateOfflineCleanAirPlan } from '../../src/js/offline-advisor.js';
import { DEFAULT_PRESET } from '../../src/js/config.js';
import {
  FAKE_KEY, installNetworkGuard, captureConsole, createClock, createFakeFetch,
  candidateBody, modelPlan, reply
} from './helpers/fakes.js';

const escaped = installNetworkGuard();
const CONTEXT = Object.freeze({ ...DEFAULT_PRESET, aqiSource: 'manual', lang: 'en' });
const ALL = GEMINI_MODELS_CASCADE.length;

/**
 * Builds a keyed provider over a scripted transport and an injected clock.
 *
 * @param {Object} fake - Fake transport.
 * @returns {{provider: GeminiPlanProvider, keyStore: SecureKeyStore, clock: Object}}
 */
function setup(fake) {
  const keyStore = new SecureKeyStore();
  keyStore.setKey(FAKE_KEY);
  const clock = createClock();
  const provider = new GeminiPlanProvider(keyStore, { now: clock.now, fetchImpl: fake.fetch });
  return { provider, keyStore, clock };
}

/**
 * Asserts that a result carries the deterministic on-device plan and no model advice.
 *
 * @param {Object} result - Provider result.
 */
function assertOfflinePlan(result) {
  assert.equal(result.advice, undefined);
  assert.equal(result.model, undefined);
  assert.deepEqual(result.plan, generateOfflineCleanAirPlan(CONTEXT));
}

describe('Gemini cascade failure classification', () => {
  beforeEach(() => {
    captureConsole();
    globalThis.__CLEANAIR_TELEMETRY__ = [];
  });

  afterEach(() => {
    mock.restoreAll();
    assert.deepEqual(escaped, []);
  });

  it('does not touch the network without a key', async () => {
    const fake = createFakeFetch();
    const { provider, keyStore } = setup(fake);
    keyStore.purge();

    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.strategy, 'OFFLINE_NO_KEY');
    assert.equal(result.warning, undefined);
    assert.equal(fake.calls.length, 0);
    assertOfflinePlan(result);
  });

  const authRows = [
    ['400 with reason API_KEY_INVALID', reply.badKey()],
    ['400 whose message names the API key', reply.body(400, { error: { message: 'API key expired. Please renew.' } })],
    ['400 FAILED_PRECONDITION', reply.body(400, { error: { status: 'FAILED_PRECONDITION', message: 'region' } })],
    ['401', reply.status(401)],
    ['403', reply.status(403)],
    ['401 with an HTML body', reply.raw(401, '<html>denied</html>')],
    ['403 with an empty body', reply.raw(403, '')]
  ];

  for (const [label, behaviour] of authRows) {
    it(`treats ${label} as a rejected key after one attempt and stops resending it`, async () => {
      const fake = createFakeFetch(behaviour);
      const { provider } = setup(fake);

      const first = await provider.getPlan(CONTEXT);
      const second = await provider.getPlan(CONTEXT);

      assert.equal(fake.calls.length, 1);
      for (const result of [first, second]) {
        assert.equal(result.strategy, 'OFFLINE_KEY_REJECTED');
        assert.match(result.warning, /rejected this API key/);
        assert.equal(result.retryAfterMs, undefined);
        assertOfflinePlan(result);
      }
      assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
      assert.equal(provider.circuitBreaker.failureCount, 0);
    });
  }

  const nextRows = [
    ['400 unrelated to the key', reply.body(400, { error: { status: 'INVALID_ARGUMENT', message: 'Unknown field thinkingConfig' } })],
    ['400 with an unreadable body', reply.raw(400, 'bad request')],
    ['404', reply.status(404)]
  ];

  for (const [label, behaviour] of nextRows) {
    it(`walks the whole cascade on ${label} without penalising the breaker`, async () => {
      const fake = createFakeFetch().otherwise(behaviour);
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.deepEqual(fake.models(), GEMINI_MODELS_CASCADE);
      assert.equal(result.strategy, 'OFFLINE_FALLBACK');
      assert.equal(result.retryAfterMs, undefined);
      assert.equal(provider.circuitBreaker.failureCount, 0);
      assertOfflinePlan(result);
    });
  }

  for (const status of [408, 500, 502, 503, 504, 599]) {
    it(`treats ${status} as transient: all models tried and one breaker failure`, async () => {
      const fake = createFakeFetch().otherwise(reply.status(status));
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.equal(fake.calls.length, ALL);
      assert.equal(result.strategy, 'OFFLINE_FALLBACK');
      assert.ok(result.warning.includes(`${GEMINI_MODELS_CASCADE[0]}: ${status}`));
      assert.equal(result.retryAfterMs, undefined);
      assert.equal(provider.circuitBreaker.failureCount, 1);
      assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
      assertOfflinePlan(result);
    });
  }

  for (const status of [402, 405, 409, 413, 422, 451]) {
    it(`treats ${status} as fatal: a single attempt and no breaker failure`, async () => {
      const fake = createFakeFetch().otherwise(reply.status(status));
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.equal(fake.calls.length, 1);
      assert.equal(result.strategy, 'OFFLINE_FALLBACK');
      assert.equal(result.retryAfterMs, undefined);
      assert.equal(provider.circuitBreaker.failureCount, 0);
      assertOfflinePlan(result);
    });
  }

  it('treats 429 as quota: all models tried, rate limited with the default delay', async () => {
    const fake = createFakeFetch().otherwise(reply.status(429));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, ALL);
    assert.equal(result.strategy, 'OFFLINE_RATE_LIMITED');
    assert.equal(result.retryAfterMs, 30000);
    assert.equal(provider.circuitBreaker.failureCount, 0);
    assertOfflinePlan(result);
  });

  it('stops after two consecutive network errors', async () => {
    const fake = createFakeFetch().otherwise(reply.network());
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 2);
    assert.equal(result.strategy, 'OFFLINE_FALLBACK');
    assert.match(result.warning, /NETWORK/);
    assert.equal(provider.circuitBreaker.failureCount, 1);
    assertOfflinePlan(result);
  });

  it('keeps going when network errors are separated by an HTTP reply', async () => {
    const fake = createFakeFetch(reply.network(), reply.status(503), reply.network(), reply.ok('late'));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 4);
    assert.equal(result.model, GEMINI_MODELS_CASCADE[3]);
  });

  it('prefers the quota outcome when quota and server errors are mixed', async () => {
    const fake = createFakeFetch(reply.status(503), reply.quota('20s')).otherwise(reply.status(500));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.strategy, 'OFFLINE_RATE_LIMITED');
    assert.equal(result.retryAfterMs, 20000);
    assert.equal(provider.circuitBreaker.failureCount, 0);
  });

  it('stops at once when a later model rejects the key', async () => {
    const fake = createFakeFetch(reply.status(503), reply.status(403));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 2);
    assert.equal(result.strategy, 'OFFLINE_KEY_REJECTED');
  });

  it('reports a blocked prompt without trying another model', async () => {
    const fake = createFakeFetch(reply.body(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 1);
    assert.equal(result.strategy, 'OFFLINE_BLOCKED');
    assert.match(result.warning, /declined/);
    assert.equal(provider.circuitBreaker.failureCount, 0);
    assertOfflinePlan(result);
  });
});

describe('Gemini cascade model fallthrough', () => {
  beforeEach(() => {
    captureConsole();
    globalThis.__CLEANAIR_TELEMETRY__ = [];
  });

  afterEach(() => {
    mock.restoreAll();
    assert.deepEqual(escaped, []);
  });

  const expectedStrategies = [
    'GEMINI_3_5_FLASH_LITE',
    'GEMINI_FLASH_LITE_LATEST',
    'GEMINI_3_1_FLASH_LITE',
    'GEMINI_3_8_FLASH',
    'GEMINI_FLASH_LATEST'
  ];

  GEMINI_MODELS_CASCADE.forEach((model, index) => {
    it(`succeeds on cascade position ${index + 1} (${model})`, async () => {
      const failures = Array.from({ length: index }, () => reply.status(503));
      const fake = createFakeFetch(...failures, reply.ok('winner'));
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.deepEqual(fake.models(), GEMINI_MODELS_CASCADE.slice(0, index + 1));
      assert.equal(result.model, model);
      assert.equal(result.strategy, expectedStrategies[index]);
      assert.equal(result.warning, undefined);
      assert.equal(result.plan.hourlyRoutines[0].activity, 'Morning shield winner');
      const telemetry = globalThis.__CLEANAIR_TELEMETRY__.at(-1);
      assert.equal(telemetry.status, 'SUCCESS');
      assert.equal(telemetry.model, model);
      assert.equal(telemetry.traces.length, index);
    });
  });

  it('clears accumulated breaker failures after a success', async () => {
    const fake = createFakeFetch(...Array.from({ length: ALL }, () => reply.status(500)), reply.ok());
    const { provider, clock } = setup(fake);

    await provider.getPlan(CONTEXT);
    clock.advance(60000);
    await provider.getPlan(CONTEXT);

    assert.equal(provider.circuitBreaker.failureCount, 0);
    assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
  });

  const unusable = [
    ['an HTML page with status 200', reply.raw(200, '<html>captive portal</html>')],
    ['an empty body', reply.raw(200, '')],
    ['JSON null', reply.body(200, null)],
    ['no candidates', reply.body(200, { candidates: [] })],
    ['a candidate without content', reply.body(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] })],
    ['an empty text part', reply.body(200, candidateBody(''))],
    ['prose instead of JSON', reply.text('I am sorry, I cannot help with that.')],
    ['unrecoverably truncated JSON', reply.text('{"hourlyRoutines":[{"timeSl')],
    ['a plan without routines', reply.text(JSON.stringify({ communityAdvisory: 'Stay in.' }))],
    ['an empty routine list', reply.text(JSON.stringify({ hourlyRoutines: [], communityAdvisory: 'Stay in.' }))],
    ['routines missing required fields', reply.text(JSON.stringify({ hourlyRoutines: [{ timeSlot: 'Morning' }] }))],
    ['routines of the wrong type', reply.text(JSON.stringify({ hourlyRoutines: 'stay inside' }))],
    ['an unknown action type', reply.text(JSON.stringify({
      hourlyRoutines: [{ timeSlot: 'Morning', activity: 'Walk', recommendation: 'Walk.', actionType: 'GO_OUTSIDE' }]
    }))],
    ['only script injection', reply.text(JSON.stringify({
      hourlyRoutines: [{ timeSlot: 'Morning', activity: '<img src=x onerror=alert(1)>', recommendation: 'Open https://evil.example', actionType: 'SEAL_HOME' }],
      communityAdvisory: '<script>alert(1)</script>'
    }))],
    ['only invented figures', reply.text(JSON.stringify({
      hourlyRoutines: [{ timeSlot: 'Morning', activity: 'Stay in', recommendation: 'AQI is 12 so go out.', actionType: 'SEAL_HOME' }]
    }))]
  ];

  for (const [label, behaviour] of unusable) {
    it(`falls through to the next model on ${label}`, async () => {
      const fake = createFakeFetch(behaviour, reply.ok('recovered'));
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.equal(fake.calls.length, 2);
      assert.equal(result.model, GEMINI_MODELS_CASCADE[1]);
      assert.equal(result.plan.hourlyRoutines[0].activity, 'Morning shield recovered');
    });

    it(`degrades to the on-device plan when every model returns ${label}`, async () => {
      const fake = createFakeFetch().otherwise(behaviour);
      const { provider } = setup(fake);

      const result = await provider.getPlan(CONTEXT);

      assert.equal(fake.calls.length, ALL);
      assert.equal(result.strategy, 'OFFLINE_FALLBACK');
      assert.match(result.warning, /INVALID_RESPONSE/);
      assert.equal(provider.circuitBreaker.failureCount, 1);
      assertOfflinePlan(result);
    });
  }

  it('accepts a fenced JSON answer', async () => {
    const fake = createFakeFetch(reply.text(`\`\`\`json\n${JSON.stringify(modelPlan('fenced'))}\n\`\`\``));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.plan.hourlyRoutines[0].activity, 'Morning shield fenced');
  });

  it('drops hostile routines and advisory text while keeping the safe ones', async () => {
    const hostile = modelPlan('mixed');
    hostile.hourlyRoutines[0].recommendation = '<script>steal()</script>';
    hostile.hourlyRoutines[1].activity = 'Visit www.evil.example';
    hostile.communityAdvisory = 'Read more at https://evil.example';
    hostile.communityAdvisoryHi = '<b>खिड़की</b>';
    const fake = createFakeFetch(reply.text(JSON.stringify(hostile)));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);
    const local = generateOfflineCleanAirPlan(CONTEXT);

    assert.deepEqual(result.plan.hourlyRoutines.map((r) => r.activity),
      ['Afternoon errands mixed', 'Evening commute mixed']);
    assert.equal(result.plan.bilingualAdvisory.en, local.bilingualAdvisory.en);
    assert.equal(result.plan.bilingualAdvisory.hi, local.bilingualAdvisory.hi);
    assert.doesNotMatch(JSON.stringify(result), /<script|evil\.example|<b>/);
  });

  it('ignores model supplied figures and unknown fields in the composed plan', async () => {
    const answer = {
      ...modelPlan(),
      severityLevel: 'GOOD',
      quantifiedImpact: { pm25InhalationAvoidedMicrograms: 999999 },
      iaqHack: { title: 'model hack' }
    };
    const fake = createFakeFetch(reply.text(JSON.stringify(answer)));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);
    const local = generateOfflineCleanAirPlan(CONTEXT);

    assert.equal(result.plan.severityLevel, local.severityLevel);
    assert.deepEqual(result.plan.quantifiedImpact, local.quantifiedImpact);
    assert.equal(result.plan.iaqHack.title, local.iaqHack.title);
  });

  it('bounds the telemetry ring buffer at 50 entries', async () => {
    const fake = createFakeFetch().otherwise(reply.ok());
    const { provider, clock } = setup(fake);

    for (let i = 0; i < 60; i++) {
      clock.advance(60000);
      await provider.getPlan(CONTEXT);
    }

    assert.equal(globalThis.__CLEANAIR_TELEMETRY__.length, 50);
  });
});

describe('Gemini cascade offline handling', () => {
  beforeEach(() => {
    captureConsole();
  });

  afterEach(() => {
    delete globalThis.navigator.onLine;
    mock.restoreAll();
    assert.deepEqual(escaped, []);
  });

  /**
   * Marks the runtime as offline or online.
   *
   * @param {boolean} value - Reported connectivity.
   */
  function setOnline(value) {
    Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true });
  }

  it('reports offline after a single failed attempt and does not count it against the service', async () => {
    setOnline(false);
    const fake = createFakeFetch().otherwise(reply.network());
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 1);
    assert.equal(result.strategy, 'OFFLINE_NETWORK');
    assert.match(result.warning, /offline/i);
    assert.equal(result.retryAfterMs, undefined);
    assert.equal(provider.circuitBreaker.failureCount, 0);
    assertOfflinePlan(result);
  });

  it('calls Gemini again once the connection returns', async () => {
    setOnline(false);
    const fake = createFakeFetch(reply.network(), reply.ok('back'));
    const { provider } = setup(fake);

    await provider.getPlan(CONTEXT);
    setOnline(true);
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
  });

  it('frees the half-open probe when the probe finds the device offline', async () => {
    const fake = createFakeFetch(reply.network(), reply.ok());
    const { provider, clock } = setup(fake);
    provider.circuitBreaker.recordFailure();
    provider.circuitBreaker.recordFailure();
    clock.advance(30000);
    setOnline(false);

    await provider.getPlan(CONTEXT);
    setOnline(true);
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
  });
});
