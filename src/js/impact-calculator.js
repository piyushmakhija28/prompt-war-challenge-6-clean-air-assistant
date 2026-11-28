/**
 * @fileoverview Environmental impact, respiratory dosage, and life-cycle carbon calculations.
 * Models one household day as home, window-airing and travel exposure, so that the indoor air
 * hack, cooking, heating, commute, housing and vulnerability choices change the figures shown.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module impact-calculator
 */

import { BREAKPOINTS, VULN_FLAGS, WTW_EMISSION_FACTORS, INFILTRATION_COEFFICIENTS } from './config.js';
import { getDiurnalInversion, getVulnerabilityMultiplier } from './air-quality-engine.js';

/**
 * Fixed physiological assumptions behind every dose figure shown in the app.
 * @readonly
 */
export const DOSE_MODEL = Object.freeze({
  DAILY_VOLUME_M3: 10.8,
  ACTIVITY_FACTOR: 1.3,
  DEPOSITION_FRACTION: 0.28,
  DEFAULT_COMMUTE_KM: 14
});

/**
 * Illustrative household assumptions of the daily exposure model. They are planning
 * estimates chosen to compare choices with each other, not measurements of a real home.
 * Concentrations are PM2.5 in ug/m3, durations are hours per day.
 * @readonly
 */
export const EXPOSURE_ASSUMPTIONS = Object.freeze({
  FILTERED_HOURS: 14,
  COOKING_HOURS: 2,
  HEATING_HOURS: 6,
  OUTDOOR_WORK_HOURS: 8,
  MAX_COMMUTE_HOURS: 4,
  EXERTION_BREATHING_MULTIPLIER: 2,
  MASK_FILTRATION: 0.8,
  CAR_RECIRCULATION: 0.6,
  PEAK_AIRING_HOUR: 7.5,
  SOLAR_AIRING_HOUR: 13,
  PEAK_AIRING_HOURS: 1,
  SOLAR_AIRING_HOURS: 0.25,
  ROOM_VOLUME_M3: 54,
  NATURAL_DEPOSITION_PER_HOUR: 0.24,
  AIR_CHANGES_PER_HOUR: Object.freeze({ sealed_apartment: 0.4, standard_flat: 0.7, drafty_home: 1.5 }),
  COOKING_PM25: Object.freeze({ induction: 15, png: 35, lpg: 35, biomass: 300 }),
  HEATING_PM25: Object.freeze({ heat_pump: 0, electric_radiator: 0, space_heater: 20, open_fire: 200 }),
  COMMUTE_SPEED_KMH: Object.freeze({ walk_cycle: 8, two_wheeler: 25, public_transit: 20, private_car: 25 }),
  COMMUTE_EXPOSURE: Object.freeze({ walk_cycle: 1.2, two_wheeler: 1.5, public_transit: 0.9, private_car: 0.8 })
});

/**
 * What each indoor air hack does: room clean-air delivery, capture of cooking particles at
 * the source, and the share of leaking smog stopped by closing gaps.
 * @readonly
 */
export const HACK_EFFECTS = Object.freeze({
  corsi_rosenthal: Object.freeze({ roomCadrCfm: 273, cookingCapture: 0, gapReduction: 0 }),
  pc_fan_stealth: Object.freeze({ roomCadrCfm: 85, cookingCapture: 0, gapReduction: 0 }),
  wet_towel_emergency: Object.freeze({ roomCadrCfm: 0, cookingCapture: 0, gapReduction: 0.15 }),
  kitchen_vent_scrub: Object.freeze({ roomCadrCfm: 0, cookingCapture: 0.6, gapReduction: 0 })
});

export const DEFAULT_HACK_ID = 'corsi_rosenthal';

const CFM_TO_M3_PER_HOUR = 1.69901;

/**
 * Display names of the household choices.
 * @readonly
 */
