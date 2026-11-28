/**
 * @fileoverview Unit tests for live-aqi.js. Every request goes through an injected fetch
 * implementation; the global fetch is replaced with a guard that fails any real call.
 */

import test, { describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_METEO_ENDPOINT,
  LIVE_AQI_REFRESH_MS,
  LIVE_AQI_TIMEOUT_MS,
  resolveCoordinates,
  buildAirQualityUrl,
  parseAirQualityResponse,
  fetchLiveAqi,
  LiveAqiController
} from '../../src/js/live-aqi.js';

globalThis.fetch = () => {
  throw new Error('Unmocked external request');
};

const DELHI = Object.freeze({ lat: 28.6139, lon: 77.2090 });

/**
 * Builds a fetch response carrying an Open-Meteo style payload.
 *
 * @param {number} pm25 - PM2.5 value.
 * @returns {Object} Response double.
 */
function reply(pm25) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ current: { time: '2026-01-15T10:00', pm2_5: pm25, pm10: 300 } })
  };
}

/**
 * Creates a fetch double whose requests are settled by the test.
 *
 * @returns {{calls: Object[], fetchImpl: Function}}
 */
function manualFetch() {
  const calls = [];
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init, resolve, reject });
  });
  return { calls, fetchImpl };
}

/**
 * Creates a fetch double that never answers but honours cancellation like real fetch.
 *
 * @returns {{calls: Object[], fetchImpl: Function}}
 */
function hangingFetch() {
  const calls = [];
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init });
    const fail = () => reject(new DOMException('aborted', 'AbortError'));
    if (init.signal.aborted) fail();
    init.signal.addEventListener('abort', fail, { once: true });
  });
  return { calls, fetchImpl };
}

/**
 * Builds a controller with recording callbacks.
 *
 * @param {Object} [options] - Constructor overrides.
 * @returns {Object} Controller and recorders.
 */
function harness(options = {}) {
  const location = { city: 'Delhi NCR', detected: null };
  const readings = [];
  const statuses = [];
  const transport = options.transport || manualFetch();
  const controller = new LiveAqiController({
    getLocation: () => ({ ...location }),
    onReading: (reading) => readings.push(reading),
    onStatus: (update) => statuses.push(update),
    fetchImpl: transport.fetchImpl,
    ...options.deps
  });
  return { controller, location, readings, statuses, calls: transport.calls };
}

describe('resolveCoordinates', () => {
  test('test_resolveCoordinates_presetCityAnyCaseAndPadding_returnsPresetCoordinate', () => {
    assert.deepEqual(resolveCoordinates({ city: '  dELHI ncr ' }), { ...DELHI });
  });

  test('test_resolveCoordinates_presetResult_isCopy', () => {
    const first = resolveCoordinates({ city: 'Delhi NCR' });
    first.lat = 0;
    assert.equal(resolveCoordinates({ city: 'Delhi NCR' }).lat, DELHI.lat);
  });

  test('test_resolveCoordinates_unknownOrEmptyCity_returnsNull', () => {
    for (const city of ['Atlantis', '', undefined, null, 'Delhi']) {
      assert.equal(resolveCoordinates({ city }), null, `city ${String(city)}`);
    }
  });

  test('test_resolveCoordinates_detectedMatchesCity_prefersDeviceFix', () => {
    const detected = { lat: 28.5, lon: 77.3, city: 'Delhi NCR' };
    assert.deepEqual(resolveCoordinates({ city: 'Delhi NCR', detected }), { lat: 28.5, lon: 77.3 });
  });

  test('test_resolveCoordinates_detectedForOtherCity_ignoresDeviceFix', () => {
    const detected = { lat: 1, lon: 2, city: 'Noida' };
    assert.deepEqual(resolveCoordinates({ city: 'Delhi NCR', detected }), { ...DELHI });
  });

  test('test_resolveCoordinates_detectedNotFinite_fallsBackToPresetOrNull', () => {
    for (const detected of [{ lat: NaN, lon: 2, city: 'Noida' }, { lat: 1, lon: null, city: 'Noida' }]) {
      assert.equal(resolveCoordinates({ city: 'Noida', detected }), null);
    }
  });

  test('test_resolveCoordinates_zeroCoordinates_areAccepted', () => {
    const detected = { lat: 0, lon: 0, city: 'Null Island' };
    assert.deepEqual(resolveCoordinates({ city: 'Null Island', detected }), { lat: 0, lon: 0 });
  });
});

