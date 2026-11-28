/**
 * @fileoverview The app.js advice pipeline run headless against the real GeminiPlanProvider
 * and a scripted transport: dispatch, debounce, latest-wins, dedupe, caching, key lifecycle,
 * automatic retry and agreement between state, plan and advisory figures.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  state, keyStore, planProvider, applyManualAqi, schedulePlanGeneration, triggerPlanGeneration,
  executeOptimisticRecalculation, describeAdviceSource, ADVICE_DEBOUNCE_MS, MAX_AUTO_RESUMES
} from '../../src/js/app.js';
import { GEMINI_MODELS_CASCADE } from '../../src/js/gemini-service.js';
import { computeImpact } from '../../src/js/impact-calculator.js';
import { generateOfflineCleanAirPlan } from '../../src/js/offline-advisor.js';
import { FAKE_KEY, factsOf, modelPlan, settle, reply } from './helpers/fakes.js';
import {
  startSession, endSession, advance, holdKey, saveKey, clearKey, generate, installStatusElements
} from './helpers/app-harness.js';

const MODELS = GEMINI_MODELS_CASCADE.length;
let session;

/**
 * Queues one answer per cascade model so that a whole generation meets the same failure.
 *
 * @param {Function} behaviour - Failure behaviour.
 */
function failGeneration(behaviour) {
  session.gemini.push(...Array.from({ length: MODELS }, () => behaviour));
}

/**
 * Activity text of the first routine on screen.
 *
 * @returns {string}
 */
function firstActivity() {
  return state.activePlan.hourlyRoutines[0].activity;
}

/**
 * Asserts that the plan on screen carries the figures of the current inputs.
 */
function assertFiguresCurrent() {
  const impact = computeImpact(state);
  assert.deepEqual(state.activePlan.quantifiedImpact, {
    pm25InhalationAvoidedMicrograms: impact.pm25AvoidedUg,
    cigaretteEquivalentsAvoided: impact.cigarettesAvoided,
    co2eSavedKg: impact.carbonSavedKg,
    protectionScorePercent: impact.protectionScorePercent
  });
  assert.ok(state.activePlan.communityAdvisory.includes(`(AQI ${state.aqi}`), state.activePlan.communityAdvisory);
  assert.ok(state.activePlan.communityAdvisory.includes(`${impact.pm25AvoidedUg} µg`));
  assert.ok(state.activePlan.communityAdvisory.includes(state.city));
}

beforeEach(() => {
  session = startSession();
});

afterEach(async () => {
  await endSession();
});

describe('pipeline without a key', () => {
  it('renders the on-device plan at once and calls nothing', async () => {
    schedulePlanGeneration(0);
    await settle();

    assert.equal(session.gemini.calls.length, 0);
    assert.equal(state.activeStrategy, 'OFFLINE_DETERMINISTIC');
    assert.equal(state.advicePhase, 'idle');
    assert.equal(describeAdviceSource(), 'Advice: Offline (on-device)');
    assertFiguresCurrent();
    assert.deepEqual(session.events.map((e) => e.name), ['CONTEXT_CHANGED', 'PLAN_GENERATED']);
  });

  it('recalculates figures immediately on input change without ever calling Gemini', async () => {
    applyManualAqi(120);
    assertFiguresCurrent();
    await advance(60 * 60 * 1000);

    assert.equal(session.gemini.calls.length, 0);
    assert.equal(state.advicePhase, 'idle');
  });
});