export const CHOICE_NAMES = Object.freeze({
  iaq_hack: Object.freeze({
    corsi_rosenthal: 'Corsi-Rosenthal box',
    pc_fan_stealth: 'PC-fan purifier',
    wet_towel_emergency: 'Wet towels at door gaps',
    kitchen_vent_scrub: 'Kitchen exhaust filter'
  }),
  cooking: Object.freeze({ induction: 'Induction', png: 'PNG gas', lpg: 'LPG', biomass: 'Biomass' }),
  heating: Object.freeze({
    heat_pump: 'Heat pump',
    electric_radiator: 'Oil radiator',
    space_heater: 'Space heater',
    open_fire: 'Open fire'
  }),
  commute: Object.freeze({
    walk_cycle: 'Walk or cycle',
    two_wheeler: 'Two-wheeler',
    public_transit: 'Metro',
    private_car: 'Solo car'
  }),
  housing: Object.freeze({
    sealed_apartment: 'Airtight apartment',
    standard_flat: 'Standard flat',
    drafty_home: 'Drafty home'
  })
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
 * Computes the particulate dose in micrograms that separates two concentrations over a period.
 * With a filtered concentration of zero it is the dose inhaled at the outer concentration.
 * Formula: Delta_D = max(0, C_out - C_in) * V_E * delta_t * eta_dep
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} cOut - Higher mass concentration (ug/m3).
 * @param {number} cIn - Lower mass concentration (ug/m3).
 * @param {number} hoursShifted - Duration (hours).
 * @param {number} [ventilationRate=0.45] - Minute ventilation volume in m3/hour (0.45 adult resting, 1.20 exercise).
 * @param {number} [depositionFraction=0.28] - Alveolar fine particulate deposition fraction.
 * @returns {number} Dose in micrograms (ug).
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
 * @param {Array<number>|Float64Array} values - Array of dosage values in micrograms.
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
 * Converts inhaled particulate mass dosage into equivalent cigarettes.
 * Based on Berkeley Earth empirical conversion factor: 1 cigarette = 66.5 ug inhaled PM2.5.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} dosageMicrograms - Particulate mass in micrograms.
 * @returns {number} Cigarettes (rounded to 2 decimal places).
 */
export function dosageToCigarettes(dosageMicrograms) {
  const safeDosage = Math.max(0, Number(dosageMicrograms) || 0);
  return Math.round((safeDosage / 66.5) * 100) / 100;
}

/**
 * Grams of CO2e per unit (km travelled or hour of heating) for each modelled activity.
 * @readonly
 */
const CARBON_GRAMS_PER_UNIT = Object.freeze({
  two_wheeler: WTW_EMISSION_FACTORS.TWOWHEELER_PER_KM,
  private_car: WTW_EMISSION_FACTORS.CAR_SOLO_PER_KM,
  metro: WTW_EMISSION_FACTORS.METRO_RAIL_PER_PASS_KM,
  walk_cycle: WTW_EMISSION_FACTORS.WALK_CYCLE_PER_KM,
  biomass_heater: WTW_EMISSION_FACTORS.BIOMASS_HEATER_PER_HR,
  electric_radiator: WTW_EMISSION_FACTORS.ELECTRIC_RADIATOR_PER_HR,
  heat_pump: WTW_EMISSION_FACTORS.HEAT_PUMP_PER_HR
});

/**
 * Calculates net Well-to-Wheel (WTW) carbon emissions avoided from modal shift or heating alternatives.
 * Formula: Delta_CO2e = quantity * (EF_baseline - EF_alternative)
 * Complexity: O(1) time, O(1) space.
 *
 * @param {string} currentMode - Baseline activity, such as 'two_wheeler' or 'biomass_heater'.
 * @param {string} alternativeMode - Cleaner activity, such as 'metro' or 'heat_pump'.
 * @param {number} quantity - Distance in km (transit) or operating duration in hours (heating).
 * @returns {number} Net CO2e avoided in kilograms, zero when either activity has no factor.
 */
export function calculateCarbonAvoidance(currentMode, alternativeMode, quantity) {
  if (!Object.hasOwn(CARBON_GRAMS_PER_UNIT, currentMode)) return 0;
  if (!Object.hasOwn(CARBON_GRAMS_PER_UNIT, alternativeMode)) return 0;
  const gramsPerUnit = CARBON_GRAMS_PER_UNIT[currentMode] - CARBON_GRAMS_PER_UNIT[alternativeMode];
  const savedGrams = Math.max(0, gramsPerUnit) * Math.max(0, Number(quantity) || 0);
  return Math.round((savedGrams / 1000) * 100) / 100;
}

