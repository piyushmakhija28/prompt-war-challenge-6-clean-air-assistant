/**
 * @fileoverview The live air quality feed wired to application state: readings through
 * applyLiveReading, their effect on figures and Gemini advice, failure notices, location
 * changes, manual override and timed refresh. Runs headless with a scripted Open-Meteo.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  state, liveAqi, applyManualAqi, describeAqiSource, describeAdviceSource, schedulePlanGeneration,
  ADVICE_DEBOUNCE_MS
} from '../../src/js/app.js';
import { LIVE_AQI_REFRESH_MS, LIVE_AQI_TIMEOUT_MS } from '../../src/js/live-aqi.js';
import { GEMINI_MODELS_CASCADE } from '../../src/js/gemini-service.js';
import { computeImpact, massConcentrationToAqi } from '../../src/js/impact-calculator.js';
import { METRO_BASIN_COORDINATES } from '../../src/js/config.js';
import { factsOf, jsonResponse, settle, reply } from './helpers/fakes.js';
import { startSession, endSession, advance, holdKey, installStatusElements } from './helpers/app-harness.js';

let session;

/**
 * Builds an Open-Meteo answer.
 *
 * @param {number} pm25 - Current PM2.5 concentration.
 * @param {string} [time] - Observation time.
 * @returns {Function} Fake transport behaviour.
 */
function meteoReading(pm25, time = '2026-11-28T11:00') {
  return () => jsonResponse(200, { current: { time, pm2_5: pm25, pm10: pm25 * 2 } });
}

/**
 * Starts the live feed and waits for it.
 *
 * @returns {Promise<boolean>} Whether a reading was applied.
 */
async function goLive() {
  const pending = liveAqi.enableLive();
  await settle();
  return pending;
}

/**
 * Asserts that the plan on screen was computed from the current AQI.
 */
function assertPlanMatchesState() {
  const impact = computeImpact(state);
  assert.equal(state.activePlan.quantifiedImpact.pm25InhalationAvoidedMicrograms, impact.pm25AvoidedUg);
  assert.ok(state.activePlan.communityAdvisory.includes(`(AQI ${state.aqi}`));
}

beforeEach(() => {
  session = startSession();
});

afterEach(async () => {
  await endSession();
});

describe('live reading into application state', () => {
  it('queries the selected city with two decimals and applies the converted AQI everywhere', async () => {
    session.meteo.push(meteoReading(75.4));

    assert.equal(await goLive(), true);

    const url = new URL(session.meteo.calls[0].url);
    const delhi = METRO_BASIN_COORDINATES['Delhi NCR'];
    assert.equal(url.host, 'air-quality-api.open-meteo.com');
    assert.equal(url.searchParams.get('latitude'), delhi.lat.toFixed(2));
    assert.equal(url.searchParams.get('longitude'), delhi.lon.toFixed(2));
    assert.equal(url.searchParams.get('current'), 'pm2_5,pm10');
    assert.equal(session.meteo.calls[0].init.cache, 'no-store');
    assert.equal(state.aqi, massConcentrationToAqi(75.4));
    assert.equal(state.aqiSource, 'live');
    assert.equal(state.aqiObservedAt, '2026-11-28T11:00');
    assert.equal(describeAqiSource(), 'AQI: Live · Open-Meteo estimate (2026-11-28 11:00)');
    assertPlanMatchesState();
  });

  it('mirrors the reading into the inputs and the button label', async () => {
    const elements = installStatusElements();
    session.meteo.push(meteoReading(40));

    await goLive();

    assert.equal(elements['btn-live-aqi'].textContent, 'Refresh live AQI');
    assert.equal(elements['source-aqi'].textContent, describeAqiSource());
  });

  it('sends the detected position only for the detected city, rounded', async () => {
    state.city = 'Sector 62, Uttar Pradesh';
    state.detectedLocation = { lat: 28.627891, lon: 77.364912, city: 'Sector 62, Uttar Pradesh' };
    session.meteo.push(meteoReading(50), meteoReading(60));

    await goLive();
    state.city = 'Lahore';
    await goLive();

    assert.match(session.meteo.calls[0].url, /latitude=28\.63&longitude=77\.36&/);
    assert.equal(session.meteo.calls[0].url.includes('28.627'), false);
    assert.match(session.meteo.calls[1].url, /latitude=31\.52&longitude=74\.36&/);
  });

  it('grounds the next Gemini request in the live value', async () => {
    holdKey();
    session.meteo.push(meteoReading(200));
    session.gemini.otherwise(reply.ok('live'));

    await goLive();
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 1);
    const facts = factsOf(session.gemini.calls[0]);
    assert.equal(facts.aqi, massConcentrationToAqi(200));
    assert.equal(facts.aqiSource, 'live');
    assert.equal(facts.computed.pm25AvoidedUg, computeImpact(state).pm25AvoidedUg);
    assert.equal(describeAdviceSource(), `Advice: Gemini ${GEMINI_MODELS_CASCADE[0]}`);
    assertPlanMatchesState();
  });

  it('replaces a running Gemini request when a different reading arrives', async () => {
    holdKey();
    session.meteo.push(meteoReading(100), meteoReading(300));
    session.gemini.push(reply.hang(), reply.ok('fresh'));

    await goLive();
    await advance(ADVICE_DEBOUNCE_MS);
    await goLive();

    assert.equal(session.gemini.calls[0].init.signal.aborted, true);
    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(factsOf(session.gemini.calls[1]).aqi, massConcentrationToAqi(300));
    assert.equal(state.activePlan.hourlyRoutines[0].activity, 'Morning shield fresh');
  });
});

