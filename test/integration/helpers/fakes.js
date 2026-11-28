/**
 * @fileoverview Shared test doubles for the integration suite: a scripted fetch, Gemini and
 * Open-Meteo reply builders, an adjustable clock, a network guard and a console recorder.
 * No helper here reaches a real network.
 */

import { mock } from 'node:test';

export const FAKE_KEY = 'test-key-123';
export const GEMINI_HOST = 'generativelanguage.googleapis.com';

/**
 * Replaces the global fetch with a recorder that rejects, so that a request escaping the
 * injected fakes is detected instead of reaching a real service.
 *
 * @returns {string[]} Live list of URLs that escaped.
 */
export function installNetworkGuard() {
  const escaped = [];
  globalThis.fetch = async (url) => {
    escaped.push(String(url));
    throw new Error(`Unmocked external request: ${url}`);
  };
  return escaped;
}

/**
 * Silences console output and records every call for later inspection.
 *
 * @returns {string[]} Live list of formatted console lines.
 */
export function captureConsole() {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, method, (...args) => {
      lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg))).join(' '));
    });
  }
  return lines;
}

/**
 * Creates a manually advanced millisecond clock.
 *
 * @param {number} [start] - Initial time.
 * @returns {{now: Function, advance: Function}} Clock controls.
 */
export function createClock(start = 1000000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    }
  };
}

/**
 * Lets pending promise chains and stream reads finish without touching mocked timers.
 *
 * @param {number} [rounds] - Number of event loop turns.
 * @returns {Promise<void>}
 */
export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Builds a model answer that passes validation.
 *
 * @param {string} [tag] - Marker that identifies which response produced the text.
 * @returns {Object} Plan JSON as the model would return it.
 */
export function modelPlan(tag = 'alpha') {
  return {
    hourlyRoutines: [
      { timeSlot: 'Morning', activity: `Morning shield ${tag}`, recommendation: 'Keep windows closed and wear a fitted mask.', actionType: 'SEAL_HOME' },
      { timeSlot: 'Midday', activity: `Midday airing ${tag}`, recommendation: 'Ventilate briefly while the sun is high.', actionType: 'SAFE_VENTILATION' },
      { timeSlot: 'Afternoon', activity: `Afternoon errands ${tag}`, recommendation: 'Run errands now rather than at dusk.', actionType: 'SHIFT_INDOORS' },
      { timeSlot: 'Evening', activity: `Evening commute ${tag}`, recommendation: 'Wear a mask on the road home.', actionType: 'COMMUTE_SHIELD' }
    ],
    communityAdvisory: `Neighbours, keep windows closed at dawn and dusk ${tag}.`,
    communityAdvisoryHi: `सुबह और शाम खिड़कियाँ बंद रखें ${tag}।`
  };
}

/**
 * Wraps plan text in the generateContent success envelope.
 *
 * @param {string} text - Candidate part text.
 * @returns {Object} Success body.
 */
export function candidateBody(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/**
 * Builds a JSON HTTP response.
 *
 * @param {number} status - HTTP status.
 * @param {*} body - Value to serialize.
 * @returns {Response}
 */
export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const reply = Object.freeze({
  ok: (tag) => () => jsonResponse(200, candidateBody(JSON.stringify(modelPlan(tag)))),
  text: (text) => () => jsonResponse(200, candidateBody(text)),
  body: (status, body) => () => jsonResponse(status, body),
  raw: (status, text) => () => new Response(text, { status }),
  status: (status) => () => jsonResponse(status, { error: { code: status, message: 'synthetic failure' } }),
  quota: (retryDelay) => () => jsonResponse(429, {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []
    }
  }),
  badKey: () => () => jsonResponse(400, {
    error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] }
  }),
  network: () => () => Promise.reject(new TypeError('fetch failed')),
  hang: () => (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }),
  stalledBody: (status = 200) => (url, init) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })
  })
});

/**
 * Creates a scripted fetch. Queued behaviours are consumed in order; when the queue is empty
 * the fallback behaviour answers, and without a fallback the call fails the test.
 *
 * @param {...Function} behaviours - Initial queue.
 * @returns {{fetch: Function, calls: Object[], push: Function, otherwise: Function,
 *   defer: Function, models: Function}} Fake transport.
 */
export function createFakeFetch(...behaviours) {
  const queue = [...behaviours];
  const calls = [];
  let fallback = null;
  const fake = {
    calls,
    fetch: (url, init = {}) => {
      calls.push({ url: String(url), init });
      const behaviour = queue.shift() || fallback;
      if (!behaviour) return Promise.reject(new Error(`Unscripted request #${calls.length}: ${url}`));
      return Promise.resolve(behaviour(url, init));
    },
    push: (...more) => {
      queue.push(...more);
      return fake;
    },
    otherwise: (behaviour) => {
      fallback = behaviour;
      return fake;
    },
    defer: () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      queue.push(() => gate);
      return (behaviour) => release(behaviour());
    },
    models: () => calls.map((call) => /models\/([^:]+):generateContent/.exec(call.url)?.[1])
  };
  return fake;
}

/**
 * Extracts the grounded facts block from a recorded generateContent request.
 *
 * @param {{init: {body: string}}} call - Recorded call.
 * @returns {Object} Parsed facts.
 */
export function factsOf(call) {
  const prompt = JSON.parse(call.init.body).contents[0].parts[0].text;
  return JSON.parse(/<facts_json>\n([\s\S]*?)\n<\/facts_json>/.exec(prompt)[1]);
}