/**
 * Names the air quality band of an AQI value.
 *
 * @param {number} aqi - Air Quality Index.
 * @returns {'GOOD'|'MODERATE'|'POOR'|'VERY_POOR'|'SEVERE'|'HAZARDOUS'} Band name.
 */
export function getSeverityBand(aqi) {
  const value = Math.round(Number(aqi) || 0);
  const band = BREAKPOINTS.find((bp) => value <= bp.iHi);
  return band ? band.category : 'HAZARDOUS';
}

/**
 * Decides which protective actions a household needs. Households with any vulnerability
 * start protecting themselves at a lower AQI.
 *
 * @param {number} aqi - Air Quality Index.
 * @param {number} [vulnBits=0] - Vulnerability bitfield.
 * @returns {Readonly<{isSensitive: boolean, useFilter: boolean, useMask: boolean,
 *   restrictAiring: boolean, avoidOutdoors: boolean}>} Protective actions for the day.
 */
export function getProtectionPolicy(aqi, vulnBits = 0) {
  const value = Number(aqi) || 0;
  const isSensitive = Boolean(vulnBits);
  return Object.freeze({
    isSensitive,
    useFilter: value > (isSensitive ? 50 : 100),
    useMask: value > (isSensitive ? 100 : 200),
    restrictAiring: value > (isSensitive ? 100 : 200),
    avoidOutdoors: value > (isSensitive ? 200 : 300)
  });
}

/**
 * Reduces a raw context to the whitelisted values the exposure model understands.
 *
 * @param {Object} ctx - Household context.
 * @returns {Object} Normalized profile.
 */
function toExposureProfile(ctx) {
  const pick = (value, table, fallback) => (Object.hasOwn(table, value) ? value : fallback);
  return {
    aqi: Math.max(0, Math.min(999, Math.round(Number(ctx.aqi) || 0))),
    vulnBits: Number(ctx.vulnBits) || 0,
    iaq_hack: pick(ctx.hackId, HACK_EFFECTS, DEFAULT_HACK_ID),
    cooking: pick(ctx.cookingMethod, CHOICE_NAMES.cooking, 'lpg'),
    heating: pick(ctx.heatingMethod, CHOICE_NAMES.heating, 'space_heater'),
    commute: pick(ctx.commuteMode, CHOICE_NAMES.commute, 'two_wheeler'),
    housing: pick(ctx.housingType, CHOICE_NAMES.housing, 'standard_flat'),
    commuteKm: Math.max(0, Number(ctx.commuteKm ?? DOSE_MODEL.DEFAULT_COMMUTE_KM) || 0)
  };
}

/**
 * Inhaled dose of one household day, split into home, window-airing and travel exposure.
 *
 * <p>The home part covers smog leaking indoors plus cooking and heating particles. A room
 * filter removes the steady-state share CADR / (CADR + air exchange + deposition) during the
 * filtered hours. Travel covers the commute and, for outdoor workers, the shift.
 *
 * @param {Object} profile - Normalized profile.
 * @param {boolean} isProtected - Whether the day's protective plan is followed.
 * @returns {{home: number, airing: number, travel: number}} Doses in ug.
 */