describe('buildAirQualityUrl', () => {
  test('test_buildAirQualityUrl_preciseFix_sendsOnlyTwoDecimals', () => {
    const url = new URL(buildAirQualityUrl({ lat: 28.613912345, lon: -111.891054321 }));
    assert.equal(`${url.origin}${url.pathname}`, OPEN_METEO_ENDPOINT);
    assert.equal(url.searchParams.get('latitude'), '28.61');
    assert.equal(url.searchParams.get('longitude'), '-111.89');
    assert.equal(url.searchParams.get('current'), 'pm2_5,pm10');
    assert.equal(url.searchParams.get('timezone'), 'auto');
    assert.doesNotMatch(url.href, /613912|891054/);
  });
});

describe('parseAirQualityResponse', () => {
  test('test_parseAirQualityResponse_validPayload_returnsFrozenReadingOnAppScale', () => {
    const reading = parseAirQualityResponse({ current: { time: '2026-01-15T10:00', pm2_5: 250, pm10: 310 } });
    assert.deepEqual({ ...reading }, { aqi: 400, pm25: 250, pm10: 310, observedAt: '2026-01-15T10:00' });
    assert.ok(Object.isFrozen(reading));
  });

  test('test_parseAirQualityResponse_zeroPm25_isUsable', () => {
    assert.equal(parseAirQualityResponse({ current: { pm2_5: 0 } }).aqi, 0);
  });

  test('test_parseAirQualityResponse_optionalFieldsMissing_defaultsThem', () => {
    const reading = parseAirQualityResponse({ current: { pm2_5: 10, pm10: 'n/a', time: 123 } });
    assert.equal(reading.pm10, null);
    assert.equal(reading.observedAt, '');
  });

  const unusable = {
    nullPayload: null,
    emptyObject: {},
    missingPm25: { current: {} },
    nullPm25: { current: { pm2_5: null } },
    stringPm25: { current: { pm2_5: '250' } },
    nanPm25: { current: { pm2_5: NaN } },
    infinitePm25: { current: { pm2_5: Infinity } },
    negativePm25: { current: { pm2_5: -0.01 } }
  };
  for (const [name, payload] of Object.entries(unusable)) {
    test(`test_parseAirQualityResponse_${name}_throws`, () => {
      assert.throws(() => parseAirQualityResponse(payload), /usable PM2\.5/);
    });
  }
});

