/**
 * @fileoverview Unit tests for impact-calculator.js.
 * Breakpoint oracles come from docs/lld/02-direct-impact-mathematical-spec.md, carbon and
 * cigarette oracles from docs/01-prd.md (FR-09, FR-10) and ADR-005. Household dose oracles
 * are worked by hand from the published DOSE_MODEL and EXPOSURE_ASSUMPTIONS constants: a
 * resting adult retains 0.1638 ug per hour for each ug/m3 breathed
 * (10.8 m3 x 1.3 / 24 h x 0.28).
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSE_MODEL,
  EXPOSURE_ASSUMPTIONS,
  HACK_EFFECTS,
  CHOICE_NAMES,
  aqiToMassConcentration,
  massConcentrationToAqi,
  computeImpact,
  calculateCarbonAvoidance,
  calculateParticulateAvoidance,
  dosageToCigarettes,
  getHousingInfiltrationCoefficient,
  getSeverityBand,
  getProtectionPolicy,
  burnsSolidFuel,
  listProtectionMeasures,
  kahanNeumaierSum
} from '../../src/js/impact-calculator.js';
import { getVulnerabilityMultiplier } from '../../src/js/air-quality-engine.js';
import { VULN_FLAGS } from '../../src/js/config.js';

const SPEC_BREAKPOINTS = [
  [0, 0], [50, 30], [51, 30.1], [100, 60], [101, 60.1], [200, 90], [201, 90.1],
  [300, 120], [301, 120.1], [400, 250], [401, 250.1], [500, 380], [501, 380.8], [999, 779.2]
];

const CHOICE_FIELDS = Object.freeze({
  iaq_hack: 'hackId',
  cooking: 'cookingMethod',
  heating: 'heatingMethod',
  commute: 'commuteMode',
  housing: 'housingType'
});

const FIGURES = Object.freeze(['unshieldedDoseUg', 'protectedDoseUg', 'pm25AvoidedUg', 'carbonSavedKg']);

/**
 * Builds the hand-worked reference household: a standard flat that cooks on induction, heats
 * with a heat pump, rides the metro 15 km and runs a Corsi-Rosenthal box.
 *
 * @param {Object} [overrides] - Fields to replace.
 * @returns {Object} Context.
 */
function household(overrides = {}) {
  return {
    aqi: 400,
    vulnBits: 0,
    housingType: 'standard_flat',
    cookingMethod: 'induction',
    heatingMethod: 'heat_pump',
    commuteMode: 'public_transit',
    commuteKm: 15,
    hackId: 'corsi_rosenthal',
    ...overrides
  };
}

/**
 * Finds one choice comparison of an impact summary.
 *
 * @param {Object} impact - Result of computeImpact.
 * @param {string} choice - Choice id.
 * @returns {Object} Comparison entry.
 */
function choiceOf(impact, choice) {
  return impact.choices.find((item) => item.choice === choice);
}

describe('aqiToMassConcentration', () => {
  for (const [aqi, concentration] of SPEC_BREAKPOINTS) {
    test(`test_aqiToMassConcentration_specBreakpoint${aqi}_returns${concentration}`, () => {
      assert.equal(aqiToMassConcentration(aqi), concentration);
    });
  }

  test('test_aqiToMassConcentration_fractionalInsideBand_interpolates', () => {
    assert.equal(aqiToMassConcentration(25), 15);
    assert.equal(aqiToMassConcentration(150.5), 75.05);
    assert.equal(aqiToMassConcentration(450.5), 315.05);
  });

  test('test_aqiToMassConcentration_fractionalInGapBetweenBands_staysBetweenNeighbours', () => {
    assert.equal(aqiToMassConcentration(50.5), 30.05);
    assert.equal(aqiToMassConcentration(100.5), 60.05);
    assert.equal(aqiToMassConcentration(400.5), 250.05);
  });

  test('test_aqiToMassConcentration_fractionalAbove500_extrapolatesLinearly', () => {
    assert.equal(aqiToMassConcentration(500.5), 380.4);
  });

  test('test_aqiToMassConcentration_invalidOrNonPositive_returnsZero', () => {
    for (const value of [-1, -0.1, 0, NaN, undefined, null, 'abc', {}]) {
      assert.equal(aqiToMassConcentration(value), 0, `input ${String(value)}`);
    }
  });

  test('test_aqiToMassConcentration_numericString_isAccepted', () => {
    assert.equal(aqiToMassConcentration('400'), 250);
  });

  test('test_aqiToMassConcentration_sweepInTenthSteps_isNonDecreasingAndFinite', () => {
    let previous = 0;
    for (let tenth = 0; tenth <= 9990; tenth++) {
      const value = aqiToMassConcentration(tenth / 10);
      assert.ok(Number.isFinite(value) && value >= previous, `AQI ${tenth / 10} gave ${value} after ${previous}`);
      previous = value;
    }
  });
});