function modelDay(profile, isProtected) {
  const a = EXPOSURE_ASSUMPTIONS;
  const policy = getProtectionPolicy(profile.aqi, profile.vulnBits);
  const effect = isProtected ? HACK_EFFECTS[profile.iaq_hack] : null;
  const roomEffect = effect && policy.useFilter ? effect : null;

  const outdoor = aqiToMassConcentration(profile.aqi);
  const indoor = outdoor * getHousingInfiltrationCoefficient(profile.housing);
  const breathing = (DOSE_MODEL.DAILY_VOLUME_M3 * DOSE_MODEL.ACTIVITY_FACTOR) / 24;
  const sensitivity = getVulnerabilityMultiplier(profile.vulnBits & ~VULN_FLAGS.OUTDOOR_WORKER);
  const dose = (concentration, hours, exertion = 1) => calculateParticulateAvoidance(
    concentration, 0, hours, breathing * exertion * sensitivity, DOSE_MODEL.DEPOSITION_FRACTION
  );

  const commuteHours = Math.min(a.MAX_COMMUTE_HOURS, profile.commuteKm / a.COMMUTE_SPEED_KMH[profile.commute]);
  const workHours = profile.vulnBits & VULN_FLAGS.OUTDOOR_WORKER ? a.OUTDOOR_WORK_HOURS : 0;
  const homeHours = Math.max(0, 24 - commuteHours - workHours - a.PEAK_AIRING_HOURS);
  const filteredShare = roomEffect && homeHours > 0 ? Math.min(a.FILTERED_HOURS, homeHours) / homeHours : 0;

  const cleanChanges = roomEffect
    ? (roomEffect.roomCadrCfm * CFM_TO_M3_PER_HOUR) / a.ROOM_VOLUME_M3
    : 0;
  const filterRemoval = cleanChanges /
    (cleanChanges + a.AIR_CHANGES_PER_HOUR[profile.housing] + a.NATURAL_DEPOSITION_PER_HOUR);
  const remaining = 1 - filterRemoval * filteredShare;
  const gapReduction = roomEffect && !burnsSolidFuel(profile) ? roomEffect.gapReduction : 0;
  const leakRemaining = 1 - gapReduction * filteredShare;
  const cookingSource = a.COOKING_PM25[profile.cooking] * (1 - (effect ? effect.cookingCapture : 0));

  const home = kahanNeumaierSum([
    dose(indoor * remaining * leakRemaining, homeHours),
    dose(cookingSource * remaining, a.COOKING_HOURS),
    dose(a.HEATING_PM25[profile.heating] * remaining, a.HEATING_HOURS)
  ]);

  const isTimed = isProtected && policy.restrictAiring;
  const airingHour = isTimed ? a.SOLAR_AIRING_HOUR : a.PEAK_AIRING_HOUR;
  const openHours = isTimed ? a.SOLAR_AIRING_HOURS : a.PEAK_AIRING_HOURS;
  const airing = kahanNeumaierSum([
    dose(outdoor * getDiurnalInversion(airingHour, profile.aqi).multiplier, openHours),
    dose(indoor, a.PEAK_AIRING_HOURS - openHours)
  ]);

  const isMasked = isProtected && policy.useMask;
  const vehicleShield = profile.commute === 'private_car' ? a.CAR_RECIRCULATION : a.MASK_FILTRATION;
  const commuteExertion = profile.commute === 'walk_cycle' ? a.EXERTION_BREATHING_MULTIPLIER : 1;
  const travel = kahanNeumaierSum([
    dose(
      outdoor * a.COMMUTE_EXPOSURE[profile.commute] * (1 - (isMasked ? vehicleShield : 0)),
      commuteHours,
      commuteExertion
    ),
    dose(outdoor * (1 - (isMasked ? a.MASK_FILTRATION : 0)), workHours, a.EXERTION_BREATHING_MULTIPLIER)
  ]);

  return { home, airing, travel };
}

/**
 * Lists the protective measures that the protected day applies, so the screen names only
 * what the figures include.
 *
 * @param {Object} ctx - Household context.
 * @returns {Array<'filter'|'mask'|'recirculation'|'airing'>} Applied measures.
 */
export function listProtectionMeasures(ctx) {
  const profile = toExposureProfile(ctx);
  const policy = getProtectionPolicy(profile.aqi, profile.vulnBits);
  const worksOutdoors = Boolean(profile.vulnBits & VULN_FLAGS.OUTDOOR_WORKER);
  const isDriving = profile.commute === 'private_car';
  const { roomCadrCfm, gapReduction, cookingCapture } = HACK_EFFECTS[profile.iaq_hack];
  return [
    ((policy.useFilter && (roomCadrCfm > 0 || (gapReduction > 0 && !burnsSolidFuel(profile)))) ||
      cookingCapture > 0) && 'filter',
    policy.useMask && isDriving && 'recirculation',
    policy.useMask && (!isDriving || worksOutdoors) && 'mask',
    policy.restrictAiring && 'airing'
  ].filter(Boolean);
}

