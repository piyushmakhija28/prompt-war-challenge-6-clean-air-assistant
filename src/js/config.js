/**
 * @fileoverview Central configuration constants, breakpoint tables, and vulnerability bitfield definitions.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module config
 */

/**
 * 5-bit Vulnerability Bitfield constants.
 * Binary layout: Bit 0 (Infant) to Bit 4 (Outdoor Worker).
 * @readonly
 * @enum {number}
 */
export const VULN_FLAGS = Object.freeze({
  INFANT: 1 << 0,          // 0b00001 (1) - Children under 2 years
  ASTHMA: 1 << 1,          // 0b00010 (2) - Asthma, COPD, or respiratory compromise
  SENIOR: 1 << 2,          // 0b00100 (4) - Elderly individuals 65+
  PREGNANT: 1 << 3,        // 0b01000 (8) - Pregnant women
  OUTDOOR_WORKER: 1 << 4   // 0b10000 (16) - Street vendor / traffic police / high exposure
});

/**
 * Indian CPCB & US EPA standard PM2.5 breakpoint lookup table.
 * Monotonically sorted by index boundaries.
 * @readonly
 * @type {Array<{iLo: number, iHi: number, bLo: number, bHi: number, category: string, color: string}>}
 */
export const BREAKPOINTS = Object.freeze([
  { iLo: 0,   iHi: 50,  bLo: 0.0,   bHi: 30.0,  category: 'GOOD',       color: '#10b981' },
  { iLo: 51,  iHi: 100, bLo: 30.1,  bHi: 60.0,  category: 'MODERATE',   color: '#f59e0b' },
  { iLo: 101, iHi: 200, bLo: 60.1,  bHi: 90.0,  category: 'POOR',       color: '#f97316' },
  { iLo: 201, iHi: 300, bLo: 90.1,  bHi: 120.0, category: 'VERY_POOR',  color: '#ef4444' },
  { iLo: 301, iHi: 400, bLo: 120.1, bHi: 250.0, category: 'SEVERE',     color: '#b91c1c' },
  { iLo: 401, iHi: 500, bLo: 250.1, bHi: 380.0, category: 'HAZARDOUS',  color: '#7f1d1d' }
]);

/**
 * Well-to-Wheel (WTW) lifecycle emissions factors (grams CO2e per unit).
 * Includes both direct Tailpipe (TTW) and upstream electricity/refining (WTW).
 * @readonly
 * @type {Object<string, number>}
 */
export const WTW_EMISSION_FACTORS = Object.freeze({
  CAR_SOLO_PER_KM: 240,       // 192g direct + 48g upstream
  TWOWHEELER_PER_KM: 60,      // 48g direct + 12g upstream
  METRO_RAIL_PER_PASS_KM: 28, // 0g direct + 28g upstream electric grid
  WALK_CYCLE_PER_KM: 0,       // Zero emissions
  BIOMASS_HEATER_PER_HR: 930, // 850g direct + 80g harvest/transport
  ELECTRIC_RADIATOR_PER_HR: 288 // 0g direct + 288g upstream grid (0.72 kg/kWh * 0.4 kWh)
});

/**
 * Building envelope particulate infiltration coefficients (alpha_inf).
 * Represents indoor-to-outdoor concentration ratio under unventilated, closed-window conditions.
 * @readonly
 * @type {Object<string, number>}
 */
export const INFILTRATION_COEFFICIENTS = Object.freeze({
  SEALED_APARTMENT: 0.40,
  STANDARD_FLAT: 0.65,
  DRAFTY_HOME: 0.85
});

/**
 * Pre-indexed metro urban basin presets for rapid triage and 5-byte bitstream packing.
 * @readonly
 * @type {string[]}
 */
export const METRO_BASIN_PRESETS = Object.freeze([
  'Delhi NCR',
  'Lahore',
  'Kolkata',
  'Patna',
  'Lucknow',
  'Beijing',
  'Ulaanbaatar',
  'Salt Lake City Basin'
]);

/**
 * Canonical default household profile.
 * @readonly
 * @type {Readonly<{city: string, aqi: number, vulnBits: number, cookingMethod: string, heatingMethod: string, commuteMode: string, commuteKm: number}>}
 */
export const DEFAULT_PRESET = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  vulnBits: VULN_FLAGS.INFANT | VULN_FLAGS.ASTHMA,
  housingType: 'standard_flat',
  cookingMethod: 'lpg',
  heatingMethod: 'space_heater',
  commuteMode: 'two_wheeler',
  commuteKm: 14
});