describe('massConcentrationToAqi', () => {
  for (const [aqi, concentration] of SPEC_BREAKPOINTS) {
    test(`test_massConcentrationToAqi_specConcentration${concentration}_returns${aqi}`, () => {
      assert.equal(massConcentrationToAqi(concentration), aqi);
    });
  }

  test('test_massConcentrationToAqi_everyIntegerAqi_roundTrips', () => {
    const mismatches = [];
    for (let aqi = 0; aqi <= 999; aqi++) {
      const back = massConcentrationToAqi(aqiToMassConcentration(aqi));
      if (back !== aqi) mismatches.push([aqi, back]);
    }
    assert.deepEqual(mismatches, []);
  });

  test('test_massConcentrationToAqi_gapBetweenBands_returnsAdjacentIndex', () => {
    for (const [concentration, low] of [[30.05, 50], [60.05, 100], [90.05, 200], [120.05, 300], [250.05, 400]]) {
      const aqi = massConcentrationToAqi(concentration);
      assert.ok(aqi === low || aqi === low + 1, `${concentration} gave ${aqi}`);
    }
  });

  test('test_massConcentrationToAqi_extremeValue_clampsTo999', () => {
    assert.equal(massConcentrationToAqi(780), 999);
    assert.equal(massConcentrationToAqi(1e9), 999);
  });

  test('test_massConcentrationToAqi_invalidOrNonPositive_returnsZero', () => {
    for (const value of [-5, 0, NaN, undefined, null, 'x']) {
      assert.equal(massConcentrationToAqi(value), 0, `input ${String(value)}`);
    }
  });

  test('test_massConcentrationToAqi_sweep_isNonDecreasingInteger', () => {
    let previous = 0;
    for (let tenth = 0; tenth <= 8000; tenth++) {
      const aqi = massConcentrationToAqi(tenth / 10);
      assert.ok(Number.isInteger(aqi) && aqi >= previous, `concentration ${tenth / 10} gave ${aqi}`);
      previous = aqi;
    }
  });
});