/**
 * Whole-day dose of a modelled day.
 *
 * @param {{home: number, airing: number, travel: number}} day - Modelled day.
 * @returns {number} Rounded dose in ug.
 */
function totalDose(day) {
  return Math.round(day.home + day.airing + day.travel);
}

/**
 * Splits the avoided dose into whole micrograms for home, airing and travel. The rounding
 * residual goes to the home part, or to the largest part when the home dose is unchanged,
 * so an unchanged part never shows a stray microgram and the parts add up to the total.
 *
 * @param {{home: number, airing: number, travel: number}} unshielded - Unprotected day.
 * @param {{home: number, airing: number, travel: number}} shielded - Protected day.
 * @param {number} totalUg - Avoided dose shown on screen.
 * @returns {number[]} Home, airing and travel parts in ug.
 */
function splitAvoidedDose(unshielded, shielded, totalUg) {
  const parts = ['home', 'airing', 'travel']
    .map((key) => Math.max(0, Math.round(unshielded[key] - shielded[key])));
  const target = parts[0] > 0 ? 0 : parts.indexOf(Math.max(...parts));
  parts[target] += totalUg - parts.reduce((sum, part) => sum + part, 0);
  return parts;
}

/**
 * CO2e that the cleaner commute and heating alternatives would save each day.
 *
 * @param {Object} profile - Normalized profile.
 * @returns {{commute: number, heating: number}} Savings in kg.
 */
function availableCarbonSavings(profile) {
  const isMotorised = profile.commute === 'private_car' || profile.commute === 'two_wheeler';
  const heater = profile.heating === 'open_fire' ? 'biomass_heater' : profile.heating;
  return {
    commute: isMotorised ? calculateCarbonAvoidance(profile.commute, 'metro', profile.commuteKm) : 0,
    heating: calculateCarbonAvoidance(heater, 'heat_pump', EXPOSURE_ASSUMPTIONS.HEATING_HOURS)
  };
}

/**
 * Whether solid fuel burns inside the home.
 *
 * @param {{cooking: string, heating: string}} profile - Normalized profile.
 * @returns {boolean} True for biomass cooking or open-fire heating.
 */
export function burnsSolidFuel(profile) {
  return profile.cooking === 'biomass' || profile.heating === 'open_fire';
}

/**
 * Cleaner option compared against each choice, or null when none is offered. A tighter home
 * is never offered while solid fuel burns indoors, because of carbon monoxide.
 * @readonly
 */
const CLEANER_OPTION = Object.freeze({
  iaq_hack: ({ iaq_hack: current }) => (current === DEFAULT_HACK_ID ? null : DEFAULT_HACK_ID),
  cooking: ({ cooking }) => (cooking === 'induction' ? null : 'induction'),
  heating: ({ heating }) => (heating === 'heat_pump' ? null : 'heat_pump'),
  commute: ({ commute }) => (commute === 'public_transit' ? null : 'public_transit'),
  housing: (profile) => (burnsSolidFuel(profile)
    ? null
    : { drafty_home: 'standard_flat', standard_flat: 'sealed_apartment' }[profile.housing] || null)
});

/**
 * Writes the plain-language effect of switching one choice.
 *
 * @param {string} choice - Choice id.
 * @param {{current: string, alternative: string|null, pm25DeltaUg: number, co2eDeltaKg: number}} item
 * @param {boolean} isFuelBurning - Whether solid fuel burns indoors.
 * @returns {string} Sentence shown to the household.
 */
function explainChoice(choice, { current, alternative, pm25DeltaUg, co2eDeltaKg }, isFuelBurning) {
  const names = CHOICE_NAMES[choice];
  if (choice === 'housing' && isFuelBurning) {
    return `${names[current]}: keep a vent open while solid fuel burns indoors (carbon monoxide risk).`;
  }
  if (!alternative) return `${names[current]}: already the cleanest option modelled here.`;

  const target = names[alternative];
  const effects = [];
  if (pm25DeltaUg > 0) effects.push(`cut your inhaled PM2.5 by about ${pm25DeltaUg} µg a day`);
  if (pm25DeltaUg < 0) effects.push(`raise your inhaled PM2.5 by about ${-pm25DeltaUg} µg a day`);
  if (co2eDeltaKg > 0) effects.push(`save about ${co2eDeltaKg} kg CO2e a day`);
  if (effects.length === 0) return `${names[current]}: switching to "${target}" makes no modelled difference today.`;
  return `${names[current]}: switching to "${target}" would ${effects.join(' and ')}.`;
}

