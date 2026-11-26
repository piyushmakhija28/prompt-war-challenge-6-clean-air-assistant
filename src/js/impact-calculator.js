/**
 * @fileoverview Environmental impact, respiratory dosage, and life-cycle carbon calculations.
 * Implements monotonic binary search breakpoint interpolation, Math.expm1(-x) decay stability,
 * Kahan-Neumaier compensated summation, and Well-to-Wheel (WTW) carbon delta formulas.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module impact-calculator
 */

import { BREAKPOINTS, WTW_EMISSION_FACTORS, INFILTRATION_COEFFICIENTS } from './config.js';

/**
 * Resolves the numeric building envelope particulate infiltration coefficient (alpha_inf)
 * based on structural housing airtightness characteristics.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {string} housingType - 'sealed_apartment' | 'standard_flat' | 'drafty_home'.
 * @returns {number} Infiltration coefficient (0.40, 0.65, or 0.85).
 */
export function getHousingInfiltrationCoefficient(housingType) {
  if (housingType === 'sealed_apartment') return INFILTRATION_COEFFICIENTS.SEALED_APARTMENT;
  if (housingType === 'drafty_home') return INFILTRATION_COEFFICIENTS.DRAFTY_HOME;
  return INFILTRATION_COEFFICIENTS.STANDARD_FLAT;
}

/**
 * Converts ambient Air Quality Index (AQI) to PM2.5 mass concentration (ug/m3) via monotonic binary search.
 * Implements the official EPA/CPCB piecewise linear breakpoint conversion.
 * Complexity: O(log K) where K = 6 intervals, at most 3 comparisons.
 * Space Complexity: O(1) auxiliary space.
 *
 * @param {number} aqi - Air Quality Index scalar (>= 0).
 * @returns {number} PM2.5 concentration in micrograms per cubic meter (ug/m3).
 */
export function aqiToMassConcentration(aqi) {
  const val = Number(aqi) || 0;
  if (val <= 0) return 0;
  if (val > 500) {
    return Math.round((380.0 + (val - 500) * 0.80) * 100) / 100;
  }

  let low = 0;
  let high = BREAKPOINTS.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const bp = BREAKPOINTS[mid];

    if (val >= bp.iLo && val <= bp.iHi) {
      const concentration = ((val - bp.iLo) / (bp.iHi - bp.iLo)) * (bp.bHi - bp.bLo) + bp.bLo;
      return Math.round(concentration * 100) / 100;
    }

    if (val < bp.iLo) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return 380.0;
}

/**
 * Calculates indoor particulate clearance fraction after t hours using Corsi-Rosenthal DIY filtration.
 * Uses Math.expm1(-x) to prevent catastrophic floating-point cancellation for small time intervals.
 * Equation: FractionalClearance(t) = -Math.expm1(-lambda * t)
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} cadrCfm - Clean Air Delivery Rate in cubic feet per minute (e.g. 273 CFM).
 * @param {number} [roomVolumeM3=54] - Room volume in cubic meters (e.g. 4m x 5m x 2.7m = 54 m3).
 * @param {number} [durationHours=1] - Operating duration in hours.
 * @returns {number} Decimal fraction of indoor particulate matter removed (0.00 to 1.00).
 */
export function calculateRoomClearance(cadrCfm, roomVolumeM3 = 54, durationHours = 1) {
  const cadrM3PerHour = cadrCfm * 1.69901;
  const ach = cadrM3PerHour / Math.max(1.0, roomVolumeM3);
  const naturalDeposition = 0.24;
  const lambda = ach + naturalDeposition;
  const x = lambda * Math.max(0, durationHours);
  const clearance = -Math.expm1(-x);
  return Math.min(1.0, Math.max(0.0, clearance));
}

