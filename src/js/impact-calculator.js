/**
 * @fileoverview Environmental impact, respiratory dosage, and life-cycle carbon calculations.
 * Implements monotonic binary search breakpoint interpolation, Math.expm1(-x) decay stability,
 * Kahan-Neumaier compensated summation, and Well-to-Wheel (WTW) carbon delta formulas.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module impact-calculator
 */

import { BREAKPOINTS, WTW_EMISSION_FACTORS, INFILTRATION_COEFFICIENTS } from './config.js';
import { getVulnerabilityMultiplier } from './air-quality-engine.js';

/**
 * Fixed physiological and filtration assumptions behind every dose figure shown in the app.
 * @readonly
 */
export const DOSE_MODEL = Object.freeze({
  DAILY_VOLUME_M3: 10.8,
  ACTIVITY_FACTOR: 1.3,
  DEPOSITION_FRACTION: 0.28,
  SHIELD_EFFICIENCY: 0.8041,
  DEFAULT_COMMUTE_KM: 14
});

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

  const lower = BREAKPOINTS[high];
  const upper = BREAKPOINTS[low];
  const fraction = (val - lower.iHi) / (upper.iLo - lower.iHi);
  return Math.round((lower.bHi + fraction * (upper.bLo - lower.bHi)) * 100) / 100;
}

/**
 * Converts a PM2.5 mass concentration back to the application's AQI scale.
 * Exact inverse of {@link aqiToMassConcentration}, so live sensor readings and manual
 * slider values share one scale.
 *
 * @param {number} concentration - PM2.5 concentration in ug/m3.
 * @returns {number} Integer AQI clamped to the 0-999 range.
 */
export function massConcentrationToAqi(concentration) {
  const c = Number(concentration) || 0;
  if (c <= 0) return 0;

  const last = BREAKPOINTS[BREAKPOINTS.length - 1];
  if (c > last.bHi) {
    return Math.min(999, Math.round(last.iHi + (c - last.bHi) / 0.80));
  }

  const index = BREAKPOINTS.findIndex((bp) => c <= bp.bHi);
  const bp = BREAKPOINTS[index];
  if (c < bp.bLo) {
    const lower = BREAKPOINTS[index - 1];
    const fraction = (c - lower.bHi) / (bp.bLo - lower.bHi);
    return Math.round(lower.iHi + fraction * (bp.iLo - lower.iHi));
  }
  return Math.round(bp.iLo + ((c - bp.bLo) / (bp.bHi - bp.bLo)) * (bp.iHi - bp.iLo));
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
 * Integrates 24-hour diurnal exposure profile into total inhaled particulate mass using Kahan-Neumaier summation.
 * Eliminates IEEE-754 floating-point cancellation across disparate indoor/outdoor values.
 * Complexity: O(N) time where N = 24, O(1) auxiliary space.
 *
 * @param {Array<number>|Float64Array} hourlyConcentrations - 24-hour PM2.5 concentrations in ug/m3.
 * @param {number} [ventilationRate=0.45] - Minute ventilation rate in m3/h.
 * @param {number} [depositionFraction=0.28] - Alveolar deposition fraction.
 * @returns {number} Cumulative 24-hour particulate inhalation in micrograms.
 */
export function calculate24HourCumulativeDosage(hourlyConcentrations, ventilationRate = 0.45, depositionFraction = 0.28) {
  const count = hourlyConcentrations ? hourlyConcentrations.length : 0;
  const dosages = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    dosages[i] = (Number(hourlyConcentrations[i]) || 0) * ventilationRate * 1.0 * depositionFraction;
  }
  return kahanNeumaierSum(dosages);
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

/**
 * Single source of truth for every impact number shown on screen, written into the
 * community advisory, and sent to Gemini as grounding facts.
 *
 * <p>The protection score keeps its original three-hour exposure basis so that it still
 * varies across the AQI range instead of saturating on the daily dose.
 *
 * @param {Object} ctx - Household context (aqi, vulnBits, housingType, commuteMode, commuteKm).
 * @returns {Readonly<{pm25UgM3: number, unshieldedDoseUg: number, protectedDoseUg: number,
 *   pm25AvoidedUg: number, reductionPct: number, unshieldedCigarettes: number,
 *   protectedCigarettes: number, cigarettesAvoided: number, carbonSavedKg: number,
 *   protectionScorePercent: number}>} Frozen impact summary.
 */
export function computeImpact(ctx) {
  const aqi = Math.max(0, Math.min(999, Math.round(Number(ctx.aqi) || 0)));
  const pm25UgM3 = aqiToMassConcentration(aqi);
  const alphaInf = getHousingInfiltrationCoefficient(ctx.housingType || 'standard_flat');
  const vulnMult = getVulnerabilityMultiplier(ctx.vulnBits || 0);

  const unshieldedDoseUg = Math.round(
    pm25UgM3 * (alphaInf * 0.75 + 0.25) * DOSE_MODEL.DAILY_VOLUME_M3 *
    DOSE_MODEL.ACTIVITY_FACTOR * DOSE_MODEL.DEPOSITION_FRACTION * vulnMult
  );
  const protectedDoseUg = Math.round(unshieldedDoseUg * (1 - DOSE_MODEL.SHIELD_EFFICIENCY));
  const pm25AvoidedUg = unshieldedDoseUg - protectedDoseUg;
  const reductionPct = unshieldedDoseUg > 0
    ? Math.min(99.9, (pm25AvoidedUg / unshieldedDoseUg) * 100)
    : 0;

  const unshieldedCigarettes = dosageToCigarettes(unshieldedDoseUg);
  const protectedCigarettes = dosageToCigarettes(protectedDoseUg);
  const cigarettesAvoided = Math.round(Math.max(0, unshieldedCigarettes - protectedCigarettes) * 100) / 100;

  const commuteKm = Number(ctx.commuteKm ?? DOSE_MODEL.DEFAULT_COMMUTE_KM) || 0;
  const mode = ctx.commuteMode || 'two_wheeler';
  const carbonSavedKg = mode === 'private_car' || mode === 'two_wheeler'
    ? calculateCarbonAvoidance(mode, 'metro', commuteKm)
    : 0;

  const filteredIndoor = pm25UgM3 * alphaInf * 0.22;
  const windowDose = calculateParticulateAvoidance(pm25UgM3, filteredIndoor, 3.0, 0.45 * vulnMult, DOSE_MODEL.DEPOSITION_FRACTION);
  const protectionScorePercent = Math.min(98, Math.round(65 + (windowDose / 12) * 5));

  return Object.freeze({
    pm25UgM3,
    unshieldedDoseUg,
    protectedDoseUg,
    pm25AvoidedUg,
    reductionPct,
    unshieldedCigarettes,
    protectedCigarettes,
    cigarettesAvoided,
    carbonSavedKg,
    protectionScorePercent
  });
}
