/**
 * @fileoverview Back-pressure and recovery of GeminiPlanProvider with an injected clock:
 * local rate limit, server quota delay, circuit breaker states and key replacement.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  SecureKeyStore,
  GeminiPlanProvider,
  GEMINI_MODELS_CASCADE,
  QUOTA_DEFAULT_DELAY_MS,
  QUOTA_MIN_DELAY_MS,
  QUOTA_MAX_AUTO_DELAY_MS
} from '../../src/js/gemini-service.js';
import { DEFAULT_PRESET } from '../../src/js/config.js';
import {
  FAKE_KEY, installNetworkGuard, captureConsole, createClock, createFakeFetch, settle, reply
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
 * Drives two exhausted transient generations so that the breaker opens.
 *
 * @param {GeminiPlanProvider} provider - Provider whose transport answers 500.
 * @returns {Promise<Object[]>} Both results.
 */
async function tripBreaker(provider) {
  return [await provider.getPlan(CONTEXT), await provider.getPlan(CONTEXT)];
}

beforeEach(() => {
  captureConsole();
});

afterEach(() => {
  mock.restoreAll();
  assert.deepEqual(escaped, []);
});

describe('local rate limit', () => {
  it('allows a burst of three, then answers offline with the refill time', async () => {
    const fake = createFakeFetch().otherwise(reply.ok());
    const { provider, clock } = setup(fake);

    for (let i = 0; i < 3; i++) await provider.getPlan(CONTEXT);
    const limited = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 3);
    assert.equal(limited.strategy, 'OFFLINE_RATE_LIMITED');
    assert.match(limited.warning, /5 req\/min/);
    assert.equal(limited.retryAfterMs, 12050);

    clock.advance(limited.retryAfterMs);
    assert.equal((await provider.getPlan(CONTEXT)).model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(fake.calls.length, 4);
  });

  it('reports a shorter wait as the bucket refills', async () => {
    const fake = createFakeFetch().otherwise(reply.ok());
    const { provider, clock } = setup(fake);
    for (let i = 0; i < 3; i++) await provider.getPlan(CONTEXT);

    clock.advance(9000);
    const limited = await provider.getPlan(CONTEXT);

    assert.equal(limited.retryAfterMs, 3050);
  });

  it('charges one token per generation however many models are tried', async () => {
    const fake = createFakeFetch().otherwise(reply.status(404));
    const { provider } = setup(fake);

    for (let i = 0; i < 3; i++) await provider.getPlan(CONTEXT);
    const limited = await provider.getPlan(CONTEXT);

    assert.equal(fake.calls.length, 3 * ALL);
    assert.equal(limited.strategy, 'OFFLINE_RATE_LIMITED');
  });

  it('frees the half-open probe when the limiter refuses it', async () => {
    const fake = createFakeFetch().otherwise(reply.ok());
    const { provider, clock } = setup(fake);
    provider.circuitBreaker.recordFailure();
    provider.circuitBreaker.recordFailure();
    clock.advance(30000);
    provider.rateLimiter.tokens = 0;
    provider.rateLimiter.lastRefill = clock.now();

    const limited = await provider.getPlan(CONTEXT);
    clock.advance(limited.retryAfterMs);
    const probe = await provider.getPlan(CONTEXT);

    assert.equal(limited.strategy, 'OFFLINE_RATE_LIMITED');
    assert.equal(probe.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
  });
});

describe('server quota delay', () => {
  const rows = [
    ['no RetryInfo', undefined, QUOTA_DEFAULT_DELAY_MS],
    ['a one second hint raised to the floor', '1s', QUOTA_MIN_DELAY_MS],
    ['a zero hint treated as absent', '0s', QUOTA_DEFAULT_DELAY_MS],
    ['an unreadable hint', 'soon', QUOTA_DEFAULT_DELAY_MS],
    ['a fractional hint', '12.5s', 12500],
    ['a 45 second hint', '45s', 45000],
    ['the automatic retry ceiling', '120s', QUOTA_MAX_AUTO_DELAY_MS]
  ];

  for (const [label, hint, expected] of rows) {
    it(`blocks for ${expected} ms given ${label}`, async () => {
      const fake = createFakeFetch(...Array.from({ length: ALL }, () => reply.quota(hint))).otherwise(reply.ok());
      const { provider, clock } = setup(fake);

      const limited = await provider.getPlan(CONTEXT);
      assert.equal(limited.retryAfterMs, expected);

      clock.advance(expected - 1);
      const blocked = await provider.getPlan(CONTEXT);
      assert.equal(blocked.strategy, 'OFFLINE_RATE_LIMITED');
      assert.equal(blocked.retryAfterMs, 1);
      assert.equal(fake.calls.length, ALL);

      clock.advance(1);
      assert.equal((await provider.getPlan(CONTEXT)).model, GEMINI_MODELS_CASCADE[0]);
      assert.equal(fake.calls.length, ALL + 1);
    });
  }

  it('offers no automatic retry and sets no block above the ceiling', async () => {
    const fake = createFakeFetch(...Array.from({ length: ALL }, () => reply.quota('121s'))).otherwise(reply.ok());
    const { provider } = setup(fake);

    const limited = await provider.getPlan(CONTEXT);
    assert.equal(limited.strategy, 'OFFLINE_RATE_LIMITED');
    assert.equal(limited.retryAfterMs, undefined);
    assert.equal(provider.blockedUntil, 0);

    assert.equal((await provider.getPlan(CONTEXT)).model, GEMINI_MODELS_CASCADE[0]);
  });

  it('honours the longest hint among the models', async () => {
    const fake = createFakeFetch(reply.quota('15s'), reply.quota('50s'), reply.quota('20s'))
      .otherwise(reply.quota());
    const { provider } = setup(fake);

    assert.equal((await provider.getPlan(CONTEXT)).retryAfterMs, 50000);
  });

  it('answers with advice when a later model still has quota', async () => {
    const fake = createFakeFetch(reply.quota('60s'), reply.ok('spare'));
    const { provider } = setup(fake);

    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[1]);
    assert.equal(provider.blockedUntil, 0);
  });

  it('lifts the block when the user saves a key again', async () => {
    const fake = createFakeFetch(...Array.from({ length: ALL }, () => reply.quota('60s'))).otherwise(reply.ok());
    const { provider, keyStore } = setup(fake);
    await provider.getPlan(CONTEXT);

    keyStore.setKey('test-key-456');
    provider.resetAvailability();
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(fake.calls.at(-1).init.headers['x-goog-api-key'], 'test-key-456');
  });
});