describe('timed refresh', () => {
  it('fetches every 15 minutes and calls Gemini only when the value changes', async () => {
    holdKey();
    session.meteo.push(meteoReading(100, 't1'), meteoReading(100, 't2'), meteoReading(180, 't3'));
    session.gemini.push(reply.ok('t1'), reply.ok('t3'));
    await goLive();
    liveAqi.start();
    await advance(ADVICE_DEBOUNCE_MS);

    await advance(LIVE_AQI_REFRESH_MS - ADVICE_DEBOUNCE_MS - 1);
    assert.equal(session.meteo.calls.length, 1);
    await advance(1);
    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(session.meteo.calls.length, 2);
    assert.equal(session.gemini.calls.length, 1);
    assert.equal(state.aqiObservedAt, 't2');

    await advance(LIVE_AQI_REFRESH_MS - ADVICE_DEBOUNCE_MS);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.meteo.calls.length, 3);
    assert.equal(session.gemini.calls.length, 2);
    assert.equal(state.aqi, massConcentrationToAqi(180));
    assertPlanMatchesState();
  });

  it('keeps a single timer when started twice and none after stop', async () => {
    session.meteo.otherwise(meteoReading(90));
    await goLive();
    liveAqi.start();
    liveAqi.start();

    await advance(LIVE_AQI_REFRESH_MS);
    assert.equal(session.meteo.calls.length, 2);

    liveAqi.stop();
    await advance(LIVE_AQI_REFRESH_MS * 4);
    assert.equal(session.meteo.calls.length, 2);
  });

  it('does not fetch while in manual mode and resumes on return to live', async () => {
    session.meteo.otherwise(meteoReading(90));
    await goLive();
    liveAqi.start();

    applyManualAqi(321);
    await advance(LIVE_AQI_REFRESH_MS * 3);
    assert.equal(session.meteo.calls.length, 1);
    assert.equal(state.aqi, 321);
    assert.equal(describeAqiSource(), 'AQI: Manual');

    await goLive();
    assert.equal(state.aqi, massConcentrationToAqi(90));
    assert.equal(state.aqiSource, 'live');
  });
});

