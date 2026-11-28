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
import { VULN_FLAGS } from '../../src/js/config.js';

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

  for (const [aqi, opening] of [
    [100, /outdoor exercise and school travel are fine/],
    [101, /keep hard exercise away from traffic/],
    [200, /keep hard exercise away from traffic/],
    [201, /keep windows closed/]
  ]) {
    test(`test_generateOfflineCleanAirPlan_otherHouseholdAt${aqi}_opensMorningByPolicy`, () => {
      const plan = generateOfflineCleanAirPlan({ ...BASE, vulnBits: 0, aqi });
      assert.match(plan.hourlyRoutines[0].recommendation, opening);
    });
  }

  for (const [commuteMode, alertAdvice, calmAdvice, advisesMask] of [
    ['two_wheeler', /close the helmet visor/, /A normal two-wheeler ride is fine/, true],
    ['walk_cycle', /Walking or cycling: take quieter streets/, /A good morning to walk or cycle/, true],
    ['public_transit', /Metro: wait inside the station/, /A normal metro trip is fine/, true],
    ['private_car', /set the ventilation to recirculate/, /A normal drive is fine/, false]
  ]) {
    test(`test_generateOfflineCleanAirPlan_${commuteMode}_tailorsMorningAdviceToTheDay`, () => {
      const morning = (aqi) => generateOfflineCleanAirPlan({ ...BASE, aqi, commuteMode }).hourlyRoutines[0].recommendation;
      assert.match(morning(395), alertAdvice);
      assert.match(morning(30), calmAdvice);
      assert.equal(morning(395).includes('Wear a well-fitted N95.'), advisesMask);
    });
  }

  test('test_generateOfflineCleanAirPlan_fuelAndHeating_tailorEveningAdvice', () => {
    const evening = (override) => generateOfflineCleanAirPlan({ ...BASE, ...override }).hourlyRoutines[3].recommendation;
    assert.match(evening({ cookingMethod: 'biomass' }), /Biomass smoke is a major indoor source/);
    assert.match(evening({ cookingMethod: 'png' }), /Gas burners/);
    assert.match(evening({ cookingMethod: 'lpg' }), /Gas burners/);
    assert.match(evening({ heatingMethod: 'open_fire' }), /carbon monoxide/);
    assert.match(evening({ heatingMethod: 'space_heater' }), /space heater/);
    assert.doesNotMatch(
      evening({ cookingMethod: 'induction', heatingMethod: 'heat_pump' }),
      /Biomass|Gas burners|carbon monoxide|space heater/
    );
  });

  for (const [hackId, advice] of [
    ['corsi_rosenthal', /Run the Corsi-Rosenthal box/],
    ['pc_fan_stealth', /Run the PC-fan purifier/],
    ['wet_towel_emergency', /Lay damp towels along door gaps/],
    ['kitchen_vent_scrub', /exhaust filter works only at the stove/]
  ]) {
    test(`test_generateOfflineCleanAirPlan_${hackId}_adviseItOnlyWhenFiltrationIsNeeded`, () => {
      const evening = (aqi) => generateOfflineCleanAirPlan({ ...BASE, hackId, aqi }).hourlyRoutines[3].recommendation;
      assert.match(evening(51), advice);
      assert.doesNotMatch(evening(50), advice);
    });
  }

  test('test_generateOfflineCleanAirPlan_hazardousMidday_shortensTheAiringAbove400', () => {
    const midday = (aqi) => generateOfflineCleanAirPlan({ ...BASE, aqi }).hourlyRoutines[1].recommendation;
    assert.match(midday(400), /about 15 minutes/);
    assert.match(midday(401), /no more than 5 minutes/);
    assert.match(midday(30), /Open the windows and let the home air out/);
  });

  for (const [aqi, actionTypes] of [
    [200, ['SAFE_VENTILATION', 'SAFE_VENTILATION', 'SAFE_VENTILATION', 'SAFE_VENTILATION']],
    [201, ['SEAL_HOME', 'SAFE_VENTILATION', 'COMMUTE_SHIELD', 'SEAL_HOME']],
    [300, ['SEAL_HOME', 'SAFE_VENTILATION', 'COMMUTE_SHIELD', 'SEAL_HOME']],
    [301, ['SEAL_HOME', 'SAFE_VENTILATION', 'SHIFT_INDOORS', 'SEAL_HOME']]
  ]) {
    test(`test_generateOfflineCleanAirPlan_otherHouseholdAt${aqi}_assignsActionTypesByPolicy`, () => {
      const plan = generateOfflineCleanAirPlan({ ...BASE, vulnBits: 0, aqi });
      assert.deepEqual(plan.hourlyRoutines.map((r) => r.actionType), actionTypes);
    });
  }

  test('test_generateOfflineCleanAirPlan_biomassHousehold_namesBiomassAsCurrentChoice', () => {
    const plan = generateOfflineCleanAirPlan({ ...BASE, cookingMethod: 'biomass' });
    assert.equal(plan.sustainableAlternatives[1].currentChoice, 'Biomass');
  });

  test('test_generateOfflineCleanAirPlan_alreadyCleanChoices_keepThemInTheAlternatives', () => {
    const [transit, cooking, heating] = generateOfflineCleanAirPlan({
      ...BASE, commuteMode: 'public_transit', cookingMethod: 'induction', heatingMethod: 'heat_pump'
    }).sustainableAlternatives;
    assert.match(transit.benefit, /Your commute is already low-carbon/);
    assert.equal(cooking.cleanAlternative, 'Keep using induction');
    assert.equal(heating.cleanAlternative, 'Keep using heat pump');
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

/**
 * Collects the wording of a plan that changes with the household: routines, mixing notice,
 * both community bulletins, alternative cards and the cleaning protocol.
 *
 * @param {Object} plan - Offline action plan.
 * @returns {string} Joined advice text.
 */
function adviceText(plan) {
  return [
    ...plan.hourlyRoutines.map((r) => r.recommendation),
    plan.diurnalWindowNotice,
    plan.bilingualAdvisory.en,
    plan.bilingualAdvisory.hi,
    ...plan.sustainableAlternatives.map((a) => `${a.cleanAlternative} ${a.benefit}`),
    plan.cleaningProtocol.warning,
    plan.cleaningProtocol.recommendation
  ].join('\n');
}

/**
 * Routine wording of the offline plan for a household.
 *
 * @param {Object} overrides - Fields to replace in the base household.
 * @returns {string} Joined routine recommendations.
 */
function routineText(overrides) {
  return generateOfflineCleanAirPlan({ ...BASE, ...overrides })
    .hourlyRoutines.map((r) => r.recommendation).join('\n');
}

const VULNERABILITIES = Object.freeze([
  [VULN_FLAGS.INFANT, 'Infant:'],
  [VULN_FLAGS.ASTHMA, 'Asthma or COPD:'],
  [VULN_FLAGS.SENIOR, 'Older adult:'],
  [VULN_FLAGS.PREGNANT, 'Pregnancy:'],
  [VULN_FLAGS.OUTDOOR_WORKER, 'Outdoor worker:']
]);

const BAND_SAMPLES = Object.freeze([30, 75, 150, 250, 350, 450]);

const SEALING_OR_N95 = /\bseal|keep windows (closed|up)|close up|close window|block door gaps|\btape\b|towel the gaps|N95|\bmask\b/i;

describe('generateOfflineCleanAirPlan tailoring', () => {
  for (const aqi of [30, 395]) {
    test(`test_generateOfflineCleanAirPlan_eachVulnerabilityAtAqi${aqi}_getsItsOwnRoutine`, () => {
      const texts = [0, ...VULNERABILITIES.map(([bit]) => bit)].map((vulnBits) => routineText({ aqi, vulnBits }));
      assert.equal(new Set(texts).size, VULNERABILITIES.length + 1);
      VULNERABILITIES.forEach(([, prefix], index) => {
        assert.ok(texts[index + 1].includes(prefix), prefix);
        assert.ok(!texts[0].includes(prefix), prefix);
      });
    });

    test(`test_generateOfflineCleanAirPlan_eachHousingTypeAtAqi${aqi}_getsItsOwnRoutine`, () => {
      const texts = ['sealed_apartment', 'standard_flat', 'drafty_home']
        .map((housingType) => routineText({ aqi, housingType }));
      assert.equal(new Set(texts).size, 3);
    });
  }

  test('test_generateOfflineCleanAirPlan_everyVulnerability_isNamedWhenAllAreSelected', () => {
    const text = routineText({ vulnBits: 31 });
    for (const [, prefix] of VULNERABILITIES) assert.ok(text.includes(prefix), prefix);
  });

  test('test_generateOfflineCleanAirPlan_eachAqiBand_getsItsOwnRoutineAndBulletin', () => {
    const plans = BAND_SAMPLES.map((aqi) => generateOfflineCleanAirPlan({ ...BASE, vulnBits: 0, aqi }));
    assert.equal(new Set(plans.map((p) => p.severityLevel)).size, BAND_SAMPLES.length);
    assert.equal(
      new Set(plans.map((p) => p.hourlyRoutines.map((r) => r.recommendation).join('\n'))).size,
      BAND_SAMPLES.length
    );
    const bodies = plans.map((p) => p.communityAdvisory.split('\n').slice(1).join('\n'));
    assert.equal(new Set(bodies).size, BAND_SAMPLES.length);
  });

  test('test_generateOfflineCleanAirPlan_aqi30AnyProfile_hasNoSealingOrMaskWording', () => {
    for (const vulnBits of [0, 1, 2, 4, 8, 16, 31]) {
      for (const housingType of ['standard_flat', 'sealed_apartment', 'drafty_home']) {
        for (const commuteMode of ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car']) {
          for (const [cookingMethod, heatingMethod] of [
            ['induction', 'heat_pump'], ['png', 'electric_radiator'], ['lpg', 'space_heater'], ['biomass', 'open_fire']
          ]) {
            for (const hackId of Object.keys(IAQ_HACKS_CATALOG)) {
              const text = adviceText(generateOfflineCleanAirPlan({
                ...BASE, aqi: 30, vulnBits, housingType, commuteMode, cookingMethod, heatingMethod, hackId
              }));
              assert.doesNotMatch(text, SEALING_OR_N95);
            }
          }
        }
      }
    }
  });

  test('test_generateOfflineCleanAirPlan_severeAir_doesAdviseSealingAndN95', () => {
    assert.match(adviceText(generateOfflineCleanAirPlan(BASE)), SEALING_OR_N95);
    assert.match(routineText({}), /N95/);
  });

  for (const [label, fuel] of [
    ['biomassCooking', { cookingMethod: 'biomass', heatingMethod: 'heat_pump' }],
    ['openFireHeating', { cookingMethod: 'induction', heatingMethod: 'open_fire' }]
  ]) {
    test(`test_generateOfflineCleanAirPlan_${label}OnSmoggyDay_keepsAVentOpen`, () => {
      for (const aqi of [101, 250, 450]) {
        assert.match(routineText({ ...fuel, aqi }), /Keep a vent open whenever fuel is burning/, `aqi ${aqi}`);
      }
    });
  }

  test('test_generateOfflineCleanAirPlan_biomassOnCalmDay_cooksWithAVentOpen', () => {
    assert.match(routineText({ aqi: 30, vulnBits: 0, cookingMethod: 'biomass' }), /cook with a vent open/);
  });

  test(
    'test_generateOfflineCleanAirPlan_openFireOnCalmDay_tellsHouseholdToKeepAVentOpen',
    () => {
      const plan = generateOfflineCleanAirPlan({
        ...BASE, aqi: 30, vulnBits: 0, cookingMethod: 'induction', heatingMethod: 'open_fire'
      });
      assert.match(adviceText(plan), /vent open|open a vent|keep a vent/i);
    }
  );

  test('test_generateOfflineCleanAirPlan_noSolidFuel_doesNotMentionAnOpenVent', () => {
    assert.doesNotMatch(
      routineText({ aqi: 450, cookingMethod: 'lpg', heatingMethod: 'space_heater' }),
      /vent open/i
    );
  });
});

describe('community advisory tiers', () => {
  for (const [aqi, heading, offersHack] of [
    [100, /Good News/, false],
    [101, /Take Care/, true],
    [200, /Take Care/, true],
    [201, /Inversion Trap Alert/, true]
  ]) {
    test(`test_generateOfflineCleanAirPlan_otherHouseholdAt${aqi}_usesTheMatchingBulletinTier`, () => {
      const { communityAdvisory } = generateOfflineCleanAirPlan({ ...BASE, vulnBits: 0, aqi });
      assert.match(communityAdvisory, heading);
      assert.equal(communityAdvisory.includes('Community Hack'), offersHack);
    });
  }

  test('test_generateOfflineCleanAirPlan_vulnerableHousehold_isNamedInTheAlert', () => {
    const { communityAdvisory } = generateOfflineCleanAirPlan({
      ...BASE, vulnBits: VULN_FLAGS.SENIOR | VULN_FLAGS.PREGNANT
    });
    assert.match(communityAdvisory, /Protect older adults, pregnant women first/);
  });

  test('test_generateOfflineCleanAirPlan_nothingAvoided_saysNoExtraStepsAreNeeded', () => {
    const { communityAdvisory } = generateOfflineCleanAirPlan({ ...BASE, aqi: 30, vulnBits: 0 });
    assert.match(communityAdvisory, /no extra protective steps are needed today \(0 µg additional saving\)/);
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

describe('solid fuel safety on protective days', () => {
  const GAP_SEALING = /block door gaps|tape or towel|window latches|along door gaps/i;

  for (const [cookingMethod, heatingMethod] of [['lpg', 'open_fire'], ['biomass', 'heat_pump']]) {
    for (const housingType of ['standard_flat', 'drafty_home']) {
      for (const hackId of Object.keys(IAQ_HACKS_CATALOG)) {
        test(`test_generateOfflineCleanAirPlan_${cookingMethod}_${heatingMethod}_${housingType}_${hackId}_neverAsksToSealGaps`, () => {
          const text = routineText({ aqi: 450, cookingMethod, heatingMethod, housingType, hackId });
          assert.doesNotMatch(text, GAP_SEALING);
          assert.match(text, /Do not seal door or window gaps/);
          assert.match(text, /vent open/i);
        });
      }
    }
  }

  test('test_generateOfflineCleanAirPlan_wetTowelHack_warnsAgainstSealingAroundSolidFuel', () => {
    assert.match(IAQ_HACKS_CATALOG.wet_towel_emergency.steps.at(-1), /Never seal gaps .* solid fuel/);
  });
});