describe('computeImpact', () => {
  test('test_computeImpact_aqi100WithoutProtectionNeed_matchesHandWorkedDay', () => {
    const impact = computeImpact(household({
      aqi: 100,
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'two_wheeler',
      commuteKm: 14
    }));
    assert.equal(impact.pm25UgM3, 60);
    assert.equal(impact.unshieldedDoseUg, 204);
    assert.equal(impact.protectedDoseUg, 204);
    assert.equal(impact.pm25AvoidedUg, 0);
    assert.equal(impact.reductionPct, 0);
    assert.equal(impact.protectionScorePercent, 0);
    assert.equal(impact.unshieldedCigarettes, 3.07);
    assert.equal(impact.cigarettesAvoided, 0);
    assert.equal(impact.carbonSavedKg, 0.45);
  });

  test('test_computeImpact_aqi400ProtectedDay_matchesHandWorkedDosesAndContributions', () => {
    const impact = computeImpact(household());
    assert.equal(impact.pm25UgM3, 250);
    assert.equal(impact.unshieldedDoseUg, 714);
    assert.equal(impact.protectedDoseUg, 293);
    assert.equal(impact.pm25AvoidedUg, 421);
    assert.ok(Math.abs(impact.reductionPct - (421 / 714) * 100) < 1e-9);
    assert.equal(impact.protectionScorePercent, 59);
    assert.equal(impact.unshieldedCigarettes, 10.74);
    assert.equal(impact.protectedCigarettes, 4.41);
    assert.equal(impact.cigarettesAvoided, 6.33);
    assert.deepEqual({ ...impact.contributions }, { indoorAirUg: 338, airingUg: 61, travelUg: 22 });
    assert.equal(impact.carbonSavedKg, 0);
  });

  test('test_computeImpact_outdoorWorker_addsHandWorkedShiftExposure', () => {
    const impact = computeImpact(household({ vulnBits: VULN_FLAGS.OUTDOOR_WORKER }));
    assert.equal(impact.unshieldedDoseUg, 1157);
    assert.equal(impact.protectedDoseUg, 210);
    assert.equal(impact.contributions.travelUg, 546);
  });

  for (const [name, bit, factor] of [
    ['infant', VULN_FLAGS.INFANT, 1.4],
    ['asthma', VULN_FLAGS.ASTHMA, 1.5],
    ['senior', VULN_FLAGS.SENIOR, 1.35],
    ['pregnant', VULN_FLAGS.PREGNANT, 1.45]
  ]) {
    test(`test_computeImpact_${name}Vulnerability_scalesDoseByItsWeight`, () => {
      const base = computeImpact(household());
      const weighted = computeImpact(household({ vulnBits: bit }));
      assert.ok(Math.abs(weighted.unshieldedDoseUg - base.unshieldedDoseUg * factor) <= 2);
      assert.ok(Math.abs(weighted.protectedDoseUg - base.protectedDoseUg * factor) <= 2);
    });
  }

  test('test_computeImpact_zeroAqi_stillCountsIndoorCookingWithoutClaimingSavings', () => {
    const impact = computeImpact(household({ aqi: 0 }));
    assert.equal(impact.unshieldedDoseUg, 5);
    assert.equal(impact.protectedDoseUg, 5);
    assert.equal(impact.pm25AvoidedUg, 0);
    assert.equal(impact.reductionPct, 0);
    assert.equal(impact.protectionScorePercent, 0);
  });

  test('test_computeImpact_zeroAqiKitchenExhaust_savesOnlyTheCapturedCookingDose', () => {
    const impact = computeImpact(household({ aqi: 0, hackId: 'kitchen_vent_scrub' }));
    assert.equal(impact.unshieldedDoseUg, 5);
    assert.equal(impact.protectedDoseUg, 2);
    assert.equal(impact.pm25AvoidedUg, 3);
  });

  test('test_computeImpact_strongerRoomHack_leavesLessDoseThanWeakerOne', () => {
    for (const aqi of [101, 250, 400, 999]) {
      const corsi = computeImpact(household({ aqi, hackId: 'corsi_rosenthal' }));
      const fan = computeImpact(household({ aqi, hackId: 'pc_fan_stealth' }));
      assert.ok(corsi.protectedDoseUg < fan.protectedDoseUg, `aqi ${aqi}`);
      assert.equal(corsi.unshieldedDoseUg, fan.unshieldedDoseUg, `aqi ${aqi}`);
    }
    assert.ok(HACK_EFFECTS.corsi_rosenthal.roomCadrCfm > HACK_EFFECTS.pc_fan_stealth.roomCadrCfm);
  });

  test('test_computeImpact_tighterHousing_lowersUnshieldedDose', () => {
    const [sealed, standard, drafty] = ['sealed_apartment', 'standard_flat', 'drafty_home']
      .map((housingType) => computeImpact(household({ housingType })).unshieldedDoseUg);
    assert.ok(sealed < standard && standard < drafty, `${sealed} ${standard} ${drafty}`);
  });

  test('test_computeImpact_dirtierCookingAndHeating_raiseUnshieldedDose', () => {
    const dose = (overrides) => computeImpact(household(overrides)).unshieldedDoseUg;
    assert.ok(dose({ cookingMethod: 'induction' }) < dose({ cookingMethod: 'lpg' }));
    assert.ok(dose({ cookingMethod: 'lpg' }) < dose({ cookingMethod: 'biomass' }));
    assert.ok(dose({ heatingMethod: 'heat_pump' }) < dose({ heatingMethod: 'space_heater' }));
    assert.ok(dose({ heatingMethod: 'space_heater' }) < dose({ heatingMethod: 'open_fire' }));
  });

  test('test_computeImpact_unknownChoices_fallBackToDocumentedDefaults', () => {
    const defaults = computeImpact(household({
      housingType: 'standard_flat',
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'two_wheeler',
      hackId: 'corsi_rosenthal'
    }));
    for (const value of [undefined, null, 'castle', 'toString', '__proto__']) {
      const impact = computeImpact(household({
        housingType: value,
        cookingMethod: value,
        heatingMethod: value,
        commuteMode: value,
        hackId: value
      }));
      assert.deepEqual(impact, defaults, `input ${String(value)}`);
    }
  });

  test('test_computeImpact_aqiOutOfRange_isClamped', () => {
    assert.deepEqual(computeImpact(household({ aqi: -50 })), computeImpact(household({ aqi: 0 })));
    assert.deepEqual(computeImpact(household({ aqi: 5000 })), computeImpact(household({ aqi: 999 })));
    assert.equal(computeImpact(household({ aqi: 5000 })).pm25UgM3, 779.2);
    assert.deepEqual(computeImpact(household({ aqi: 'garbage' })), computeImpact(household({ aqi: 0 })));
    assert.deepEqual(computeImpact(household({ aqi: 399.6 })), computeImpact(household({ aqi: 400 })));
  });

  test('test_computeImpact_privateCar_savesCarDifference', () => {
    assert.equal(computeImpact(household({ commuteMode: 'private_car', commuteKm: 14 })).carbonSavedKg, 2.97);
  });

  for (const [heatingMethod, kilograms] of [
    ['heat_pump', 0], ['space_heater', 0], ['electric_radiator', 1.15], ['open_fire', 5]
  ]) {
    test(`test_computeImpact_${heatingMethod}Heating_reportsHeatPumpCarbonSaving`, () => {
      assert.equal(computeImpact(household({ heatingMethod })).carbonSavedKg, kilograms);
    });
  }

  test('test_computeImpact_commuteAndHeatingSavings_areAdded', () => {
    const impact = computeImpact(household({
      commuteMode: 'private_car', commuteKm: 14, heatingMethod: 'open_fire'
    }));
    assert.equal(impact.carbonSavedKg, 7.97);
    assert.equal(choiceOf(impact, 'commute').co2eDeltaKg, 2.97);
    assert.equal(choiceOf(impact, 'heating').co2eDeltaKg, 5);
  });

  test('test_computeImpact_lowCarbonCommute_savesNothingForTransit', () => {
    for (const commuteMode of ['public_transit', 'walk_cycle']) {
      assert.equal(computeImpact(household({ commuteMode })).carbonSavedKg, 0, commuteMode);
    }
  });

  test('test_computeImpact_commuteKmBoundaries_defaultsOnlyWhenAbsent', () => {
    const carbon = (commuteKm) => computeImpact(household({ commuteMode: 'two_wheeler', commuteKm })).carbonSavedKg;
    assert.equal(carbon(0), 0);
    assert.equal(carbon(-10), 0);
    assert.equal(carbon('abc'), 0);
    assert.equal(carbon(undefined), 0.45);
    assert.equal(carbon(null), 0.45);
    assert.equal(DOSE_MODEL.DEFAULT_COMMUTE_KM, 14);
  });

  test('test_computeImpact_commuteBeyondFourHours_capsTravelExposure', () => {
    const atCap = computeImpact(household({ commuteKm: 20 * EXPOSURE_ASSUMPTIONS.MAX_COMMUTE_HOURS }));
    const beyond = computeImpact(household({ commuteKm: 500 }));
    assert.equal(beyond.unshieldedDoseUg, atCap.unshieldedDoseUg);
    assert.equal(beyond.protectedDoseUg, atCap.protectedDoseUg);
  });

  test('test_computeImpact_result_isDeeplyFrozen', () => {
    const impact = computeImpact(household());
    assert.ok(Object.isFrozen(impact));
    assert.ok(Object.isFrozen(impact.contributions));
    assert.ok(Object.isFrozen(impact.choices));
    assert.ok(impact.choices.every((item) => Object.isFrozen(item)));
  });

  test('test_computeImpact_allProfiles_keepAccountingInvariants', () => {
    for (let vulnBits = 0; vulnBits <= 31; vulnBits++) {
      for (const housingType of ['standard_flat', 'sealed_apartment', 'drafty_home']) {
        let previousDose = -1;
        for (let aqi = 0; aqi <= 999; aqi += 27) {
          const impact = computeImpact(household({ aqi, vulnBits, housingType }));
          const label = `aqi ${aqi} bits ${vulnBits} ${housingType}`;
          const parts = impact.contributions;
          assert.equal(impact.protectedDoseUg + impact.pm25AvoidedUg, impact.unshieldedDoseUg, label);
          assert.equal(parts.indoorAirUg + parts.airingUg + parts.travelUg, impact.pm25AvoidedUg, label);
          assert.equal(
            impact.cigarettesAvoided,
            Math.round((impact.unshieldedCigarettes - impact.protectedCigarettes) * 100) / 100,
            label
          );
          assert.ok(impact.unshieldedDoseUg >= previousDose, label);
          assert.ok(impact.protectedDoseUg >= 0 && impact.pm25AvoidedUg >= 0, label);
          assert.ok(impact.reductionPct >= 0 && impact.reductionPct <= 99.9, label);
          assert.equal(impact.protectionScorePercent, Math.round(impact.reductionPct), label);
          previousDose = impact.unshieldedDoseUg;
        }
      }
    }
  });
});

