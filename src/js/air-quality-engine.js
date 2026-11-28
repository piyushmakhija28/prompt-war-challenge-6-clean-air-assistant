/**
 * @fileoverview Diurnal thermal inversion model: time-of-day exposure multipliers, the
 * 24-hour curve, and vulnerability index weighting.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module air-quality-engine
 */

import { VULN_FLAGS } from './config.js';

/**
 * Diurnal phase state descriptor.
 * @typedef {Object} DiurnalState
 * @property {string} phase - Canonical phase code: MORNING_TRAP, SOLAR_DISPERSAL, EVENING_TRAP, or NIGHT_INVERSION.
 * @property {number} multiplier - Atmospheric concentration scaling factor (0.85 to 2.20).
 * @property {boolean} isVentilationAllowed - Whether outdoor convective aeration is safe.
 * @property {number} effectiveAQI - Scaled localized AQI accounting for surface boundary layer trapping.
 * @property {string} advisory - Concise micro-meteorological advisory sentence.
 */

/**
 * Evaluates the atmospheric boundary layer inversion state at an arbitrary decimal hour.
 * Allows time-scrubbing (0.00 to 23.99 hours) for competition evaluation.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} hourDecimal - Time of day in decimal hours (e.g. 7.5 for 07:30 AM).
 * @param {number} baseAQI - Baseline 24-hour ambient AQI reading.
 * @returns {DiurnalState} Active diurnal state and localized effective air quality.
 */
export function getDiurnalInversion(hourDecimal, baseAQI) {
  const h = ((Number(hourDecimal) % 24) + 24) % 24;
  const safeAQI = Math.max(0, Math.min(999, Math.round(Number(baseAQI) || 0)));

  if (h >= 6.0 && h < 9.5) {
    const progress = (h - 6.0) / 3.5;
    const multiplier = 2.0 + 0.20 * Math.sin(progress * Math.PI);
    return {
      phase: 'MORNING_TRAP',
      multiplier: Math.round(multiplier * 100) / 100,
      isVentilationAllowed: false,
      effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
      advisory: 'Severe radiation inversion trap active. Particulate matter compressed at ground level; cancel outdoor walks.'
    };
  }

  if (h >= 9.5 && h < 12.5) {
    const progress = (h - 9.5) / 3.0;
    const multiplier = 1.90 - progress * 0.95;
    return {
      phase: 'PRE_DISPERSAL',
      multiplier: Math.round(multiplier * 100) / 100,
      isVentilationAllowed: false,
      effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
      advisory: 'Solar heating initiating convective boundary layer growth; inversion beginning to erode.'
    };
  }

  if (h >= 12.5 && h < 15.5) {
    const progress = (h - 12.5) / 3.0;
    const multiplier = 0.90 - 0.05 * Math.sin(progress * Math.PI);
    return {
      phase: 'SOLAR_DISPERSAL',
      multiplier: Math.round(multiplier * 100) / 100,
      isVentilationAllowed: true,
      effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
      advisory: 'Peak planetary boundary layer height. The best window of the day for essential errands and a short home airing; follow the schedule below.'
    };
  }

  if (h >= 15.5 && h < 18.0) {
    const progress = (h - 15.5) / 2.5;
    const multiplier = 0.95 + progress * 0.85;
    return {
      phase: 'AFTERNOON_SHIFT',
      multiplier: Math.round(multiplier * 100) / 100,
      isVentilationAllowed: false,
      effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
      advisory: 'Surface cooling setting in. Re-seal all windows before evening rush traffic exhaust is trapped.'
    };
  }

  if (h >= 18.0 && h < 22.0) {
    const progress = (h - 18.0) / 4.0;
    const multiplier = 1.80 + 0.15 * Math.sin(progress * Math.PI);
    return {
      phase: 'EVENING_TRAP',
      multiplier: Math.round(multiplier * 100) / 100,
      isVentilationAllowed: false,
      effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
      advisory: 'Secondary evening inversion trap active. Keep cooking ventilation isolated and air purifiers engaged.'
    };
  }

  const multiplier = 1.40;
  return {
    phase: 'NIGHT_INVERSION',
    multiplier,
    isVentilationAllowed: false,
    effectiveAQI: Math.min(999, Math.round(safeAQI * multiplier)),
    advisory: 'Stable nocturnal boundary layer. Keep bedrooms tightly sealed with filtration running in sleep mode.'
  };
}