describe('fetchLiveAqi', () => {
  test('test_fetchLiveAqi_success_requestsRoundedUrlWithoutCaching', async () => {
    const seen = [];
    const reading = await fetchLiveAqi(DELHI, {
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return reply(90);
      }
    });
    assert.equal(reading.aqi, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, buildAirQualityUrl(DELHI));
    assert.equal(seen[0].init.cache, 'no-store');
  });

  test('test_fetchLiveAqi_non2xxStatus_throwsWithStatus', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(fetchLiveAqi(DELHI, { fetchImpl }), /status 503/);
  });

  test('test_fetchLiveAqi_invalidJson_rejects', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json'); }
    });
    await assert.rejects(fetchLiveAqi(DELHI, { fetchImpl }), SyntaxError);
  });

  test('test_fetchLiveAqi_networkFailure_propagates', async () => {
    const fetchImpl = async () => { throw new TypeError('network down'); };
    await assert.rejects(fetchLiveAqi(DELHI, { fetchImpl }), /network down/);
  });

  test('test_fetchLiveAqi_deadline_abortsExactlyAtTimeout', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { calls, fetchImpl } = hangingFetch();
    const pending = fetchLiveAqi(DELHI, { fetchImpl });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    t.mock.timers.tick(LIVE_AQI_TIMEOUT_MS - 1);
    assert.equal(calls[0].init.signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(calls[0].init.signal.aborted, true);
    await rejected;
  });

  test('test_fetchLiveAqi_callerAbortsMidFlight_abortsRequest', async () => {
    const caller = new AbortController();
    const { calls, fetchImpl } = hangingFetch();
    const pending = fetchLiveAqi(DELHI, { fetchImpl, signal: caller.signal });
    caller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls[0].init.signal.aborted, true);
  });

  test('test_fetchLiveAqi_afterCompletion_detachesFromCallerSignal', async () => {
    const caller = new AbortController();
    let requestSignal = null;
    await fetchLiveAqi(DELHI, {
      signal: caller.signal,
      fetchImpl: async (url, init) => {
        requestSignal = init.signal;
        return reply(10);
      }
    });
    caller.abort();
    assert.equal(requestSignal.aborted, false);
  });

  test('test_fetchLiveAqi_signalAlreadyAborted_doesNotReturnReading', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImpl = async (url, init) => {
      if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      return reply(10);
    };
    await assert.rejects(fetchLiveAqi(DELHI, { fetchImpl, signal: caller.signal }), { name: 'AbortError' });
  });
});