describe('computeImpact choice comparisons', () => {
  for (const [choice, first, second] of [
    ['iaq_hack', 'corsi_rosenthal', 'pc_fan_stealth'],
    ['iaq_hack', 'pc_fan_stealth', 'wet_towel_emergency'],
    ['iaq_hack', 'wet_towel_emergency', 'kitchen_vent_scrub'],
    ['cooking', 'induction', 'png'],
    ['cooking', 'lpg', 'biomass'],
    ['heating', 'heat_pump', 'electric_radiator'],
    ['heating', 'space_heater', 'open_fire'],
    ['commute', 'walk_cycle', 'two_wheeler'],
    ['commute', 'public_transit', 'private_car'],
    ['housing', 'sealed_apartment', 'standard_flat'],
    ['housing', 'standard_flat', 'drafty_home']
  ]) {
    test(`test_computeImpact_${choice}From_${first}_to_${second}_changesAFigureAndTheExplanation`, () => {
      const before = computeImpact(household({ [CHOICE_FIELDS[choice]]: first }));
      const after = computeImpact(household({ [CHOICE_FIELDS[choice]]: second }));
      assert.ok(FIGURES.some((figure) => before[figure] !== after[figure]), 'no figure changed');
      assert.notEqual(choiceOf(before, choice).explanation, choiceOf(after, choice).explanation);
      assert.equal(choiceOf(after, choice).current, second);
    });
  }

  test('test_computeImpact_choices_listEveryChoiceInFixedOrder', () => {
    assert.deepEqual(
      computeImpact(household()).choices.map((item) => item.choice),
      ['iaq_hack', 'cooking', 'heating', 'commute', 'housing']
    );
  });

  test('test_computeImpact_dirtyHousehold_offersTheCleanerOptionForEachChoice', () => {
    const impact = computeImpact(household({
      hackId: 'pc_fan_stealth',
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'two_wheeler',
      housingType: 'drafty_home'
    }));
    assert.deepEqual(
      impact.choices.map((item) => item.alternative),
      ['corsi_rosenthal', 'induction', 'heat_pump', 'public_transit', 'standard_flat']
    );
  });

  test('test_computeImpact_cleanestHousehold_saysSoAndClaimsNoSaving', () => {
    const impact = computeImpact(household({ housingType: 'sealed_apartment' }));
    for (const item of impact.choices) {
      assert.equal(item.alternative, null, item.choice);
      assert.equal(item.pm25DeltaUg, 0, item.choice);
      assert.equal(item.co2eDeltaKg, 0, item.choice);
      assert.equal(
        item.explanation,
        `${CHOICE_NAMES[item.choice][item.current]}: already the cleanest option modelled here.`
      );
    }
  });

  test('test_computeImpact_pm25Delta_equalsProtectedDoseDifferenceOfTheSwitch', () => {
    for (const aqi of [30, 150, 400]) {
      const ctx = household({
        aqi,
        hackId: 'pc_fan_stealth',
        cookingMethod: 'lpg',
        heatingMethod: 'space_heater',
        commuteMode: 'two_wheeler',
        housingType: 'drafty_home'
      });
      const impact = computeImpact(ctx);
      for (const item of impact.choices) {
        const switched = computeImpact({ ...ctx, [CHOICE_FIELDS[item.choice]]: item.alternative });
        assert.equal(
          item.pm25DeltaUg,
          impact.protectedDoseUg - switched.protectedDoseUg,
          `${item.choice} at ${aqi}`
        );
      }
    }
  });

  test('test_computeImpact_carToMetroInCleanerAir_reportsHigherParticlesAndLowerCarbon', () => {
    const item = choiceOf(computeImpact(household({
      aqi: 100,
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'private_car',
      commuteKm: 14
    })), 'commute');
    assert.equal(item.pm25DeltaUg, -1);
    assert.equal(
      item.explanation,
      'Solo car: switching to "Metro" would raise your inhaled PM2.5 by about 1 µg a day and save about 2.97 kg CO2e a day.'
    );
  });

  test('test_computeImpact_hackWithoutFilterNeed_explainsNoModelledDifference', () => {
    const item = choiceOf(computeImpact(household({ aqi: 30, hackId: 'pc_fan_stealth' })), 'iaq_hack');
    assert.equal(item.pm25DeltaUg, 0);
    assert.equal(
      item.explanation,
      'PC-fan purifier: switching to "Corsi-Rosenthal box" makes no modelled difference today.'
    );
  });
});

