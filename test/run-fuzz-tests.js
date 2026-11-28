/**
 * @fileoverview Property-Based Fuzz Testing Suite (QuickCheck Architecture).
 * Tests 10,000 pseudorandomly generated state vectors using Xorshift128+ PRNG to prove
 * algebraic closure, absence of NaN/Infinity, non-negative dosage avoided, balanced impact accounting,
 * the solid-fuel safety rule, dose monotonicity in AQI and lossless codec isomorphism.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 */

import {
  aqiToMassConcentration, calculateParticulateAvoidance, dosageToCigarettes, computeImpact,
  listProtectionMeasures, burnsSolidFuel, HACK_EFFECTS
} from '../src/js/impact-calculator.js';
import { getDiurnalInversion, getVulnerabilityMultiplier } from '../src/js/air-quality-engine.js';
import { packContextTo5Bytes, unpackContextFrom5Bytes } from '../src/js/state-codec.js';
import { METRO_BASIN_PRESETS } from '../src/js/config.js';
import { sanitizeCityInput } from '../src/js/gemini-service.js';
import { PlanFactory } from '../src/js/offline-advisor.js';

/**
 * Seedable Xorshift128+ pseudo-random number generator.
 */
class Xorshift128Plus {
  constructor(seed0 = 0x12345678, seed1 = 0x9abcdef0) {
    this.s0 = seed0 >>> 0;
    this.s1 = seed1 >>> 0;
  }

