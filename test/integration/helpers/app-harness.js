/**
 * @fileoverview Headless harness for the app.js request pipeline: mocked timers, scripted
 * Gemini and Open-Meteo transports, pristine state between tests and an optional minimal
 * element registry for the few status elements the pipeline writes to.
 */

import { mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  state, keyStore, planProvider, liveAqi, triggerPlanGeneration, schedulePlanGeneration
} from '../../../src/js/app.js';
import { TokenBucketLimiter } from '../../../src/js/gemini-service.js';
import { globalEventBus } from '../../../src/js/event-bus.js';
import { FAKE_KEY, installNetworkGuard, captureConsole, createFakeFetch, settle } from './fakes.js';

export const START = Date.parse('2026-11-28T06:00:00Z');

const escaped = installNetworkGuard();
const pristine = Object.freeze({ ...state });
const originalProviderFetch = planProvider.fetchImpl;
const originalLiveFetch = liveAqi.fetchImpl;

/**
 * Starts one isolated pipeline session.
 *
 * @returns {{gemini: Object, meteo: Object, consoleLines: string[], events: Array}}
 *   Fresh transports and observation points.
 */
export function startSession() {
  const consoleLines = captureConsole();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });
  const gemini = createFakeFetch();
  const meteo = createFakeFetch();
  planProvider.fetchImpl = gemini.fetch;
  planProvider.rateLimiter = new TokenBucketLimiter(3, 5, planProvider.now);
  planProvider.resetAvailability();
  liveAqi.fetchImpl = meteo.fetch;
  globalThis.__CLEANAIR_TELEMETRY__ = [];

  const events = [];
  globalEventBus.clear();
  for (const name of ['CONTEXT_CHANGED', 'PLAN_GENERATED', 'PLAN_ERROR']) {
    globalEventBus.on(name, (payload) => events.push({ name, payload: JSON.stringify(payload) }));
  }
  return { gemini, meteo, consoleLines, events };
}

/**
 * Cancels every pending request and timer, restores the exported singletons and verifies
 * that nothing reached a real network.
 *
 * @returns {Promise<void>}
 */
export async function endSession() {
  keyStore.purge();
  await triggerPlanGeneration();
  liveAqi.stop();
  liveAqi.setManual();
  liveAqi.lastReading = null;
  await settle();
  mock.timers.tick(1);
  await settle();
  delete globalThis.document;
  for (const key of Object.keys(state)) {
    if (!(key in pristine)) delete state[key];
  }
  Object.assign(state, pristine);
  planProvider.fetchImpl = originalProviderFetch;
  liveAqi.fetchImpl = originalLiveFetch;
  planProvider.resetAvailability();
  globalEventBus.clear();
  mock.timers.reset();
  mock.restoreAll();
  assert.deepEqual(escaped, []);
}

/**
 * Advances mocked time and lets the resulting promise chains finish.
 *
 * @param {number} [ms] - Time to advance.
 * @returns {Promise<void>}
 */
export async function advance(ms = 0) {
  await settle();
  if (ms > 0) {
    mock.timers.tick(ms);
    await settle();
  }
}

/**
 * Stores the fake key the way the Save button does, without dispatching.
 *
 * @param {string} [value] - Key text.
 */
export function holdKey(value = FAKE_KEY) {
  keyStore.setKey(value);
  planProvider.resetAvailability();
}

/**
 * Reproduces the Save key button: drop cached advice, store the key and dispatch at once.
 *
 * @param {string} value - Key text.
 * @returns {Promise<void>}
 */
export async function saveKey(value = FAKE_KEY) {
  state.adviceCache = null;
  if (keyStore.setKey(value)) planProvider.resetAvailability();
  schedulePlanGeneration(0, { force: true });
  await settle();
}

/**
 * Reproduces the Clear key button.
 *
 * @returns {Promise<void>}
 */
export async function clearKey() {
  keyStore.purge();
  state.adviceCache = null;
  schedulePlanGeneration(0);
  await settle();
}

/**
 * Dispatches a generation immediately and waits for it to finish.
 *
 * @param {{force?: boolean}} [options] - Passed to the pipeline.
 * @returns {Promise<void>}
 */
export async function generate(options) {
  const pending = triggerPlanGeneration(null, options);
  await settle();
  await pending;
}

/**
 * Installs a minimal element registry for the status elements, so that banner and key
 * messages can be observed without a browser.
 *
 * @returns {Object<string, Object>} Elements by id.
 */
export function installStatusElements() {
  const element = () => {
    const classes = new Set(['hidden']);
    const attributes = new Map();
    return {
      textContent: '',
      value: '',
      disabled: false,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name)
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: (name) => attributes.get(name) ?? null
    };
  };
  const ids = ['status-banner', 'key-status-text', 'btn-generate-plan', 'plan-spinner',
    'plan-spinner-text', 'source-advice', 'source-aqi', 'btn-live-aqi'];
  const registry = Object.fromEntries(ids.map((id) => [id, element()]));
  globalThis.document = { getElementById: (id) => registry[id] ?? null };
  return registry;
}