describe('solid fuel safety rule', () => {
  for (const [label, fuel] of [
    ['biomassCooking', { cookingMethod: 'biomass' }],
    ['openFireHeating', { heatingMethod: 'open_fire' }],
    ['bothSolidFuels', { cookingMethod: 'biomass', heatingMethod: 'open_fire' }]
  ]) {
    test(`test_computeImpact_${label}_neverComparesATighterHomeAndWarnsOfCarbonMonoxide`, () => {
      for (const housingType of ['sealed_apartment', 'standard_flat', 'drafty_home']) {
        for (const aqi of [0, 30, 150, 400, 999]) {
          const item = choiceOf(computeImpact(household({ ...fuel, housingType, aqi })), 'housing');
          assert.equal(item.alternative, null);
          assert.equal(item.pm25DeltaUg, 0);
          assert.equal(
            item.explanation,
            `${CHOICE_NAMES.housing[housingType]}: keep a vent open while solid fuel burns indoors (carbon monoxide risk).`
          );
        }
      }
    });
  }

  test('test_computeImpact_noSolidFuel_comparesTheNextTighterHome', () => {
    const alternative = (housingType) => choiceOf(computeImpact(household({ housingType })), 'housing').alternative;
    assert.equal(alternative('drafty_home'), 'standard_flat');
    assert.equal(alternative('standard_flat'), 'sealed_apartment');
    assert.equal(alternative('sealed_apartment'), null);
  });

  test('test_burnsSolidFuel_everyCookingAndHeatingPair_isTrueOnlyForBiomassOrOpenFire', () => {
    for (const cooking of Object.keys(CHOICE_NAMES.cooking)) {
      for (const heating of Object.keys(CHOICE_NAMES.heating)) {
        assert.equal(
          burnsSolidFuel({ cooking, heating }),
          cooking === 'biomass' || heating === 'open_fire',
          `${cooking} ${heating}`
        );
      }
    }
  });
});

