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
 * Geographical latitude and longitude coordinates for all supported air basins.
 * Used for Haversine great-circle distance matching.
 * @readonly
 * @type {Object<string, {lat: number, lon: number}>}
 */
export const METRO_BASIN_COORDINATES = Object.freeze({
  'Delhi NCR': { lat: 28.6139, lon: 77.2090 },
  'Lahore': { lat: 31.5204, lon: 74.3587 },
  'Kolkata': { lat: 22.5726, lon: 88.3639 },
  'Patna': { lat: 25.5941, lon: 85.1376 },
  'Lucknow': { lat: 26.8467, lon: 80.9462 },
  'Beijing': { lat: 39.9042, lon: 116.4074 },
  'Ulaanbaatar': { lat: 47.9188, lon: 106.9176 },
  'Salt Lake City Basin': { lat: 40.7608, lon: -111.8910 }
});

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

/**
 * 4 Quantitative Target Personas from Problem Statement (docs/00 §5).
 * @readonly
 * @type {Readonly<Object<string, {id: string, name: string, city: string, aqi: number, vulnBits: number, housingType: string, cookingMethod: string, heatingMethod: string, commuteMode: string, commuteKm: number}>>}
 */
export const TARGET_PERSONAS = Object.freeze({
  ananya: {
    id: 'ananya',
    name: 'Ananya (Infant 18m)',
    city: 'Delhi NCR',
    aqi: 425,
    vulnBits: VULN_FLAGS.INFANT,
    housingType: 'standard_flat',
    cookingMethod: 'lpg',
    heatingMethod: 'space_heater',
    commuteMode: 'two_wheeler',
    commuteKm: 8
  },
  rajesh: {
    id: 'rajesh',
    name: 'Rajesh (Asthma & Senior 68y)',
    city: 'Lahore',
    aqi: 380,
    vulnBits: VULN_FLAGS.ASTHMA | VULN_FLAGS.SENIOR,
    housingType: 'sealed_apartment',
    cookingMethod: 'png',
    heatingMethod: 'electric_radiator',
    commuteMode: 'walk_cycle',
    commuteKm: 2
  },
  vikram: {
    id: 'vikram',
    name: 'Vikram (2-Wheeler Commute)',
    city: 'Delhi NCR',
    aqi: 410,
    vulnBits: 0,
    housingType: 'standard_flat',
    cookingMethod: 'induction',
    heatingMethod: 'heat_pump',
    commuteMode: 'two_wheeler',
    commuteKm: 22
  },
  ramesh: {
    id: 'ramesh',
    name: 'Ramesh (Outdoor Worker)',
    city: 'Delhi NCR',
    aqi: 460,
    vulnBits: VULN_FLAGS.OUTDOOR_WORKER,
    housingType: 'drafty_home',
    cookingMethod: 'biomass',
    heatingMethod: 'open_fire',
    commuteMode: 'walk_cycle',
    commuteKm: 14
  }
});

/**
 * Factory function creating monomorphic UserContext instances for V8 IC optimization.
 * Initializes properties in strictly identical lexical sequence.
 * Conforms to LLD 03 §4.1.
 *
 * @param {string} city - Metropolitan urban air basin name.
 * @param {number} aqi - Air Quality Index scalar.
 * @param {number} vulnBits - 5-bit vulnerability bitmask.
 * @param {number} cookIdx - Cooking method index (0-3).
 * @param {number} heatIdx - Heating method index (0-3).
 * @param {number} commuteIdx - Commute mode index (0-3).
 * @param {number|null} [timeHour=null] - Simulated decimal hour.
 * @returns {Object} Monomorphic context object.
 */
export function createContext(city, aqi, vulnBits, cookIdx, heatIdx, commuteIdx, timeHour = null) {
  const cookingMethods = ['induction', 'png', 'lpg', 'biomass'];
  const heatingMethods = ['electric_radiator', 'space_heater', 'heat_pump', 'open_fire'];
  const commuteModes = ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car'];

  return {
    city: String(city || 'Delhi NCR'),
    aqi: Number(aqi) || 0,
    vulnBits: Number(vulnBits) || 0,
    cookingMethod: cookingMethods[Number(cookIdx) || 2] || 'lpg',
    heatingMethod: heatingMethods[Number(heatIdx) || 1] || 'space_heater',
    commuteMode: commuteModes[Number(commuteIdx) || 1] || 'two_wheeler',
    commuteKm: 14,
    simulatedHour: timeHour !== null ? Number(timeHour) : null
  };
}