describe('dispatch and debounce', () => {
  it('shows the refresh phase while waiting and the Gemini advice afterwards', async () => {
    holdKey();
    const release = session.gemini.defer();
    const pending = triggerPlanGeneration();
    await settle();

    assert.equal(state.advicePhase, 'fetching');
    assert.equal(describeAdviceSource(), 'Advice: Refreshing');
    assertFiguresCurrent();

    release(reply.ok('first'));
    await pending;

    assert.equal(state.advicePhase, 'idle');
    assert.equal(state.activeStrategy, 'GEMINI_3_5_FLASH_LITE');
    assert.equal(describeAdviceSource(), `Advice: Gemini ${GEMINI_MODELS_CASCADE[0]}`);
    assert.equal(firstActivity(), 'Morning shield first');
    assertFiguresCurrent();
    assert.equal(session.events.at(-1).name, 'PLAN_GENERATED');
  });

  it('waits for the full debounce period before dispatching', async () => {
    holdKey();
    session.gemini.otherwise(reply.ok());

    applyManualAqi(200);
    assert.equal(state.advicePhase, 'debounce');
    await advance(ADVICE_DEBOUNCE_MS - 1);
    assert.equal(session.gemini.calls.length, 0);
    await advance(1);

    assert.equal(session.gemini.calls.length, 1);
  });

  it('turns a fast slider drag into exactly one request for the final value', async () => {
    holdKey();
    session.gemini.otherwise(reply.ok('drag'));

    for (let aqi = 100; aqi <= 300; aqi += 5) {
      applyManualAqi(aqi);
      assertFiguresCurrent();
      await advance(50);
    }
    assert.equal(session.gemini.calls.length, 0);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 1);
    assert.equal(factsOf(session.gemini.calls[0]).aqi, 300);
    assert.deepEqual(factsOf(session.gemini.calls[0]).computed.pm25AvoidedUg, computeImpact(state).pm25AvoidedUg);
    assert.equal(firstActivity(), 'Morning shield drag');
  });

  it('lets Recalculate dispatch at once and swallow the pending debounce', async () => {
    holdKey();
    session.gemini.otherwise(reply.ok());

    applyManualAqi(210);
    schedulePlanGeneration(0, { force: true });
    await settle();
    await advance(ADVICE_DEBOUNCE_MS * 3);

    assert.equal(session.gemini.calls.length, 1);
    assert.equal(factsOf(session.gemini.calls[0]).aqi, 210);
  });
});

describe('latest request wins', () => {
  it('aborts the running request as soon as an input changes, before the debounce fires', async () => {
    holdKey();
    session.gemini.push(reply.hang());
    triggerPlanGeneration();
    await settle();

    applyManualAqi(180);

    assert.equal(session.gemini.calls[0].init.signal.aborted, true);
    assert.equal(state.advicePhase, 'debounce');
    assert.equal(session.gemini.calls.length, 1);
    assertFiguresCurrent();
  });

  it('ignores an older response that arrives after the newer one', async () => {
    holdKey();
    const releaseOld = session.gemini.defer();
    const releaseNew = session.gemini.defer();

    applyManualAqi(100);
    await advance(ADVICE_DEBOUNCE_MS);
    applyManualAqi(400);
    await advance(ADVICE_DEBOUNCE_MS);
    releaseNew(reply.ok('newer'));
    await settle();
    releaseOld(reply.ok('older'));
    await settle();

    assert.equal(firstActivity(), 'Morning shield newer');
    assert.equal(factsOf(session.gemini.calls[1]).aqi, 400);
    assert.equal(JSON.parse(state.adviceCache.fingerprint).aqi, 400);
    assert.equal(state.advicePhase, 'idle');
    assertFiguresCurrent();
  });

  it('ignores an older response that arrives before the newer request is dispatched', async () => {
    holdKey();
    const releaseOld = session.gemini.defer();
    session.gemini.otherwise(reply.ok('newer'));
    triggerPlanGeneration();
    await settle();

    applyManualAqi(150);
    releaseOld(reply.ok('older'));
    await settle();

    assert.equal(state.adviceCache, null);
    assert.notEqual(firstActivity(), 'Morning shield older');
    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(firstActivity(), 'Morning shield newer');
  });

  it('does not let a superseded failure disturb the newer advice', async () => {
    holdKey();
    const releaseOld = session.gemini.defer();
    session.gemini.otherwise(reply.ok('newer'));
    triggerPlanGeneration();
    await settle();
    applyManualAqi(150);
    await advance(ADVICE_DEBOUNCE_MS);

    releaseOld(reply.badKey());
    await settle();

    assert.equal(firstActivity(), 'Morning shield newer');
    assert.equal(planProvider.rejectedKeyVersion, null);
    assert.equal(session.events.filter((e) => e.name === 'PLAN_ERROR').length, 0);
    assert.equal(session.gemini.calls.length, 2);
  });

  it('sends only the final inputs when a change is undone within the debounce', async () => {
    holdKey();
    session.gemini.push(reply.ok('stable'));
    await generate();
    const original = state.aqi;

    applyManualAqi(150);
    applyManualAqi(original);
    await advance(ADVICE_DEBOUNCE_MS * 2);

    assert.equal(session.gemini.calls.length, 1);
    assert.equal(state.advicePhase, 'idle');
    assert.equal(firstActivity(), 'Morning shield stable');
    assertFiguresCurrent();
  });
});