describe('getProtectionPolicy', () => {
  for (const [measure, otherThreshold, sensitiveThreshold] of [
    ['useFilter', 100, 50],
    ['useMask', 200, 100],
    ['restrictAiring', 200, 100],
    ['avoidOutdoors', 300, 200]
  ]) {
    test(`test_getProtectionPolicy_${measure}OtherHousehold_startsAbove${otherThreshold}`, () => {
      assert.equal(getProtectionPolicy(otherThreshold, 0)[measure], false);
      assert.equal(getProtectionPolicy(otherThreshold + 1, 0)[measure], true);
    });

    test(`test_getProtectionPolicy_${measure}SensitiveHousehold_startsAbove${sensitiveThreshold}`, () => {
      for (const bit of Object.values(VULN_FLAGS)) {
        assert.equal(getProtectionPolicy(sensitiveThreshold, bit)[measure], false, `bit ${bit}`);
        assert.equal(getProtectionPolicy(sensitiveThreshold + 1, bit)[measure], true, `bit ${bit}`);
      }
    });
  }

  test('test_getProtectionPolicy_missingInputs_protectsNothingAndIsFrozen', () => {
    const policy = getProtectionPolicy(undefined);
    assert.deepEqual({ ...policy }, {
      isSensitive: false, useFilter: false, useMask: false, restrictAiring: false, avoidOutdoors: false
    });
    assert.ok(Object.isFrozen(policy));
  });
});