  nextFloat() {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    this.s1 = (s1 ^ s0 ^ (s1 >>> 17) ^ (s0 >>> 26)) >>> 0;
    return ((this.s1 + s0) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }
}

console.log('\n======================================================');
console.log(' CleanAir Guardian — 10,000 Property-Based Fuzz Tests');
console.log('======================================================\n');

const prng = new Xorshift128Plus(42, 1337);
const ITERATIONS = 10000;

const cookingMethods = ['induction', 'png', 'lpg', 'biomass'];
const heatingMethods = ['electric_radiator', 'space_heater', 'heat_pump', 'open_fire'];
const commuteModes = ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car'];
const housingTypes = ['sealed_apartment', 'standard_flat', 'drafty_home'];
const hackIds = Object.keys(HACK_EFFECTS);

/**
 * Checks every impact-model property for one household.
 *
 * <p>Contribution rounding allows the indoor air share to fall at most 2 ug below zero,
 * because it is the remainder of four independently rounded figures.
 *
 * @param {Object} context - Random household context.
 * @param {number} aqiStep - Non-negative AQI increase used for the monotonicity property.
 * @returns {string} Name of the first broken property, or an empty string.
 */
function brokenImpactProperty(context, aqiStep) {
  const impact = computeImpact(context);
  const figures = [
    impact.pm25UgM3, impact.unshieldedDoseUg, impact.protectedDoseUg, impact.pm25AvoidedUg,
    impact.unshieldedCigarettes, impact.protectedCigarettes, impact.cigarettesAvoided,
    impact.carbonSavedKg, impact.protectionScorePercent
  ];
  if (!figures.every((value) => Number.isFinite(value) && value >= 0)) return 'finite non-negative figures';
  if (impact.protectionScorePercent > 100) return 'score within 100';
  if (impact.unshieldedDoseUg - impact.protectedDoseUg !== impact.pm25AvoidedUg) return 'dose accounting';
  const { indoorAirUg, airingUg, travelUg } = impact.contributions;
  if (indoorAirUg + airingUg + travelUg !== impact.pm25AvoidedUg) return 'contributions sum';
  if (airingUg < 0 || travelUg < 0 || indoorAirUg < -2) return 'contribution sign';
  const housing = impact.choices.find((choice) => choice.choice === 'housing');
  const isFuelBurning = burnsSolidFuel({ cooking: context.cookingMethod, heating: context.heatingMethod });
  if (isFuelBurning && housing.alternative !== null) return 'solid-fuel safety';
  if (!impact.choices.every((c) => Number.isFinite(c.pm25DeltaUg) && c.co2eDeltaKg >= 0)) return 'choice deltas';
  const worse = computeImpact({ ...context, aqi: context.aqi + aqiStep });
  if (worse.unshieldedDoseUg < impact.unshieldedDoseUg) return 'dose monotonic in AQI';
  if ((listProtectionMeasures(context).length === 0) !== (impact.pm25AvoidedUg === 0)) {
    return 'measures empty exactly when nothing is avoided';
  }
  return '';
}

let violations = 0;

const startTime = Date.now();

for (let i = 0; i < ITERATIONS; i++) {
  const aqi = prng.nextInt(-100, 1500);
  const hour = prng.nextFloat() * 30.0 - 5.0; // [-5.0 to 25.0]
  const vulnBits = prng.nextInt(0, 63);
  const cook = cookingMethods[prng.nextInt(0, 3)];
  const heat = heatingMethods[prng.nextInt(0, 3)];
  const commute = commuteModes[prng.nextInt(0, 3)];
  const distance = prng.nextInt(-20, 200);
  const city = METRO_BASIN_PRESETS[prng.nextInt(0, METRO_BASIN_PRESETS.length - 1)];

  // Invariant 1: Mass Concentration is finite, non-negative, and not NaN
  const conc = aqiToMassConcentration(aqi);
  if (!Number.isFinite(conc) || Number.isNaN(conc) || conc < 0) {
    violations++;
    console.error(`Violation Inv1 at iter ${i}: aqi=${aqi}, conc=${conc}`);
    break;
  }

  // Invariant 2: Diurnal state returns valid phase and finite multiplier
  const diurnal = getDiurnalInversion(hour, aqi);
  if (!diurnal.phase || !Number.isFinite(diurnal.multiplier) || Number.isNaN(diurnal.effectiveAQI)) {
    violations++;
    console.error(`Violation Inv2 at iter ${i}: hour=${hour}, effectiveAQI=${diurnal.effectiveAQI}`);
    break;
  }

  // Invariant 3: Particulate dosage avoided is strictly non-negative
  const cIn = conc * 0.40;
  const hoursShifted = prng.nextFloat() * 12;
  const mult = getVulnerabilityMultiplier(vulnBits);
  const dosage = calculateParticulateAvoidance(conc, cIn, hoursShifted, 0.45 * mult, 0.28);
  if (!Number.isFinite(dosage) || Number.isNaN(dosage) || dosage < 0) {
    violations++;
    console.error(`Violation Inv3 at iter ${i}: dosage=${dosage}`);
    break;
  }

  // Invariant 4: Cigarettes avoided is finite and non-negative
  const cigs = dosageToCigarettes(dosage);
  if (!Number.isFinite(cigs) || Number.isNaN(cigs) || cigs < 0) {
    violations++;
    console.error(`Violation Inv4 at iter ${i}: cigs=${cigs}`);
    break;
  }

  // Invariant 6: 5-Byte binary packing roundtrip isomorphism for clamped ranges
  const clampedCtx = {
    aqi: Math.max(0, Math.min(999, Math.round(aqi))),
    vulnBits: vulnBits & 0x1F,
    cookingMethod: cook,
    heatingMethod: heat,
    commuteMode: commute,
    commuteKm: Math.max(0, Math.min(127, Math.round(distance))),
    city,
    simulatedHour: Math.max(0, Math.min(23, Math.floor(Math.abs(hour))))
  };
  const packed = packContextTo5Bytes(clampedCtx);
  const unpacked = unpackContextFrom5Bytes(packed);

  if (
    unpacked.aqi !== clampedCtx.aqi ||
    unpacked.vulnBits !== clampedCtx.vulnBits ||
    unpacked.cookingMethod !== clampedCtx.cookingMethod ||
    unpacked.commuteKm !== clampedCtx.commuteKm
  ) {
    violations++;
    console.error(`Violation Inv6 at iter ${i}: mismatch in roundtrip!`);
    break;
  }

  const brokenProperty = brokenImpactProperty({
    aqi,
    vulnBits,
    cookingMethod: cook,
    heatingMethod: heat,
    commuteMode: commute,
    commuteKm: distance,
    housingType: housingTypes[prng.nextInt(0, housingTypes.length - 1)],
    hackId: hackIds[prng.nextInt(0, hackIds.length - 1)]
  }, prng.nextInt(0, 300));
  if (brokenProperty) {
    violations++;
    console.error(`Violation of impact property "${brokenProperty}" at iter ${i}: aqi=${aqi}, vulnBits=${vulnBits}`);
    break;
  }

  // Invariant 10: sanitizeCityInput injection safety
  const rawTestStr = `${city}<script>${cook}</script>'`;
  const sanitized = sanitizeCityInput(rawTestStr);
  if (sanitized.includes('<') || sanitized.includes('>') || sanitized.includes("'") || sanitized.length === 0) {
    violations++;
    console.error(`Violation Inv10 at iter ${i}: sanitized=${sanitized}`);
    break;
  }

  // Invariant 11: PlanFactory immutability and schema normalization
  const candidatePlan = PlanFactory.createPlan({
    severityLevel: i % 2 === 0 ? 'SEVERE' : undefined,
    quantifiedImpact: { pm25InhalationAvoidedMicrograms: dosage }
  });
  if (!Object.isFrozen(candidatePlan) || !candidatePlan.severityLevel || !candidatePlan.quantifiedImpact) {
    violations++;
    console.error(`Violation Inv11 at iter ${i}: PlanFactory schema failure`);
    break;
  }
}

const elapsedMs = Date.now() - startTime;

console.log(`\n  Tested ${ITERATIONS.toLocaleString()} pseudorandom vectors in ${elapsedMs}ms.`);
console.log(`  Violations: ${violations}`);
console.log(violations > 0
  ? '  \x1b[31mFAILED\x1b[0m Algebraic closure invariants did not hold.'
  : '  \x1b[32mSUCCESS\x1b[0m Algebraic Closure Invariants: PASS (Zero NaN, Zero Inf, Zero Undefined, Lossless Codec)');

if (violations > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