describe('identical input dedupe and cache reuse', () => {
  it('joins the running request instead of starting a second one', async () => {
    holdKey();
    const release = session.gemini.defer();

    const first = triggerPlanGeneration();
    const second = triggerPlanGeneration();
    const forced = triggerPlanGeneration(null, { force: true });
    await settle();
    release(reply.ok('joined'));
    await Promise.all([first, second, forced]);

    assert.equal(session.gemini.calls.length, 1);
    assert.equal(session.gemini.calls[0].init.signal.aborted, false);
    assert.equal(firstActivity(), 'Morning shield joined');
  });

  it('keeps the running request when only non-advice inputs change', async () => {
    holdKey();
    const release = session.gemini.defer();
    const pending = triggerPlanGeneration();
    await settle();

    state.simulatedHour = 19;
    state.advisoryLang = 'hi';
    schedulePlanGeneration();
    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(state.advicePhase, 'fetching');
    release(reply.ok('kept'));
    await pending;

    assert.equal(session.gemini.calls.length, 1);
    assert.equal(session.gemini.calls[0].init.signal.aborted, false);
    assert.equal(firstActivity(), 'Morning shield kept');
  });

  it('replaces the running request when the indoor air hack is switched mid-flight', async () => {
    holdKey();
    session.gemini.push(reply.hang());
    session.gemini.otherwise(reply.ok('hack'));
    triggerPlanGeneration();
    await settle();

    state.activeHackId = 'pc_fan_stealth';
    schedulePlanGeneration();

    assert.equal(session.gemini.calls[0].init.signal.aborted, true);
    assert.equal(state.advicePhase, 'debounce');
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
    const hack = factsOf(session.gemini.calls[1]).choices.find((c) => c.choice === 'iaq_hack');
    assert.equal(hack.current, 'pc_fan_stealth');
    assert.equal(state.activePlan.iaqHack.id, 'pc_fan_stealth');
    assert.equal(firstActivity(), 'Morning shield hack');
  });

  it('drops a model insight at once when the choice it was written for changes', async () => {
    holdKey();
    state.commuteMode = 'two_wheeler';
    const insight = { choice: 'commute', alternative: 'Ride the metro', whyItMatters: 'Cleaner air on the way.' };
    session.gemini.push(reply.text(JSON.stringify({ ...modelPlan('insight'), choiceInsights: [insight] })));
    await generate();
    const shown = () => JSON.stringify(state.activePlan.sustainableAlternatives).includes('Ride the metro');
    assert.equal(shown(), true);

    state.commuteMode = 'private_car';
    executeOptimisticRecalculation();

    assert.equal(shown(), false);
    assert.equal(firstActivity(), 'Morning shield insight');
  });

  const localOnly = [
    ['repeating the same inputs', () => {}],
    ['moving the simulated time', () => { state.simulatedHour = 19.5; }],
    ['re-selecting the current hack', () => { state.activeHackId = 'corsi_rosenthal'; }],
    ['switching language', () => { state.advisoryLang = 'hi'; }],
    ['re-entering the same AQI', () => { applyManualAqi(state.aqi); }]
  ];

  for (const [label, change] of localOnly) {
    it(`makes no new call when ${label}`, async () => {
      holdKey();
      session.gemini.push(reply.ok('cached'));
      await generate();

      change();
      schedulePlanGeneration();
      assert.equal(state.advicePhase, 'idle');
      await advance(ADVICE_DEBOUNCE_MS * 2);

      assert.equal(session.gemini.calls.length, 1);
      assert.equal(firstActivity(), 'Morning shield cached');
      assert.equal(state.activeStrategy, 'GEMINI_3_5_FLASH_LITE');
    });
  }

  it('shows the cached Hindi advisory with current figures after a language switch', async () => {
    holdKey();
    session.gemini.push(reply.ok('bilingual'));
    await generate();

    state.advisoryLang = 'hi';
    executeOptimisticRecalculation();

    assert.match(state.activePlan.communityAdvisory, /bilingual।/);
    assert.ok(state.activePlan.communityAdvisory.includes(`${computeImpact(state).pm25AvoidedUg} µg`));
    assert.equal(session.gemini.calls.length, 1);
  });

  const adviceInputs = [
    ['city', () => { state.city = 'Lahore'; }, 'city', 'Lahore'],
    ['AQI', () => { applyManualAqi(111); }, 'aqi', 111],
    ['AQI source', () => { state.aqiSource = 'live'; }, 'aqiSource', 'live'],
    ['vulnerabilities', () => { state.vulnBits = 4; }, 'vulnerabilities', ['senior']],
    ['housing', () => { state.housingType = 'drafty_home'; }, 'housingType', 'drafty_home'],
    ['cooking', () => { state.cookingMethod = 'biomass'; }, 'cookingMethod', 'biomass'],
    ['heating', () => { state.heatingMethod = 'heat_pump'; }, 'heatingMethod', 'heat_pump'],
    ['commute mode', () => { state.commuteMode = 'private_car'; }, 'commuteMode', 'private_car'],
    ['commute distance', () => { state.commuteKm = 33; }, 'commuteKm', 33]
  ];

  it('makes exactly one grounded call when the indoor air hack changes', async () => {
    holdKey();
    session.gemini.push(reply.ok('before'), reply.ok('after'));
    await generate();

    state.activeHackId = 'wet_towel_emergency';
    schedulePlanGeneration();
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, 2);
    const facts = factsOf(session.gemini.calls[1]);
    assert.equal(facts.choices.find((c) => c.choice === 'iaq_hack').current, 'wet_towel_emergency');
    assert.equal(facts.computed.pm25AvoidedUg, computeImpact({ ...state, hackId: state.activeHackId }).pm25AvoidedUg);
    assert.equal(firstActivity(), 'Morning shield after');
  });

  for (const [label, change, field, expected] of adviceInputs) {
    it(`makes exactly one grounded call when ${label} changes`, async () => {
      holdKey();
      session.gemini.push(reply.ok('before'), reply.ok('after'));
      await generate();

      change();
      schedulePlanGeneration();
      await advance(ADVICE_DEBOUNCE_MS);

      assert.equal(session.gemini.calls.length, 2);
      const facts = factsOf(session.gemini.calls[1]);
      assert.deepEqual(facts[field], expected);
      assert.equal(facts.computed.pm25AvoidedUg, computeImpact(state).pm25AvoidedUg);
      assert.equal(firstActivity(), 'Morning shield after');
      assertFiguresCurrent();
    });
  }

  it('re-frames cached advice with the new numbers until the replacement arrives', async () => {
    holdKey();
    session.gemini.push(reply.ok('old'));
    const release = session.gemini.defer();
    await generate();
    const before = state.activePlan.communityAdvisory;

    applyManualAqi(90);

    assert.equal(firstActivity(), 'Morning shield old');
    assert.equal(state.activeStrategy, 'GEMINI_3_5_FLASH_LITE');
    assert.match(state.activePlan.communityAdvisory, /old\./);
    assert.notEqual(state.activePlan.communityAdvisory, before);
    assert.equal(state.activePlan.severityLevel, 'MODERATE');
    assertFiguresCurrent();

    await advance(ADVICE_DEBOUNCE_MS);
    assert.equal(firstActivity(), 'Morning shield old');
    assert.equal(state.advicePhase, 'fetching');
    release(reply.ok('new'));
    await settle();
    assert.equal(firstActivity(), 'Morning shield new');
  });

  it('forced refresh calls Gemini again for identical inputs and replaces the advice', async () => {
    holdKey();
    session.gemini.push(reply.ok('one'), reply.ok('two'));
    await generate();

    schedulePlanGeneration(0, { force: true });
    await settle();

    assert.equal(session.gemini.calls.length, 2);
    assert.equal(session.gemini.calls[0].init.body, session.gemini.calls[1].init.body);
    assert.equal(firstActivity(), 'Morning shield two');
  });
});

