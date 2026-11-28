/**
 * @fileoverview Unit tests for impact-calculator.js.
 * Breakpoint oracles come from docs/lld/02-direct-impact-mathematical-spec.md, carbon and
 * cigarette oracles from docs/01-prd.md (FR-09, FR-10) and ADR-005. Household dose oracles
 * are worked by hand from the published DOSE_MODEL constants.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSE_MODEL,
  aqiToMassConcentration,
  massConcentrationToAqi,
  computeImpact,
  calculateCarbonAvoidance,
  calculateParticulateAvoidance,
  calculateRoomClearance,
  calculate24HourCumulativeDosage,
  dosageToCigarettes,
  getHousingInfiltrationCoefficient,
  kahanNeumaierSum
} from '../../src/js/impact-calculator.js';
import { getVulnerabilityMultiplier } from '../../src/js/air-quality-engine.js';
import { VULN_FLAGS } from '../../src/js/config.js';

const SPEC_BREAKPOINTS = [
  [0, 0], [50, 30], [51, 30.1], [100, 60], [101, 60.1], [200, 90], [201, 90.1],
  [300, 120], [301, 120.1], [400, 250], [401, 250.1], [500, 380], [501, 380.8], [999, 779.2]
];

/**
 * Builds a household context with a neutral baseline.
 *
 * @param {Object} [overrides] - Fields to replace.
 * @returns {Object} Context.
 */