describe('listProtectionMeasures', () => {
  for (const [label, overrides, measures] of [
    ['otherHouseholdAt100', { aqi: 100 }, []],
    ['otherHouseholdAt101', { aqi: 101 }, ['filter']],
    ['otherHouseholdAt201', { aqi: 201 }, ['filter', 'mask', 'airing']],
    ['sensitiveAt51', { aqi: 51, vulnBits: VULN_FLAGS.INFANT }, ['filter']],
    ['sensitiveAt101', { aqi: 101, vulnBits: VULN_FLAGS.INFANT }, ['filter', 'mask', 'airing']],
    ['driverAt201', { aqi: 201, commuteMode: 'private_car' }, ['filter', 'recirculation', 'airing']],
    [
      'drivingOutdoorWorkerAt201',
      { aqi: 201, commuteMode: 'private_car', vulnBits: VULN_FLAGS.OUTDOOR_WORKER },
      ['filter', 'recirculation', 'mask', 'airing']
    ],
    ['kitchenExhaustInCleanAir', { aqi: 30, hackId: 'kitchen_vent_scrub' }, ['filter']],
    ['roomFilterInCleanAir', { aqi: 30 }, []]
  ]) {
    test(`test_listProtectionMeasures_${label}_namesOnlyAppliedMeasures`, () => {
      assert.deepEqual(listProtectionMeasures(household(overrides)), measures);
    });
  }

  test('test_listProtectionMeasures_everyProfile_isEmptyExactlyWhenNothingIsAvoided', () => {
    for (const hackId of Object.keys(HACK_EFFECTS)) {
      for (const vulnBits of [0, 3, 16]) {
        for (const aqi of [0, 30, 50, 51, 100, 101, 200, 201, 400, 999]) {
          const ctx = household({ hackId, vulnBits, aqi });
          assert.equal(
            listProtectionMeasures(ctx).length === 0,
            computeImpact(ctx).pm25AvoidedUg === 0,
            `${hackId} bits ${vulnBits} aqi ${aqi}`
          );
        }
      }
    }
  });
});

describe('getSeverityBand', () => {
  for (const [aqi, band] of [
    [0, 'GOOD'], [50, 'GOOD'], [51, 'MODERATE'], [100, 'MODERATE'], [101, 'POOR'], [200, 'POOR'],
    [201, 'VERY_POOR'], [300, 'VERY_POOR'], [301, 'SEVERE'], [400, 'SEVERE'], [401, 'HAZARDOUS'],
    [999, 'HAZARDOUS'], [5000, 'HAZARDOUS']
  ]) {
    test(`test_getSeverityBand_aqi${aqi}_returns${band}`, () => {
      assert.equal(getSeverityBand(aqi), band);
    });
  }

  test('test_getSeverityBand_fractionalAndInvalidInput_roundsOrDefaultsToGood', () => {
    assert.equal(getSeverityBand(50.4), 'GOOD');
    assert.equal(getSeverityBand(50.5), 'MODERATE');
    assert.equal(getSeverityBand('abc'), 'GOOD');
    assert.equal(getSeverityBand(undefined), 'GOOD');
  });
});