describe('key lifecycle', () => {
  it('uses a saved key at once in the header only and never stores it in state', async () => {
    const elements = installStatusElements();
    session.gemini.push(reply.ok());

    await saveKey(FAKE_KEY);

    assert.equal(session.gemini.calls[0].init.headers['x-goog-api-key'], FAKE_KEY);
    assert.match(elements['key-status-text'].textContent, /verified/);
    for (const text of [JSON.stringify(state), session.consoleLines.join('\n'),
      JSON.stringify(session.events), JSON.stringify(globalThis.__CLEANAIR_TELEMETRY__),
      session.gemini.calls[0].url, session.gemini.calls[0].init.body]) {
      assert.equal(text.includes(FAKE_KEY), false);
    }
  });

  for (const [label, value] of [['blank', '   '], ['non-ASCII', 'क-key'], ['containing a space', 'two words']]) {
    it(`stays offline when the entered value is ${label}`, async () => {
      await saveKey(value);

      assert.equal(session.gemini.calls.length, 0);
      assert.equal(keyStore.hasKey(), false);
      assert.equal(state.activeStrategy, 'OFFLINE_DETERMINISTIC');
    });
  }

  for (const [label, behaviour] of [['400', reply.badKey()], ['401', reply.status(401)], ['403', reply.status(403)]]) {
    it(`reports a ${label} rejection, queues nothing and sends the key no more`, async () => {
      const elements = installStatusElements();
      session.gemini.push(behaviour);

      await saveKey();
      assert.equal(state.activeStrategy, 'OFFLINE_KEY_REJECTED');
      assert.equal(state.adviceCache, null);
      assert.equal(state.advicePhase, 'idle');
      assert.match(elements['key-status-text'].textContent, /rejected/);
      assert.match(elements['status-banner'].textContent, /rejected this API key/);

      await advance(10 * 60 * 1000);
      assert.equal(elements['status-banner'].classList.contains('hidden'), false);
      applyManualAqi(140);
      await advance(ADVICE_DEBOUNCE_MS);

      assert.equal(session.gemini.calls.length, 1);
      assert.equal(state.activeStrategy, 'OFFLINE_KEY_REJECTED');
      assertFiguresCurrent();
    });
  }

  it('drops advice already on screen when the key is rejected later', async () => {
    holdKey();
    session.gemini.push(reply.ok('good'), reply.status(403));
    await generate();

    applyManualAqi(140);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(state.adviceCache, null);
    assert.deepEqual(state.activePlan.hourlyRoutines, generateOfflineCleanAirPlan(state).hourlyRoutines);
    assert.equal(describeAdviceSource(), 'Advice: Offline (on-device)');
  });

  it('recovers when a new key is saved after a rejection', async () => {
    const elements = installStatusElements();
    session.gemini.push(reply.badKey(), reply.ok('second-key'));
    await saveKey();

    await saveKey('test-key-456');

    assert.equal(session.gemini.calls[1].init.headers['x-goog-api-key'], 'test-key-456');
    assert.equal(firstActivity(), 'Morning shield second-key');
    assert.match(elements['key-status-text'].textContent, /verified/);
    assert.equal(elements['status-banner'].classList.contains('hidden'), true);
  });

  it('purging mid-flight aborts the request and discards a late answer', async () => {
    const elements = installStatusElements();
    const release = session.gemini.defer();
    await saveKey();

    await clearKey();
    release(reply.ok('late'));
    await advance(10 * 60 * 1000);

    assert.equal(session.gemini.calls[0].init.signal.aborted, true);
    assert.equal(session.gemini.calls.length, 1);
    assert.equal(state.adviceCache, null);
    assert.equal(state.activeStrategy, 'OFFLINE_DETERMINISTIC');
    assert.equal(state.advicePhase, 'idle');
    assert.equal(elements['btn-generate-plan'].disabled, false);
    assert.doesNotMatch(elements['key-status-text'].textContent, /verified/);
  });

  it('discards an answer for a purged key even when nothing aborted the request', async () => {
    holdKey();
    const release = session.gemini.defer();
    const pending = triggerPlanGeneration();
    await settle();

    keyStore.purge();
    release(reply.ok('orphan'));
    await pending;

    assert.equal(state.adviceCache, null);
    assert.equal(state.activeStrategy, 'OFFLINE_DETERMINISTIC');
    assert.notEqual(firstActivity(), 'Morning shield orphan');
    assert.equal(state.advicePhase, 'idle');
  });

  it('removes cached Gemini advice as soon as the key is cleared', async () => {
    session.gemini.push(reply.ok('gone'));
    await saveKey();

    await clearKey();

    assert.deepEqual(state.activePlan.hourlyRoutines, generateOfflineCleanAirPlan(state).hourlyRoutines);
    assert.equal(state.adviceCache, null);
  });

  it('asks again after the same key is re-entered', async () => {
    session.gemini.push(reply.ok('one'), reply.ok('two'));
    await saveKey();
    await clearKey();

    await saveKey();

    assert.equal(session.gemini.calls.length, 2);
    assert.equal(firstActivity(), 'Morning shield two');
  });

  it('replacing the key mid-flight drops the old request', async () => {
    const releaseOld = session.gemini.defer();
    session.gemini.otherwise(reply.ok('new-key'));
    await saveKey();

    state.adviceCache = null;
    keyStore.setKey('test-key-456');
    schedulePlanGeneration(0, { force: true });
    await settle();
    releaseOld(reply.badKey());
    await settle();

    assert.equal(session.gemini.calls[0].init.signal.aborted, true);
    assert.equal(firstActivity(), 'Morning shield new-key');
    assert.equal(planProvider.rejectedKeyVersion, null);
  });
});