describe('LiveAqiController', () => {
  beforeEach(() => {
    mock.restoreAll();
    mock.method(console, 'warn', () => {});
  });

  test('test_constructor_defaults_startsLiveWithDocumentedPeriods', () => {
    const { controller } = harness();
    assert.equal(controller.mode, 'live');
    assert.equal(controller.intervalMs, 15 * 60 * 1000);
    assert.equal(controller.timeoutMs, 8000);
  });

  test('test_refresh_success_publishesLoadingThenOkWithCity', async () => {
    const { controller, readings, statuses, calls } = harness();
    const pending = controller.refresh();
    calls[0].resolve(reply(250));
    assert.equal(await pending, true);
    assert.deepEqual(statuses.map((s) => s.status), ['loading', 'ok']);
    assert.equal(readings.length, 1);
    assert.equal(readings[0].aqi, 400);
    assert.equal(readings[0].city, 'Delhi NCR');
    assert.ok(Object.isFrozen(readings[0]));
    assert.equal(statuses[1].reading, readings[0]);
    assert.equal(statuses[1].mode, 'live');
  });

  test('test_refresh_unknownLocation_reportsUnavailableAndDropsLastReading', async () => {
    const { controller, location, statuses, calls } = harness();
    const first = controller.refresh();
    calls[0].resolve(reply(250));
    await first;
    location.city = 'Atlantis';
    assert.equal(await controller.refresh(), false);
    assert.equal(calls.length, 1);
    assert.equal(statuses.at(-1).status, 'unavailable');
    assert.equal(statuses.at(-1).reading, null);
    assert.match(statuses.at(-1).message, /No live feed/);
  });

  test('test_refresh_failureAfterSuccess_keepsLastReading', async () => {
    const { controller, readings, statuses, calls } = harness();
    const first = controller.refresh();
    calls[0].resolve(reply(250));
    await first;
    const second = controller.refresh();
    calls[1].reject(new TypeError('offline'));
    assert.equal(await second, false);
    assert.equal(readings.length, 1);
    assert.equal(statuses.at(-1).status, 'error');
    assert.equal(statuses.at(-1).reading.aqi, 400);
    assert.match(statuses.at(-1).message, /unreachable/);
  });

  test('test_refresh_badPayload_reportsErrorWithoutReading', async () => {
    const { controller, readings, statuses, calls } = harness();
    const pending = controller.refresh();
    calls[0].resolve({ ok: true, status: 200, json: async () => ({ current: {} }) });
    assert.equal(await pending, false);
    assert.equal(readings.length, 0);
    assert.equal(statuses.at(-1).status, 'error');
    assert.equal(statuses.at(-1).reading, null);
  });

  test('test_refresh_olderResponseArrivesLast_latestWins', async () => {
    const { controller, location, readings, statuses, calls } = harness();
    const older = controller.refresh();
    location.city = 'Lahore';
    const newer = controller.refresh();
    assert.equal(calls[0].init.signal.aborted, true);
    assert.equal(calls[1].init.signal.aborted, false);
    calls[1].resolve(reply(90));
    assert.equal(await newer, true);
    calls[0].resolve(reply(250));
    assert.equal(await older, false);
    assert.deepEqual(readings.map((r) => [r.city, r.aqi]), [['Lahore', 200]]);
    assert.equal(statuses.at(-1).status, 'ok');
  });

  test('test_refresh_supersededRequestFails_doesNotReportError', async () => {
    const { controller, statuses, calls } = harness();
    const older = controller.refresh();
    const newer = controller.refresh();
    calls[0].reject(new DOMException('aborted', 'AbortError'));
    assert.equal(await older, false);
    assert.deepEqual(statuses.map((s) => s.status), ['loading', 'loading']);
    calls[1].resolve(reply(90));
    await newer;
  });

  test('test_refresh_supersededByUnavailableLocation_discardsInFlight', async () => {
    const { controller, location, readings, statuses, calls } = harness();
    const older = controller.refresh();
    location.city = 'Atlantis';
    await controller.refresh();
    assert.equal(calls[0].init.signal.aborted, true);
    calls[0].resolve(reply(250));
    assert.equal(await older, false);
    assert.equal(readings.length, 0);
    assert.equal(statuses.at(-1).status, 'unavailable');
  });

  test('test_setManual_requestInFlight_discardsLateResponse', async () => {
    const { controller, readings, statuses, calls } = harness();
    const pending = controller.refresh();
    controller.setManual();
    assert.equal(calls[0].init.signal.aborted, true);
    calls[0].resolve(reply(250));
    assert.equal(await pending, false);
    assert.equal(readings.length, 0);
    assert.deepEqual(statuses.map((s) => [s.mode, s.status]), [['live', 'loading'], ['manual', 'manual']]);
  });

  test('test_refresh_manualMode_makesNoRequest', async () => {
    const { controller, calls } = harness();
    controller.setManual();
    assert.equal(await controller.refresh(), false);
    assert.equal(calls.length, 0);
  });

  test('test_enableLive_afterManual_fetchesImmediately', async () => {
    const { controller, readings, calls } = harness();
    controller.setManual();
    const pending = controller.enableLive();
    assert.equal(calls.length, 1);
    calls[0].resolve(reply(90));
    assert.equal(await pending, true);
    assert.equal(controller.mode, 'live');
    assert.equal(readings.length, 1);
  });

  test('test_start_liveMode_refreshesOncePerIntervalAndStopEndsIt', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let requests = 0;
    const transport = { calls: [], fetchImpl: async () => { requests++; return reply(10); } };
    const { controller } = harness({ transport });
    controller.start();
    controller.start();
    assert.equal(requests, 0);
    t.mock.timers.tick(LIVE_AQI_REFRESH_MS - 1);
    assert.equal(requests, 0);
    t.mock.timers.tick(1);
    assert.equal(requests, 1);
    t.mock.timers.tick(LIVE_AQI_REFRESH_MS);
    assert.equal(requests, 2);
    controller.stop();
    controller.stop();
    t.mock.timers.tick(LIVE_AQI_REFRESH_MS * 3);
    assert.equal(requests, 2);
    assert.equal(controller.timer, null);
  });

  test('test_start_manualMode_timerTicksMakeNoRequest', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { controller, calls } = harness();
    controller.setManual();
    controller.start();
    t.mock.timers.tick(LIVE_AQI_REFRESH_MS * 2);
    assert.equal(calls.length, 0);
    controller.stop();
  });
});
