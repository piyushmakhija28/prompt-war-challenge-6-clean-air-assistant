/**
 * @fileoverview Unit tests for offline-advisor.js: agreement with computeImpact, category
 * boundaries, profile-dependent wording and PlanFactory coercion.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TYPES,
  IAQ_HACKS_CATALOG,
  PlanFactory,
  frameAdvisory,
  generateOfflineCleanAirPlan,
  getCleaningProtocol,
  toQuantifiedImpact
} from '../../src/js/offline-advisor.js';
import { computeImpact } from '../../src/js/impact-calculator.js';

const BASE = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  vulnBits: 3,
  housingType: 'standard_flat',
  cookingMethod: 'lpg',
  heatingMethod: 'space_heater',
  commuteMode: 'two_wheeler',
  commuteKm: 14,
  simulatedHour: null
});

describe('generateOfflineCleanAirPlan consistency', () => {
  test('test_generateOfflineCleanAirPlan_profileMatrix_agreesWithComputeImpact', () => {
    for (const aqi of [0, 50, 201, 395, 999]) {
      for (const vulnBits of [0, 5, 31]) {
        for (const housingType of ['standard_flat', 'sealed_apartment', 'drafty_home']) {
          for (const commuteMode of ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car']) {
            const ctx = { ...BASE, aqi, vulnBits, housingType, commuteMode, commuteKm: 33 };
            const impact = computeImpact(ctx);
            const plan = generateOfflineCleanAirPlan(ctx);
            const figure = `${impact.pm25AvoidedUg} µg`;
            assert.deepEqual(plan.quantifiedImpact, toQuantifiedImpact(impact));
            assert.ok(plan.communityAdvisory.includes(figure), plan.communityAdvisory);
            assert.ok(plan.bilingualAdvisory.en.includes(figure));
            assert.ok(plan.bilingualAdvisory.hi.includes(figure));
            assert.ok(plan.bilingualAdvisory.en.includes(`AQI ${aqi}`));
            if (commuteMode === 'private_car' || commuteMode === 'two_wheeler') {
              assert.ok(plan.sustainableAlternatives[0].benefit.includes(`${impact.carbonSavedKg} kg CO2e`));
            } else {
              assert.doesNotMatch(plan.sustainableAlternatives[0].benefit, /kg CO2e/);
            }
          }
        }
      }
    }
  });

  test('test_toQuantifiedImpact_summary_mapsEveryField', () => {
    assert.deepEqual(
      toQuantifiedImpact({ pm25AvoidedUg: 1, cigarettesAvoided: 2, carbonSavedKg: 3, protectionScorePercent: 4 }),
      { pm25InhalationAvoidedMicrograms: 1, cigaretteEquivalentsAvoided: 2, co2eSavedKg: 3, protectionScorePercent: 4 }
    );
  });

  test('test_generateOfflineCleanAirPlan_sameInput_isDeterministicAndDoesNotMutate', () => {
    const ctx = Object.freeze({ ...BASE });
    assert.deepEqual(generateOfflineCleanAirPlan(ctx), generateOfflineCleanAirPlan(ctx));
  });

  test('test_generateOfflineCleanAirPlan_anyPlan_satisfiesSchemaAndActionTypes', () => {
    const plan = generateOfflineCleanAirPlan(BASE);
    assert.equal(PlanFactory.validateSchema(plan), true);
    assert.equal(plan.hourlyRoutines.length, 4);
    assert.ok(plan.hourlyRoutines.every((r) => ACTION_TYPES.includes(r.actionType)));
  });

  for (const [aqi, severity] of [
    [0, 'GOOD'], [50, 'GOOD'], [51, 'MODERATE'], [100, 'MODERATE'], [101, 'POOR'], [200, 'POOR'],
    [201, 'VERY_POOR'], [300, 'VERY_POOR'], [301, 'SEVERE'], [400, 'SEVERE'], [401, 'HAZARDOUS'],
    [999, 'HAZARDOUS'], [-10, 'GOOD'], [4000, 'HAZARDOUS']
  ]) {
    test(`test_generateOfflineCleanAirPlan_aqi${aqi}_severity${severity}`, () => {
      assert.equal(generateOfflineCleanAirPlan({ ...BASE, aqi }).severityLevel, severity);
    });
  }

  test('test_generateOfflineCleanAirPlan_morningTrapThreshold_switchesAbove250', () => {
    assert.match(generateOfflineCleanAirPlan({ ...BASE, aqi: 250 }).hourlyRoutines[0].recommendation, /Moderate morning haze/);
    assert.match(generateOfflineCleanAirPlan({ ...BASE, aqi: 251 }).hourlyRoutines[0].recommendation, /inversion trap active/);
  });

  test('test_generateOfflineCleanAirPlan_commuteModes_tailorMorningAdvice', () => {
    const morning = (commuteMode) => generateOfflineCleanAirPlan({ ...BASE, commuteMode }).hourlyRoutines[0].recommendation;
    assert.match(morning('two_wheeler'), /helmet visor/);
    assert.match(morning('walk_cycle'), /cycling\/walking/);
    assert.doesNotMatch(morning('private_car'), /helmet|cycling/);
  });

  test('test_generateOfflineCleanAirPlan_fuelAndHeating_tailorEveningAdvice', () => {
    const evening = (override) => generateOfflineCleanAirPlan({ ...BASE, ...override }).hourlyRoutines[3].recommendation;
    assert.match(evening({ cookingMethod: 'biomass' }), /Biomass/);
    assert.match(evening({ cookingMethod: 'png' }), /Gas burners/);
    assert.doesNotMatch(evening({ cookingMethod: 'induction', heatingMethod: 'heat_pump' }), /Biomass|Gas burners|open flame/);
  });

  test('test_generateOfflineCleanAirPlan_biomassHousehold_namesBiomassAsCurrentChoice', () => {
    const plan = generateOfflineCleanAirPlan({ ...BASE, cookingMethod: 'biomass' });
    assert.equal(plan.sustainableAlternatives[1].currentChoice, 'Biomass / Solid Fuel');
  });

  test('test_generateOfflineCleanAirPlan_inductionHousehold_doesNotClaimGasCooking', () => {
    const plan = generateOfflineCleanAirPlan({ ...BASE, cookingMethod: 'induction' });
    assert.doesNotMatch(plan.sustainableAlternatives[1].currentChoice, /gas/i);
  });

  test('test_generateOfflineCleanAirPlan_hackSelection_optionWinsAndUnknownFallsBack', () => {
    for (const id of Object.keys(IAQ_HACKS_CATALOG)) {
      assert.equal(generateOfflineCleanAirPlan({ ...BASE, hackId: id }).iaqHack.id, id);
    }
    assert.equal(
      generateOfflineCleanAirPlan({ ...BASE, hackId: 'pc_fan_stealth' }, { hackId: 'wet_towel_emergency' }).iaqHack.id,
      'wet_towel_emergency'
    );
    assert.equal(generateOfflineCleanAirPlan({ ...BASE, hackId: 'nope' }).iaqHack.id, 'corsi_rosenthal');
  });

  test('test_generateOfflineCleanAirPlan_hindi_selectsHindiAdvisory', () => {
    const plan = generateOfflineCleanAirPlan({ ...BASE, lang: 'hi' });
    assert.equal(plan.communityAdvisory, plan.bilingualAdvisory.hi);
    assert.match(plan.communityAdvisory, /\p{Script=Devanagari}/u);
  });
});

describe('getCleaningProtocol', () => {
  test('test_getCleaningProtocol_threshold_triggersStrictlyAbove200', () => {
    assert.equal(getCleaningProtocol(200).isTriggered, false);
    assert.equal(getCleaningProtocol(201).isTriggered, true);
    assert.equal(getCleaningProtocol('abc').severity, 'SAFE');
  });
});

describe('frameAdvisory', () => {
  test('test_frameAdvisory_english_addsComputedHeaderAndImpact', () => {
    const text = frameAdvisory('Stay in.', { city: 'Lahore', aqi: 1500 }, { pm25AvoidedUg: 77 }, 'en');
    assert.equal(
      text,
      '🚨 CleanAir Community Advisory for Lahore (AQI 999):\nStay in.\n• Estimated PM2.5 inhalation avoided with these steps: 77 µg per day.'
    );
  });

  test('test_frameAdvisory_missingCity_usesDefault', () => {
    assert.match(frameAdvisory('x', {}, { pm25AvoidedUg: 0 }, 'hi'), /Delhi NCR \(AQI 0\)/);
  });
});

describe('PlanFactory.createPlan', () => {
  for (const raw of [null, undefined, 'plan', 7]) {
    test(`test_createPlan_${String(raw)}Input_returnsSafeDefaultPlan`, () => {
      const plan = PlanFactory.createPlan(raw);
      assert.equal(PlanFactory.validateSchema(plan), true);
      assert.deepEqual(plan.hourlyRoutines, []);
      assert.equal(plan.quantifiedImpact.pm25InhalationAvoidedMicrograms, 0);
      assert.ok(Object.isFrozen(plan));
    });
  }

  test('test_createPlan_emptyObject_fillsEveryRequiredField', () => {
    const plan = PlanFactory.createPlan({});
    assert.equal(PlanFactory.validateSchema(plan), true);
    assert.equal(plan.severityLevel, 'MODERATE');
    assert.deepEqual(plan.iaqHack.materials, []);
    assert.deepEqual(plan.iaqHack.steps, []);
    assert.equal(plan.cleaningProtocol, null);
    assert.equal(plan.communityAdvisory, '');
  });

  test('test_createPlan_malformedRoutines_dropsNonObjectsAndCoercesActionType', () => {
    const plan = PlanFactory.createPlan({
      hourlyRoutines: [null, 'x', 5, { activity: 'a', actionType: 'LAUNCH' }, { actionType: 'SEAL_HOME' }]
    });
    assert.deepEqual(plan.hourlyRoutines.map((r) => r.actionType), ['SHIFT_INDOORS', 'SEAL_HOME']);
    assert.ok(Object.isFrozen(plan.hourlyRoutines[0]));
  });

  test('test_createPlan_nonArrayCollections_becomeEmptyArrays', () => {
    const plan = PlanFactory.createPlan({
      hourlyRoutines: 'none',
      sustainableAlternatives: {},
      iaqHack: { title: 'T', materials: 'tape', steps: 3 }
    });
    assert.deepEqual(plan.hourlyRoutines, []);
    assert.deepEqual(plan.sustainableAlternatives, []);
    assert.deepEqual(plan.iaqHack, { title: 'T', materials: [], steps: [] });
  });

  test('test_createPlan_impactStrings_areCoercedAndScoreClamped', () => {
    const make = (protectionScorePercent) => PlanFactory.createPlan({
      quantifiedImpact: { pm25InhalationAvoidedMicrograms: '12', co2eSavedKg: 'x', protectionScorePercent }
    }).quantifiedImpact;
    assert.equal(make(101).protectionScorePercent, 100);
    assert.equal(make(-1).protectionScorePercent, 0);
    assert.equal(make('abc').protectionScorePercent, 0);
    assert.equal(make(50).pm25InhalationAvoidedMicrograms, 12);
    assert.equal(make(50).co2eSavedKg, 0);
  });

  test('test_validateSchema_missingOrWrongTypedField_returnsFalse', () => {
    const good = generateOfflineCleanAirPlan(BASE);
    for (const field of ['severityLevel', 'diurnalWindowNotice', 'hourlyRoutines', 'iaqHack', 'sustainableAlternatives', 'quantifiedImpact', 'communityAdvisory']) {
      assert.equal(PlanFactory.validateSchema({ ...good, [field]: undefined }), false, field);
    }
    assert.equal(PlanFactory.validateSchema(null), false);
  });
});