describe('queued automatic retry', () => {
  it('queues one retry for a quota reply and applies its answer', async () => {
    holdKey();
    failGeneration(reply.quota('20s'));
    session.gemini.push(reply.ok('resumed'));
    await generate();

    assert.equal(state.advicePhase, 'queued');
    assert.equal(describeAdviceSource(), 'Advice: Refresh queued');
    assertFiguresCurrent();

    await advance(19999);
    assert.equal(session.gemini.calls.length, MODELS);
    await advance(1);

    assert.equal(session.gemini.calls.length, MODELS + 1);
    assert.equal(firstActivity(), 'Morning shield resumed');
    assert.equal(state.advicePhase, 'idle');
    await advance(10 * 60 * 1000);
    assert.equal(session.gemini.calls.length, MODELS + 1);
  });

  it('reads the latest inputs when the retry fires', async () => {
    holdKey();
    failGeneration(reply.quota('20s'));
    session.gemini.push(reply.ok('latest'));
    await generate();

    state.commuteKm = 41;
    await advance(20000);

    assert.equal(factsOf(session.gemini.calls.at(-1)).commuteKm, 41);
  });

  it(`stops after ${MAX_AUTO_RESUMES} automatic retries and says so`, async () => {
    const elements = installStatusElements();
    holdKey();
    session.gemini.otherwise(reply.quota('20s'));
    await generate();

    for (let retry = 1; retry <= MAX_AUTO_RESUMES; retry++) {
      assert.equal(state.advicePhase, 'queued', `before retry ${retry}`);
      await advance(20000);
      assert.equal(session.gemini.calls.length, MODELS * (retry + 1));
    }

    assert.equal(state.advicePhase, 'idle');
    assert.equal(elements['status-banner'].textContent, 'Gemini is still unavailable. Press Recalculate to retry.');
    await advance(60 * 60 * 1000);
    assert.equal(session.gemini.calls.length, MODELS * (MAX_AUTO_RESUMES + 1));
  });

  it('grants a fresh set of retries after Recalculate', async () => {
    holdKey();
    session.gemini.otherwise(reply.quota('20s'));
    await generate();
    for (let retry = 0; retry < MAX_AUTO_RESUMES; retry++) await advance(20000);
    await advance(20000);

    schedulePlanGeneration(0, { force: true });
    await settle();

    assert.equal(state.advicePhase, 'queued');
    await advance(20000);
    assert.equal(session.gemini.calls.length, MODELS * (MAX_AUTO_RESUMES + 3));
  });

  it('keeps cached advice visible while queued and drops it once retries are exhausted', async () => {
    holdKey();
    session.gemini.push(reply.ok('held'));
    session.gemini.otherwise(reply.quota('20s'));
    await generate();

    applyManualAqi(250);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(state.advicePhase, 'queued');
    assert.equal(firstActivity(), 'Morning shield held');
    assertFiguresCurrent();

    for (let retry = 0; retry < MAX_AUTO_RESUMES; retry++) await advance(20000);

    assert.equal(state.advicePhase, 'idle');
    assert.equal(state.adviceCache, null);
    assert.equal(state.activeStrategy, 'OFFLINE_RATE_LIMITED');
    assert.deepEqual(state.activePlan.hourlyRoutines, generateOfflineCleanAirPlan(state).hourlyRoutines);
  });

  it('retries a forced Recalculate that failed temporarily while advice was cached', async () => {
    holdKey();
    session.gemini.push(reply.ok('before-recalculate'));
    await generate();
    failGeneration(reply.quota('20s'));
    session.gemini.push(reply.ok('after-recalculate'));

    schedulePlanGeneration(0, { force: true });
    await settle();
    assert.equal(state.advicePhase, 'queued');
    await advance(20000);

    assert.equal(session.gemini.calls.length, MODELS + 2, 'the queued retry never reached Gemini');
    assert.equal(firstActivity(), 'Morning shield after-recalculate');
  });

  it('retries a forced Recalculate that the local rate limit refused', async () => {
    holdKey();
    session.gemini.otherwise(reply.ok('burst'));
    for (let i = 0; i < 3; i++) await generate({ force: true });

    schedulePlanGeneration(0, { force: true });
    await settle();
    assert.equal(state.advicePhase, 'queued');
    await advance(13000);

    assert.equal(session.gemini.calls.length, 4, 'the queued retry never reached Gemini');
  });

  it('queues changed inputs refused by the local rate limit and sends them after refill', async () => {
    holdKey();
    session.gemini.push(reply.ok('a'), reply.ok('b'), reply.ok('c'), reply.ok('d'));
    for (const aqi of [100, 150, 200]) {
      state.aqi = aqi;
      await generate();
    }

    state.aqi = 250;
    await generate();
    assert.equal(session.gemini.calls.length, 3);
    assert.equal(state.advicePhase, 'queued');
    await advance(12100);

    assert.equal(session.gemini.calls.length, 4);
    assert.equal(factsOf(session.gemini.calls[3]).aqi, 250);
    assert.equal(firstActivity(), 'Morning shield d');
  });

  it('cancels the queued retry when an input changes and sends the new inputs once', async () => {
    holdKey();
    failGeneration(reply.quota('20s'));
    session.gemini.otherwise(reply.ok('changed'));
    await generate();

    await advance(19500);
    applyManualAqi(130);
    await advance(500);
    assert.equal(session.gemini.calls.length, MODELS);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(session.gemini.calls.length, MODELS + 1);
    assert.equal(factsOf(session.gemini.calls.at(-1)).aqi, 130);
  });

  it('cancels the queued retry when the key is cleared', async () => {
    failGeneration(reply.quota('20s'));
    await saveKey();

    await clearKey();
    await advance(10 * 60 * 1000);

    assert.equal(session.gemini.calls.length, MODELS);
    assert.equal(state.advicePhase, 'idle');
  });

  it('recovers through an open circuit breaker without user action', async () => {
    holdKey();
    failGeneration(reply.status(500));
    failGeneration(reply.status(500));
    session.gemini.push(reply.ok('recovered'));
    await generate();
    assert.equal(state.advicePhase, 'idle');
    assert.equal(state.activeStrategy, 'OFFLINE_FALLBACK');

    await generate();
    assert.equal(state.advicePhase, 'queued');
    assert.equal(planProvider.circuitBreaker.getState(), 'OPEN');
    await advance(30000);

    assert.equal(planProvider.circuitBreaker.getState(), 'CLOSED');
    assert.equal(firstActivity(), 'Morning shield recovered');
  });

  it('offers no automatic retry for a long quota delay and drops stale advice', async () => {
    const elements = installStatusElements();
    holdKey();
    session.gemini.push(reply.ok('stale'));
    await generate();
    failGeneration(reply.quota('3600s'));

    applyManualAqi(140);
    await advance(ADVICE_DEBOUNCE_MS);

    assert.equal(state.advicePhase, 'idle');
    assert.equal(state.adviceCache, null);
    assert.equal(state.activeStrategy, 'OFFLINE_RATE_LIMITED');
    assert.match(elements['status-banner'].textContent, /unavailable/);
    await advance(2 * 3600 * 1000);
    assert.equal(session.gemini.calls.length, MODELS + 1);
  });

  it('releases the Recalculate button and hides the banner after success', async () => {
    const elements = installStatusElements();
    holdKey();
    failGeneration(reply.quota('20s'));
    const release = session.gemini.defer();
    await generate();
    assert.equal(elements['btn-generate-plan'].disabled, false);
    assert.equal(elements['plan-spinner-text'].textContent, 'Refresh queued');

    await advance(20000);
    assert.equal(elements['btn-generate-plan'].disabled, true);
    release(reply.ok());
    await settle();

    assert.equal(elements['btn-generate-plan'].disabled, false);
    assert.equal(elements['btn-generate-plan'].textContent, 'Recalculate Clean Air Plan');
    assert.equal(elements['status-banner'].classList.contains('hidden'), true);
    assert.equal(elements['plan-spinner'].classList.contains('hidden'), true);
  });
});
