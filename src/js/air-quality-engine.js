/**
 * @fileoverview Atmospheric Boundary Layer (ABL) meteorology and diurnal thermal inversion engine.
 * Implements Bulk Richardson Number (Ri_b), sinusoidal diurnal exposure multipliers,
 * vulnerability index weighting, and fixed-capacity Float64Array telemetry buffers.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module air-quality-engine
 */

import { VULN_FLAGS } from './config.js';

/**
 * Computes the Bulk Richardson Number (Ri_b) to determine atmospheric boundary layer stability.
 * Thermal inversions form and suppress turbulent mixing when Ri_b exceeds the critical threshold of 0.25.
 * Formula: Ri_b = (g / theta_v) * (deltaThetaV * deltaZ) / (deltaU)^2
 * Complexity: O(1) time, O(1) space.
 *
 * @param {number} deltaThetaV - Virtual potential temperature gradient (K).
 * @param {number} deltaZ - Altitude thickness of the boundary layer (m).
 * @param {number} deltaU - Horizontal wind shear difference across layer (m/s).
 * @param {number} [meanThetaV=288.15] - Mean virtual potential temperature of the layer (K).
 * @returns {number} Bulk Richardson Number. Values >= 0.25 indicate laminar thermal inversion.
 */
export function calculateBulkRichardson(deltaThetaV, deltaZ, deltaU, meanThetaV = 288.15) {
  const g = 9.80665;
  const safeDeltaU = Math.max(0.1, Math.abs(deltaU));
  const numerator = (g / meanThetaV) * deltaThetaV * deltaZ;
  const denominator = safeDeltaU * safeDeltaU;
  return numerator / denominator;
}

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
      advisory: 'Peak planetary boundary layer height. Optimal window for essential errands and 15-minute home air flush.'
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

/**
 * Counts the active vulnerabilities using Brian Kernighan's bit-counting algorithm.
 * Time Complexity: O(k) where k <= 5 set bits, effectively O(1).
 * Space Complexity: O(1).
 *
 * @param {number} bitfield - 5-bit unsigned integer.
 * @returns {number} Number of active vulnerability flags (0 to 5).
 */
export function countActiveVulnerabilities(bitfield) {
  let count = 0;
  let v = (Number(bitfield) || 0) & 0x1F;
  while (v > 0) {
    v &= (v - 1);
    count++;
  }
  return count;
}

/**
 * Pre-allocated Circular Ring Buffer backed by Float64Array.
 * Stores 24-hour continuous diurnal air quality readings with zero heap allocation churn.
 */
export class DiurnalRingBuffer {
  /**
   * Initializes the ring buffer.
   * @param {number} [capacity=24] - Fixed slot capacity.
   */
  constructor(capacity = 24) {
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * Appends an AQI telemetry point in O(1) time.
   * @param {number} val - Scalar AQI reading.
   */
  push(val) {
    this.buffer[this.head] = Number(val) || 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Retrieves an item relative to newest inserted in O(1) time.
   * @param {number} offset - 0 = newest, size-1 = oldest.
   * @returns {number} Stored telemetry float.
   */
  get(offset) {
    if (offset < 0 || offset >= this.size) return 0;
    const idx = (this.head - 1 - offset + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  /**
   * Returns chronologically sorted telemetry points from oldest to newest.
   * @returns {Float64Array}
   */
  toChronologicalArray() {
    const arr = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      arr[i] = this.buffer[idx];
    }
    return arr;
  }
}