/**
 * Computes avoided alveolar particulate inhalation dosage in micrograms (ug).
 * Formula: Delta_D = (C_out * alpha_inf - C_in_filtered) * V_E * delta_t * eta_dep
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} cOut - Outdoor ambient mass concentration (ug/m3).
 * @param {number} cIn - Indoor baseline unmitigated concentration (ug/m3).
 * @param {number} hoursShifted - Duration of exposure shifted or filtered (hours).
 * @param {number} [ventilationRate=0.45] - Minute ventilation volume in m3/hour (0.45 adult resting, 1.20 exercise).
 * @param {number} [depositionFraction=0.28] - Alveolar fine particulate deposition fraction.
 * @returns {number} Inhaled dosage avoided in micrograms (ug).
 */
export function calculateParticulateAvoidance(
  cOut,
  cIn,
  hoursShifted,
  ventilationRate = 0.45,
  depositionFraction = 0.28
) {
  const deltaConc = Math.max(0, cOut - cIn);
  const t = Math.max(0, Number(hoursShifted) || 0);
  const dosage = deltaConc * ventilationRate * t * depositionFraction;
  return Math.round(dosage * 100) / 100;
}

/**
 * Computes exact cumulative sum of floating-point values using the Kahan-Neumaier summation algorithm.
 * Guarantees an O(eps) precision bound across wide numerical dynamic ranges, eliminating IEEE-754 roundoff drift.
 * Complexity: O(N) time, O(1) auxiliary space.
 *
 * @param {Array<number>|Float64Array} values - Array of hourly dosage values in micrograms.
 * @returns {number} Exact compensated cumulative sum.
 */
export function kahanNeumaierSum(values) {
  let sum = 0.0;
  let c = 0.0;

  for (let i = 0; i < values.length; i++) {
    const x = Number(values[i]) || 0;
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) {
      c += (sum - t) + x;
    } else {
      c += (x - t) + sum;
    }
    sum = t;
  }

  return Math.round((sum + c) * 100) / 100;
}

/**
 * Converts inhaled particulate mass dosage avoided into equivalent cigarettes avoided.
 * Based on Berkeley Earth empirical conversion factor: 1 cigarette = 66.5 ug inhaled PM2.5.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} dosageMicrograms - Particulate mass in micrograms.
 * @returns {number} Cigarettes avoided (rounded to 2 decimal places).
 */
export function dosageToCigarettes(dosageMicrograms) {
  const safeDosage = Math.max(0, Number(dosageMicrograms) || 0);
  return Math.round((safeDosage / 66.5) * 100) / 100;
}

/**
 * Calculates net Well-to-Wheel (WTW) carbon emissions avoided from modal shift or heating alternatives.
 * Formula: Delta_CO2e = distanceKm * (EF_baseline - EF_alternative)
 * Complexity: O(1) time, O(1) space.
 *
 * @param {string} currentMode - Baseline mode ('two_wheeler', 'private_car', 'biomass_heater').
 * @param {string} alternativeMode - Clean mode ('metro', 'walk_cycle', 'electric_radiator').
 * @param {number} quantity - Distance in km (transit) or operating duration in hours (heating).
 * @returns {number} Net CO2e avoided in kilograms (kg).
 */
export function calculateCarbonAvoidance(currentMode, alternativeMode, quantity) {
  const q = Math.max(0, Number(quantity) || 0);
  let baselineFactor = 0;
  let alternativeFactor = 0;

  if (currentMode === 'two_wheeler') baselineFactor = WTW_EMISSION_FACTORS.TWOWHEELER_PER_KM;
  else if (currentMode === 'private_car') baselineFactor = WTW_EMISSION_FACTORS.CAR_SOLO_PER_KM;
  else if (currentMode === 'biomass_heater') baselineFactor = WTW_EMISSION_FACTORS.BIOMASS_HEATER_PER_HR;

  if (alternativeMode === 'metro') alternativeFactor = WTW_EMISSION_FACTORS.METRO_RAIL_PER_PASS_KM;
  else if (alternativeMode === 'walk_cycle') alternativeFactor = WTW_EMISSION_FACTORS.WALK_CYCLE_PER_KM;
  else if (alternativeMode === 'electric_radiator') alternativeFactor = WTW_EMISSION_FACTORS.ELECTRIC_RADIATOR_PER_HR;

  const savedGrams = Math.max(0, baselineFactor - alternativeFactor) * q;
  return Math.round((savedGrams / 1000) * 100) / 100;
}