function household(overrides = {}) {
  return {
    aqi: 400,
    vulnBits: 0,
    housingType: 'standard_flat',
    commuteMode: 'two_wheeler',
    commuteKm: 14,
    ...overrides
  };
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
  test('test_computeImpact_aqi400StandardFlat_matchesHandWorkedFigures', () => {
    const impact = computeImpact(household());
    assert.equal(impact.pm25UgM3, 250);
    assert.equal(impact.unshieldedDoseUg, 725);
    assert.equal(impact.protectedDoseUg, 142);
    assert.equal(impact.pm25AvoidedUg, 583);
    assert.equal(impact.unshieldedCigarettes, 10.9);
    assert.equal(impact.protectedCigarettes, 2.14);
    assert.equal(impact.cigarettesAvoided, 8.76);
    assert.ok(Math.abs(impact.reductionPct - 80.4137931) < 1e-6);
    assert.equal(impact.carbonSavedKg, 0.45);
    assert.equal(impact.protectionScorePercent, 84);
  });

  test('test_computeImpact_aqi100_matchesHandWorkedFiguresBelowScoreCap', () => {
    const impact = computeImpact(household({ aqi: 100 }));
    assert.equal(impact.unshieldedDoseUg, 174);
    assert.equal(impact.protectedDoseUg, 34);
    assert.equal(impact.pm25AvoidedUg, 140);
    assert.equal(impact.cigarettesAvoided, 2.11);
    assert.equal(impact.protectionScorePercent, 73);
  });

  test('test_computeImpact_severeBands_keepDistinctScores', () => {
    const scores = [200, 300, 400, 500].map((aqi) => computeImpact(household({ aqi })).protectionScorePercent);
    assert.deepEqual(scores, [76, 78, 84, 87]);
  });

  test('test_computeImpact_scoreSweep_neverFallsAsAqiOrVulnerabilityRises', () => {
    let previousRow = new Array(1000).fill(0);
    for (const vulnBits of [0, 4, 3, 31]) {
      const row = [];
      for (let aqi = 0; aqi <= 999; aqi++) {
        row.push(computeImpact(household({ aqi, vulnBits })).protectionScorePercent);
        assert.ok(aqi === 0 || row[aqi] >= row[aqi - 1], `aqi ${aqi} bits ${vulnBits}`);
        assert.ok(row[aqi] >= previousRow[aqi], `vulnerability sweep at aqi ${aqi} bits ${vulnBits}`);
      }
      previousRow = row;
    }
  });

  test('test_computeImpact_allVulnerabilities_scalesDoseBy3Point30', () => {
    const impact = computeImpact(household({ aqi: 100, vulnBits: 31 }));
    assert.equal(impact.unshieldedDoseUg, 574);
    assert.equal(impact.protectedDoseUg, 112);
    assert.equal(impact.pm25AvoidedUg, 462);
  });

  test('test_computeImpact_housingType_changesDoseByInfiltration', () => {
    assert.equal(computeImpact(household({ aqi: 100, housingType: 'sealed_apartment' })).unshieldedDoseUg, 130);
    assert.equal(computeImpact(household({ aqi: 100, housingType: 'drafty_home' })).unshieldedDoseUg, 209);
    assert.equal(computeImpact(household({ aqi: 100, housingType: 'castle' })).unshieldedDoseUg, 174);
    assert.equal(computeImpact(household({ aqi: 100, housingType: undefined })).unshieldedDoseUg, 174);
  });

  test('test_computeImpact_zeroAqi_returnsZeroDoseWithoutDivisionError', () => {
    const impact = computeImpact(household({ aqi: 0 }));
    assert.equal(impact.unshieldedDoseUg, 0);
    assert.equal(impact.protectedDoseUg, 0);
    assert.equal(impact.pm25AvoidedUg, 0);
    assert.equal(impact.reductionPct, 0);
    assert.equal(impact.cigarettesAvoided, 0);
    assert.equal(impact.protectionScorePercent, 65);
  });

  test('test_computeImpact_aqiOutOfRange_isClamped', () => {
    assert.deepEqual(computeImpact(household({ aqi: -50 })), computeImpact(household({ aqi: 0 })));
    assert.deepEqual(computeImpact(household({ aqi: 5000 })), computeImpact(household({ aqi: 999 })));
    assert.equal(computeImpact(household({ aqi: 5000 })).pm25UgM3, 779.2);
    assert.deepEqual(computeImpact(household({ aqi: 'garbage' })), computeImpact(household({ aqi: 0 })));
    assert.deepEqual(computeImpact(household({ aqi: 399.6 })), computeImpact(household({ aqi: 400 })));
  });

  test('test_computeImpact_privateCar_savesCarDifference', () => {
    assert.equal(computeImpact(household({ commuteMode: 'private_car' })).carbonSavedKg, 2.97);
  });

  test('test_computeImpact_lowCarbonOrUnknownMode_savesNothing', () => {
    for (const commuteMode of ['public_transit', 'walk_cycle', 'rocket']) {
      assert.equal(computeImpact(household({ commuteMode })).carbonSavedKg, 0, commuteMode);
    }
  });

  test('test_computeImpact_commuteKmBoundaries_defaultsOnlyWhenAbsent', () => {
    assert.equal(computeImpact(household({ commuteKm: 0 })).carbonSavedKg, 0);
    assert.equal(computeImpact(household({ commuteKm: -10 })).carbonSavedKg, 0);
    assert.equal(computeImpact(household({ commuteKm: 'abc' })).carbonSavedKg, 0);
    assert.equal(computeImpact(household({ commuteKm: undefined })).carbonSavedKg, 0.45);
    assert.equal(computeImpact(household({ commuteKm: null })).carbonSavedKg, 0.45);
    assert.equal(DOSE_MODEL.DEFAULT_COMMUTE_KM, 14);
  });

  test('test_computeImpact_result_isFrozen', () => {
    assert.ok(Object.isFrozen(computeImpact(household())));
  });

  test('test_computeImpact_allProfiles_keepAccountingInvariants', () => {
    for (let vulnBits = 0; vulnBits <= 31; vulnBits++) {
      for (const housingType of ['standard_flat', 'sealed_apartment', 'drafty_home']) {
        let previousDose = -1;
        for (let aqi = 0; aqi <= 999; aqi += 9) {
          const impact = computeImpact(household({ aqi, vulnBits, housingType }));
          const label = `aqi ${aqi} bits ${vulnBits} ${housingType}`;
          assert.equal(impact.protectedDoseUg + impact.pm25AvoidedUg, impact.unshieldedDoseUg, label);
          assert.equal(
            impact.cigarettesAvoided,
            Math.round((impact.unshieldedCigarettes - impact.protectedCigarettes) * 100) / 100,
            label
          );
          assert.ok(impact.unshieldedDoseUg >= previousDose, label);
          assert.ok(impact.reductionPct >= 0 && impact.reductionPct <= 99.9, label);
          assert.ok(impact.protectionScorePercent >= 65 && impact.protectionScorePercent <= 98, label);
          previousDose = impact.unshieldedDoseUg;
        }
      }
    }
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

  test('test_calculateRoomClearance_durationBoundaries_staysWithinUnitInterval', () => {
    assert.equal(calculateRoomClearance(273, 54, 0), 0);
    assert.equal(calculateRoomClearance(273, 54, -1), 0);
    assert.equal(calculateRoomClearance(273, 54, 1e6), 1);
    assert.ok(Math.abs(calculateRoomClearance(273, 54, 1) - (1 - Math.exp(-(273 * 1.69901 / 54 + 0.24)))) < 1e-12);
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

  test('test_calculate24HourCumulativeDosage_constantDay_sumsEveryHour', () => {
    assert.equal(calculate24HourCumulativeDosage(new Array(24).fill(100)), 302.4);
    assert.equal(calculate24HourCumulativeDosage(null), 0);
  });
});