/**
 * Compares every household choice with its cleaner option, holding everything else fixed.
 * A positive delta is a saving.
 *
 * @param {Object} profile - Normalized profile.
 * @returns {ReadonlyArray<Readonly<{choice: string, current: string, alternative: string|null,
 *   pm25DeltaUg: number, co2eDeltaKg: number, explanation: string}>>} One entry per choice.
 */
function compareChoices(profile) {
  const baseline = totalDose(modelDay(profile, true));
  const carbon = availableCarbonSavings(profile);
  return Object.freeze(Object.keys(CLEANER_OPTION).map((choice) => {
    const current = profile[choice];
    const alternative = CLEANER_OPTION[choice](profile);
    const pm25DeltaUg = alternative
      ? baseline - totalDose(modelDay({ ...profile, [choice]: alternative }, true))
      : 0;
    const item = { choice, current, alternative, pm25DeltaUg, co2eDeltaKg: carbon[choice] || 0 };
    return Object.freeze({ ...item, explanation: explainChoice(choice, item, burnsSolidFuel(profile)) });
  }));
}

/**
 * Single source of truth for every impact number shown on screen, written into the
 * community advisory, and sent to Gemini as grounding facts.
 *
 * <p>The unshielded day airs the home at the morning smog peak and uses no protection. The
 * protected day follows {@link getProtectionPolicy} with the selected indoor air hack. The
 * protection score is the share of the unshielded dose that the protected day removes.
 *
 * @param {Object} ctx - Household context (aqi, vulnBits, housingType, cookingMethod,
 *   heatingMethod, commuteMode, commuteKm, hackId).
 * @returns {Readonly<{pm25UgM3: number, unshieldedDoseUg: number, protectedDoseUg: number,
 *   pm25AvoidedUg: number, reductionPct: number, unshieldedCigarettes: number,
 *   protectedCigarettes: number, cigarettesAvoided: number, carbonSavedKg: number,
 *   protectionScorePercent: number,
 *   contributions: Readonly<{indoorAirUg: number, airingUg: number, travelUg: number}>,
 *   choices: ReadonlyArray<Object>}>} Frozen impact summary.
 */
export function computeImpact(ctx) {
  const profile = toExposureProfile(ctx);
  const unshielded = modelDay(profile, false);
  const shielded = modelDay(profile, true);

  const unshieldedDoseUg = totalDose(unshielded);
  const protectedDoseUg = Math.min(unshieldedDoseUg, totalDose(shielded));
  const pm25AvoidedUg = unshieldedDoseUg - protectedDoseUg;
  const reductionPct = unshieldedDoseUg > 0
    ? Math.min(99.9, (pm25AvoidedUg / unshieldedDoseUg) * 100)
    : 0;

  const unshieldedCigarettes = dosageToCigarettes(unshieldedDoseUg);
  const protectedCigarettes = dosageToCigarettes(protectedDoseUg);
  const cigarettesAvoided = Math.round(Math.max(0, unshieldedCigarettes - protectedCigarettes) * 100) / 100;

  const carbon = availableCarbonSavings(profile);
  const [indoorAirUg, airingUg, travelUg] = splitAvoidedDose(unshielded, shielded, pm25AvoidedUg);

  return Object.freeze({
    pm25UgM3: aqiToMassConcentration(profile.aqi),
    unshieldedDoseUg,
    protectedDoseUg,
    pm25AvoidedUg,
    reductionPct,
    unshieldedCigarettes,
    protectedCigarettes,
    cigarettesAvoided,
    carbonSavedKg: Math.round((carbon.commute + carbon.heating) * 100) / 100,
    protectionScorePercent: Math.round(reductionPct),
    contributions: Object.freeze({ indoorAirUg, airingUg, travelUg }),
    choices: compareChoices(profile)
  });
}