/**
 * Projects a reading observed at a known hour onto another hour of the day. The reading
 * already contains the atmospheric effect of its own hour, so only the ratio between the
 * two diurnal multipliers is applied.
 *
 * @param {number} hourDecimal - Hour to project onto.
 * @param {number} observedAQI - AQI measured or modelled at the observation time.
 * @param {string} observedAt - Local observation time, 'YYYY-MM-DDTHH:mm'.
 * @returns {{phase: string, ratio: number, effectiveAQI: number, observedClock: string}|null}
 *   Projection, or null when the observation time cannot be read.
 */
export function projectDiurnalReading(hourDecimal, observedAQI, observedAt) {
  const clock = /T([01]\d|2[0-3]):([0-5]\d)/.exec(String(observedAt || ''));
  if (!clock) return null;
  const observedHour = Number(clock[1]) + Number(clock[2]) / 60;
  const target = getDiurnalInversion(hourDecimal, observedAQI);
  const ratio = target.multiplier / getDiurnalInversion(observedHour, observedAQI).multiplier;
  const safeAQI = Math.max(0, Math.min(999, Math.round(Number(observedAQI) || 0)));

  return {
    phase: target.phase,
    ratio: Math.round(ratio * 100) / 100,
    effectiveAQI: Math.min(999, Math.round(safeAQI * ratio)),
    observedClock: `${clock[1]}:${clock[2]}`
  };
}

/**
 * Generates continuous 24-hour Diurnal Inversion Spline coordinates and SVG path data.
 * Samples at 15-minute intervals (N = 96 points) across the astronomical cycle.
 * ViewBox domain: width = 240, height = 40.
 *
 * @param {number} [baseAQI=100] - Baseline Air Quality Index.
 * @returns {{ points: Array<{hour: number, multiplier: number, effectiveAQI: number, x: number, y: number}>, pathD: string }}
 */
export function generateDiurnalCurve(baseAQI = 100) {
  const points = [];
  const steps = 96;
  let pathD = '';

  for (let i = 0; i < steps; i++) {
    const hour = (i / steps) * 24;
    const inv = getDiurnalInversion(hour, baseAQI);
    const x = Math.round((hour / 24) * 240 * 10) / 10;
    const normalized = (inv.multiplier - 0.85) / (2.20 - 0.85);
    const clamped = Math.max(0, Math.min(1, normalized));
    const y = Math.round((36 - clamped * 30) * 10) / 10;

    points.push({
      hour,
      multiplier: inv.multiplier,
      effectiveAQI: inv.effectiveAQI,
      x,
      y
    });

    if (i === 0) {
      pathD += `M ${x} ${y}`;
    } else {
      pathD += ` L ${x} ${y}`;
    }
  }

  return { points, pathD };
}

/**
 * Computes composite vulnerability scaling multiplier from the 5-bit integer bitfield.
 * Baseline susceptibility is 1.00; each biological risk adds additive physiological weighting.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} bitfield - 5-bit unsigned integer (0-31).
 * @returns {number} Cumulative physiological multiplier (1.00 to 3.30).
 */
export function getVulnerabilityMultiplier(bitfield) {
  let multiplier = 1.0;
  if (bitfield & VULN_FLAGS.INFANT) multiplier += 0.40;
  if (bitfield & VULN_FLAGS.ASTHMA) multiplier += 0.50;
  if (bitfield & VULN_FLAGS.SENIOR) multiplier += 0.35;
  if (bitfield & VULN_FLAGS.PREGNANT) multiplier += 0.45;
  if (bitfield & VULN_FLAGS.OUTDOOR_WORKER) multiplier += 0.60;
  return Math.round(multiplier * 100) / 100;
}