describe('feed failures', () => {
  const failures = [
    ['HTTP 500', () => jsonResponse(500, {})],
    ['HTTP 429', () => jsonResponse(429, { reason: 'limit' })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['an HTML body', () => new Response('<html></html>', { status: 200 })],
    ['a payload without current values', () => jsonResponse(200, {})],
    ['a null PM2.5', () => jsonResponse(200, { current: { pm2_5: null } })],
    ['a textual PM2.5', () => jsonResponse(200, { current: { pm2_5: '75' } })],
    ['a negative PM2.5', () => jsonResponse(200, { current: { pm2_5: -1 } })]
  ];

  for (const [label, failure] of failures) {
    it(`keeps the last live value with a notice after ${label}`, async () => {
      session.meteo.push(meteoReading(80), failure);
      await goLive();
      const lastAqi = state.aqi;

      assert.equal(await goLive(), false);

      assert.equal(state.aqi, lastAqi);
      assert.equal(state.aqiSource, 'live');
      assert.match(describeAqiSource(), /^AQI: Live .*unreachable/);
    });
  }

  it('clears the notice once the feed recovers', async () => {
    session.meteo.push(meteoReading(80), () => jsonResponse(503, {}), meteoReading(85));
    await goLive();
    await goLive();

    await goLive();

    assert.equal(state.aqiNotice, '');
    assert.doesNotMatch(describeAqiSource(), /unreachable|fetching/);
  });

  it('is labelled not live when the very first fetch fails', async () => {
    const before = state.aqi;
    session.meteo.push(() => jsonResponse(500, {}));

    await goLive();

    assert.equal(state.aqi, before);
    assert.match(describeAqiSource(), /^AQI: Not live · .*unreachable/);
  });

  it('is labelled not live when the fetch for a newly chosen city fails', async () => {
    session.meteo.push(meteoReading(80), () => jsonResponse(500, {}));
    await goLive();
    const delhiAqi = state.aqi;

    state.city = 'Lahore';
    await goLive();

    assert.equal(state.aqi, delhiAqi);
    assert.equal(state.aqiSource, 'manual');
    assert.match(describeAqiSource(), /^AQI: Not live/);
  });

  it('gives up after the request timeout and says the feed is unreachable', async () => {
    session.meteo.push(reply.hang());
    const pending = liveAqi.enableLive();
    await advance(LIVE_AQI_TIMEOUT_MS - 1);
    assert.match(describeAqiSource(), /fetching live value/);

    await advance(1);

    assert.equal(await pending, false);
    assert.equal(session.meteo.calls[0].init.signal.aborted, true);
    assert.match(describeAqiSource(), /unreachable/);
  });

  it('reports a location without a feed and makes no request', async () => {
    state.city = 'Unknown Village';

    assert.equal(await goLive(), false);

    assert.equal(session.meteo.calls.length, 0);
    assert.equal(state.aqiSource, 'manual');
    assert.match(describeAqiSource(), /^AQI: Not live · No live feed/);
  });
});

describe('advice after a city change', () => {
  /**
   * Shows Delhi advice, then selects Lahore while its reading is still pending.
   *
   * @param {Function} [unanswered] - Transport behaviour for the Lahore request; by default
   *   the test releases it.
   * @returns {Promise<{release: Function|null, pending: Promise<boolean>}>} Feed controls.
   */
  async function chooseLahoreWithSlowFeed(unanswered) {
    holdKey();
    session.gemini.otherwise(reply.ok('advice'));
    session.meteo.push(meteoReading(80));
    await goLive();
    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(session.gemini.calls.length, 1);

    let release = null;
    if (unanswered) session.meteo.push(unanswered);
    else release = session.meteo.defer();
    state.city = 'Lahore';
    const pending = liveAqi.enableLive();
    schedulePlanGeneration();
    await advance(ADVICE_DEBOUNCE_MS * 3);
    return { release, pending };
  }

  it('waits for the new reading instead of sending the old value', async () => {
    const { release, pending } = await chooseLahoreWithSlowFeed();
    assert.equal(session.gemini.calls.length, 1);

    release(meteoReading(210));
    await pending;
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
    const facts = factsOf(session.gemini.calls[1]);
    assert.equal(facts.city, 'Lahore');
    assert.equal(facts.aqi, massConcentrationToAqi(210));
  });

  it('sends the held request once the new city fails, labelled manual', async () => {
    const { release, pending } = await chooseLahoreWithSlowFeed();

    release(() => jsonResponse(500, {}));
    await pending;
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
    assert.equal(factsOf(session.gemini.calls[1]).aqiSource, 'manual');
  });

  it('sends the held request when the feed times out', async () => {
    const { pending } = await chooseLahoreWithSlowFeed(reply.hang());
    assert.equal(session.gemini.calls.length, 1);

    await advance(LIVE_AQI_TIMEOUT_MS);
    await pending;
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
  });

  it('never holds a forced request', async () => {
    await chooseLahoreWithSlowFeed();

    schedulePlanGeneration(ADVICE_DEBOUNCE_MS, { force: true });
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
  });

  it('does not hold a change while the same city is refreshing', async () => {
    holdKey();
    session.gemini.otherwise(reply.ok('advice'));
    session.meteo.push(meteoReading(80), reply.hang());
    await goLive();
    await advance(ADVICE_DEBOUNCE_MS);
    liveAqi.refresh();

    state.commuteMode = 'private_car';
    schedulePlanGeneration();
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
  });

  it('says the value on screen is not live when returning to live fails', async () => {
    session.meteo.push(meteoReading(80), () => jsonResponse(500, {}));
    await goLive();
    applyManualAqi(12);

    await goLive();

    assert.equal(state.aqi, 12);
    assert.equal(describeAqiSource(), 'AQI: Not live · Live air quality is unreachable. The value on screen is not live.');
  });
});

describe('supersede', () => {
  it('discards a reading that arrives after a manual override', async () => {
    const release = session.meteo.defer();
    const pending = liveAqi.enableLive();
    await settle();

    applyManualAqi(222);
    release(meteoReading(20));
    await settle();

    assert.equal(await pending, false);
    assert.equal(session.meteo.calls[0].init.signal.aborted, true);
    assert.equal(state.aqi, 222);
    assert.equal(describeAqiSource(), 'AQI: Manual');
  });

  it('lets the newest city win when the older answer arrives last', async () => {
    const releaseDelhi = session.meteo.defer();
    const releaseLahore = session.meteo.defer();
    const first = liveAqi.enableLive();
    await settle();
    state.city = 'Lahore';
    const second = liveAqi.enableLive();
    await settle();

    releaseLahore(meteoReading(210));
    await settle();
    releaseDelhi(meteoReading(10));
    await settle();

    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.equal(state.aqi, massConcentrationToAqi(210));
    assert.equal(liveAqi.lastReading.city, 'Lahore');
  });

  it('does not let an older failure overwrite a newer success', async () => {
    let failOld;
    session.meteo.push(() => new Promise((_, reject) => {
      failOld = reject;
    }), meteoReading(66));
    liveAqi.enableLive();
    await settle();
    await goLive();

    failOld(new TypeError('late failure'));
    await settle();

    assert.equal(state.aqiNotice, '');
    assert.equal(state.aqiSource, 'live');
  });
});