describe('circuit breaker through the provider', () => {
  it('opens after two exhausted transient generations and stops calling', async () => {
    const fake = createFakeFetch().otherwise(reply.status(500));
    const { provider, clock } = setup(fake);

    const [first, second] = await tripBreaker(provider);
    assert.equal(first.retryAfterMs, undefined);
    assert.equal(second.retryAfterMs, 30000);
    assert.equal(provider.circuitBreaker.getState(), 'OPEN');

    clock.advance(10000);
    const open = await provider.getPlan(CONTEXT);
    assert.equal(open.strategy, 'OFFLINE_CIRCUIT_OPEN');
    assert.equal(open.retryAfterMs, 20000);
    assert.equal(fake.calls.length, 2 * ALL);
  });

  it('admits one probe after the cooldown and closes on success', async () => {
    const fake = createFakeFetch(...Array.from({ length: 2 * ALL }, () => reply.status(500)));
    const release = fake.defer();
    const { provider, clock } = setup(fake);
    await tripBreaker(provider);
    clock.advance(30000);

    const probe = provider.getPlan(CONTEXT);
    await settle();
    clock.advance(1);
    const concurrent = await provider.getPlan(CONTEXT);
    assert.equal(concurrent.strategy, 'OFFLINE_CIRCUIT_OPEN');
    assert.equal(concurrent.retryAfterMs, 1000);
    assert.equal(fake.calls.length, 2 * ALL + 1);

    release(reply.ok('probe'));
    assert.equal((await probe).model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
    assert.equal(provider.circuitBreaker.failureCount, 0);
  });

  it('reopens for a full cooldown when the probe fails', async () => {
    const fake = createFakeFetch().otherwise(reply.status(503));
    const { provider, clock } = setup(fake);
    await tripBreaker(provider);
    clock.advance(30000);

    const probe = await provider.getPlan(CONTEXT);

    assert.equal(probe.strategy, 'OFFLINE_FALLBACK');
    assert.equal(probe.retryAfterMs, 30000);
    assert.equal(provider.circuitBreaker.getState(), 'OPEN');
    assert.equal((await provider.getPlan(CONTEXT)).strategy, 'OFFLINE_CIRCUIT_OPEN');
    assert.equal(fake.calls.length, 3 * ALL);
  });

  const inconclusive = [
    ['a fatal status', reply.status(422), 'OFFLINE_FALLBACK'],
    ['a blocked prompt', reply.body(200, { promptFeedback: { blockReason: 'OTHER' } }), 'OFFLINE_BLOCKED'],
    ['a quota reply above the ceiling', reply.quota('3600s'), 'OFFLINE_RATE_LIMITED']
  ];

  for (const [label, behaviour, strategy] of inconclusive) {
    it(`stays half-open and frees the probe after ${label}`, async () => {
      const fake = createFakeFetch(...Array.from({ length: 2 * ALL }, () => reply.status(500))).otherwise(behaviour);
      const { provider, clock } = setup(fake);
      await tripBreaker(provider);
      clock.advance(30000);

      const probe = await provider.getPlan(CONTEXT);
      assert.equal(probe.strategy, strategy);
      assert.equal(provider.circuitBreaker.getState(), 'HALF_OPEN');

      clock.advance(60000);
      fake.otherwise(reply.ok());
      assert.equal((await provider.getPlan(CONTEXT)).model, GEMINI_MODELS_CASCADE[0]);
    });
  }

  it('frees the probe when the probing request is superseded', async () => {
    const fake = createFakeFetch(...Array.from({ length: 2 * ALL }, () => reply.status(500)), reply.hang())
      .otherwise(reply.ok());
    const { provider, clock } = setup(fake);
    await tripBreaker(provider);
    clock.advance(30000);
    const controller = new AbortController();

    const probe = provider.getPlan(CONTEXT, { signal: controller.signal });
    await settle();
    controller.abort('SUPERSEDED');
    await assert.rejects(probe, { name: 'AbortError' });
    const next = await provider.getPlan(CONTEXT);

    assert.equal(next.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(provider.circuitBreaker.getState(), 'CLOSED');
  });

  it('closes immediately when the user saves a key again', async () => {
    const fake = createFakeFetch(...Array.from({ length: 2 * ALL }, () => reply.status(500))).otherwise(reply.ok());
    const { provider, clock } = setup(fake);
    await tripBreaker(provider);
    clock.advance(30000 * 2);

    provider.resetAvailability();
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
  });
});

describe('key replacement', () => {
  it('calls again for a new key after the old one was rejected', async () => {
    const fake = createFakeFetch(reply.badKey(), reply.ok('fresh'));
    const { provider, keyStore } = setup(fake);
    await provider.getPlan(CONTEXT);

    keyStore.setKey('test-key-456');
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.model, GEMINI_MODELS_CASCADE[0]);
    assert.equal(fake.calls[1].init.headers['x-goog-api-key'], 'test-key-456');
  });

  it('does not apply a late rejection of the old key to the new key', async () => {
    const fake = createFakeFetch();
    const release = fake.defer();
    fake.otherwise(reply.ok());
    const { provider, keyStore } = setup(fake);

    const stale = provider.getPlan(CONTEXT);
    await settle();
    keyStore.setKey('test-key-456');
    release(reply.badKey());
    assert.equal((await stale).strategy, 'OFFLINE_KEY_REJECTED');

    assert.equal((await provider.getPlan(CONTEXT)).model, GEMINI_MODELS_CASCADE[0]);
  });

  it('answers offline without a call once the key is purged', async () => {
    const fake = createFakeFetch(reply.ok());
    const { provider, keyStore } = setup(fake);
    await provider.getPlan(CONTEXT);

    keyStore.purge();
    const result = await provider.getPlan(CONTEXT);

    assert.equal(result.strategy, 'OFFLINE_NO_KEY');
    assert.equal(fake.calls.length, 1);
  });
});
