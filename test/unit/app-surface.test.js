/**
 * @fileoverview The browser-facing surface of app.js, run against a minimal window and
 * document: the frozen test handles, the impact breakdown and the protected dose label.
 */

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

const EXPOSED_IDS = Object.freeze([
  'impact-contributions', 'impact-breakdown-container', 'label-protected-desc', 'metric-pm25-avoided'
]);

/**
 * Creates the smallest element the render path writes to.
 *
 * @returns {Object} Element double.
 */
function createElement() {
  const attributes = new Map();
  return {
    textContent: '',
    children: [],
    get firstChild() {
      return this.children[0] || null;
    },
    appendChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null
  };
}

const elements = Object.fromEntries(EXPOSED_IDS.map((id) => [id, createElement()]));
let app;
let catalog;

before(async () => {
  globalThis.window = { addEventListener: () => {} };
  globalThis.document = {
    readyState: 'loading',
    getElementById: (id) => elements[id] ?? null,
    createElement
  };
  app = await import('../../src/js/app.js');
  catalog = (await import('../../src/js/offline-advisor.js')).IAQ_HACKS_CATALOG;
});

/**
 * Recalculates for a household and waits for the queued DOM writes.
 *
 * @param {Object} overrides - Household fields to replace in the hand-worked reference home.
 * @returns {Promise<void>}
 */
async function render(overrides = {}) {
  Object.assign(app.state, {
    aqi: 400,
    vulnBits: 0,
    housingType: 'standard_flat',
    cookingMethod: 'induction',
    heatingMethod: 'heat_pump',
    commuteMode: 'public_transit',
    commuteKm: 15,
    activeHackId: 'corsi_rosenthal',
    ...overrides
  });
  app.executeOptimisticRecalculation();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('window.__cleanAirTestUtils', () => {
  test('test_testUtils_browserImport_isFrozenWithOnlyThreeHandles', () => {
    const utils = window.__cleanAirTestUtils;
    assert.equal(Object.isFrozen(utils), true);
    assert.deepEqual(Object.keys(utils).sort(), ['circuitBreaker', 'hasApiKey', 'state']);
    assert.equal(utils.state, app.state);
    assert.equal(utils.circuitBreaker, app.planProvider.circuitBreaker);
  });

  test('test_testUtils_browserImport_publishesNoProviderOrKeyStoreGlobals', () => {
    assert.equal('planProvider' in window, false);
    assert.equal('keyStore' in window, false);
  });

  test('test_hasApiKey_storeThenPurge_reportsPresenceAsABooleanOnly', () => {
    const { hasApiKey } = window.__cleanAirTestUtils;
    assert.equal(hasApiKey(), false);
    app.keyStore.setKey('test-key-123');
    assert.equal(hasApiKey(), true);
    app.keyStore.purge();
    assert.equal(hasApiKey(), false);
  });
});

describe('impact breakdown rendering', () => {
  test('test_renderActivePlan_referenceHome_showsTheHandWorkedContributions', async () => {
    await render();
    assert.equal(elements['metric-pm25-avoided'].textContent, '421 µg');
    assert.equal(
      elements['impact-contributions'].textContent,
      'Avoided today: indoor air 338 µg · window timing 61 µg · travel 22 µg'
    );
  });

  test('test_renderActivePlan_repeatedRenders_listsEachChoiceExactlyOnce', async () => {
    await render();
    await render({ cookingMethod: 'lpg' });
    const items = elements['impact-breakdown-container'].children;
    assert.deepEqual(
      items.map((item) => item.getAttribute('data-choice')),
      ['iaq_hack', 'cooking', 'heating', 'commute', 'housing']
    );
    assert.match(items[1].textContent, /^LPG: switching to "Induction" would /);
  });

  test('test_describeProtection_metroRiderOnASevereDay_namesFilterMaskAndTiming', async () => {
    await render();
    assert.equal(
      elements['label-protected-desc'].textContent,
      `🟢 With CleanAir Plan (${catalog.corsi_rosenthal.title} / N95 outdoors / timed airing)`
    );
  });

  test('test_describeProtection_driverWithAnotherHack_namesThatHackAndRecirculation', async () => {
    await render({ commuteMode: 'private_car', activeHackId: 'pc_fan_stealth' });
    assert.equal(
      elements['label-protected-desc'].textContent,
      `🟢 With CleanAir Plan (${catalog.pc_fan_stealth.title} / car air recirculation / timed airing)`
    );
  });

  test('test_describeProtection_cleanDay_saysNoExtraProtectionIsNeeded', async () => {
    await render({ aqi: 30 });
    assert.equal(
      elements['label-protected-desc'].textContent,
      '🟢 With CleanAir Plan (no extra protection needed today)'
    );
  });
});