describe('documented vulnerability weighting', () => {
  test('test_getVulnerabilityMultiplier_prdFr01InfantAndAsthma_returns1Point90', () => {
    assert.equal(getVulnerabilityMultiplier(VULN_FLAGS.INFANT | VULN_FLAGS.ASTHMA), 1.90);
  });

  test('test_getVulnerabilityMultiplier_prdFr03InfantSeniorAsthma_returns2Point25', () => {
    const bits = VULN_FLAGS.INFANT | VULN_FLAGS.SENIOR | VULN_FLAGS.ASTHMA;
    assert.equal(getVulnerabilityMultiplier(bits), 2.25);
  });
});

describe('supporting formulas', () => {
  test('test_dosageToCigarettes_documentedExamples_match', () => {
    assert.equal(dosageToCigarettes(66.5), 1);
    assert.equal(dosageToCigarettes(42.2), 0.63);
  });

  test('test_dosageToCigarettes_invalidInput_returnsZero', () => {
    assert.equal(dosageToCigarettes(-100), 0);
    assert.equal(dosageToCigarettes(NaN), 0);
  });

  test('test_calculateCarbonAvoidance_prdCarToMetro20Km_returns4Point24', () => {
    assert.equal(calculateCarbonAvoidance('private_car', 'metro', 20), 4.24);
  });

  test('test_calculateCarbonAvoidance_worseAlternativeOrNegativeQuantity_returnsZero', () => {
    assert.equal(calculateCarbonAvoidance('walk_cycle', 'metro', 20), 0);
    assert.equal(calculateCarbonAvoidance('private_car', 'metro', -20), 0);
    assert.equal(calculateCarbonAvoidance('biomass_heater', 'electric_radiator', 1), 0.64);
  });

  test('test_calculateParticulateAvoidance_indoorAboveOutdoorOrNegativeHours_returnsZero', () => {
    assert.equal(calculateParticulateAvoidance(10, 20, 3), 0);
    assert.equal(calculateParticulateAvoidance(100, 0, -3), 0);
    assert.equal(calculateParticulateAvoidance(100, 0, 2), 25.2);
  });

  test('test_getHousingInfiltrationCoefficient_specTable_matches', () => {
    assert.equal(getHousingInfiltrationCoefficient('sealed_apartment'), 0.40);
    assert.equal(getHousingInfiltrationCoefficient('standard_flat'), 0.65);
    assert.equal(getHousingInfiltrationCoefficient('drafty_home'), 0.85);
  });

  test('test_kahanNeumaierSum_cancellationCase_recoversSmallTerms', () => {
    assert.equal(kahanNeumaierSum([1, 1e100, 1, -1e100]), 2);
    assert.equal(kahanNeumaierSum([]), 0);
  });
});

describe('wet towels while solid fuel burns', () => {
  const home = Object.freeze({
    aqi: 450,
    vulnBits: 0,
    housingType: 'drafty_home',
    cookingMethod: 'lpg',
    heatingMethod: 'open_fire',
    commuteMode: 'public_transit',
    commuteKm: 10,
    hackId: 'wet_towel_emergency'
  });

  test('test_computeImpact_wetTowelsWithSolidFuel_creditNoIndoorBenefit', () => {
    assert.equal(computeImpact(home).contributions.indoorAirUg, 0);
    assert.ok(!listProtectionMeasures(home).includes('filter'));
  });

  test('test_computeImpact_wetTowelsWithoutSolidFuel_stillReduceLeakingSmog', () => {
    const clean = { ...home, heatingMethod: 'heat_pump' };
    assert.ok(computeImpact(clean).contributions.indoorAirUg > 0);
    assert.ok(listProtectionMeasures(clean).includes('filter'));
  });
});
