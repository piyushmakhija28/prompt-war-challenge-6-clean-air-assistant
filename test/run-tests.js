/**
 * @fileoverview Zero-dependency Triad Unit Test Runner for CleanAir Guardian.
 * Verifies all 30 Triad test cases (Positive, Negative, Edge-Case) adhering to axiomatic Hoare Logic Triples {P} C {Q}.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 */

import { VULN_FLAGS, METRO_BASIN_COORDINATES } from '../src/js/config.js';
import {
  calculateBulkRichardson,
  getDiurnalInversion,
  getVulnerabilityMultiplier,
  countActiveVulnerabilities,
  DiurnalRingBuffer,
  generateDiurnalCurve
} from '../src/js/air-quality-engine.js';
import { createSignal, createComputed, createEffect } from '../src/js/signals.js';
import {
  calculateRoomClearance as calculateFullCadrRoomClearance,
  haversineDistanceKm,
  findNearestBasin
} from '../src/js/cadr-calculator.js';
import {
  aqiToMassConcentration,
  calculateRoomClearance,
  calculateParticulateAvoidance,
  kahanNeumaierSum,
  calculate24HourCumulativeDosage,
  dosageToCigarettes,
  calculateCarbonAvoidance,
  getHousingInfiltrationCoefficient
} from '../src/js/impact-calculator.js';
import { NetworkTimeoutError, RateLimitExceededError, InvalidStateHashError } from '../src/js/errors.js';
import { EventBus } from '../src/js/event-bus.js';
import {
  packContextTo5Bytes,
  unpackContextFrom5Bytes,
  contextToHashToken,
  hashTokenToContext,
  hashTokenToContextStrict,
  encodeBase64URL,
  decodeBase64URL
} from '../src/js/state-codec.js';
import { generateOfflineCleanAirPlan, IAQ_HACKS_CATALOG, generateCommunityAdvisory, getCleaningProtocol } from '../src/js/offline-advisor.js';
import { TokenBucketLimiter, CircuitBreaker, sanitizeGeminiJSON, IPlanProvider, OfflinePlanProvider, GeminiPlanProvider, SecureKeyStore } from '../src/js/gemini-service.js';

let passed = 0;
let failed = 0;

function assert(condition, testName, message = '') {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${testName}`);
  } else {
    failed++;
    console.error(`  \x1b[31mFAIL\x1b[0m ${testName}: ${message}`);
  }
}

console.log('\n======================================================');
console.log(' CleanAir Guardian — 30 Triad Invariant Test Suite');
console.log('======================================================\n');

// ---------------------------------------------------------------------------
// 1. Positive Tests (Nominal Execution)
// ---------------------------------------------------------------------------
console.log('--- Category 1: Positive Test Cases (Nominal Execution) ---');

// TC-POS-001
const ctxNominal = { city: 'Delhi NCR', aqi: 395, vulnBits: 3, cookingMethod: 'lpg', heatingMethod: 'space_heater', commuteMode: 'two_wheeler', commuteKm: 14 };
const planNominal = generateOfflineCleanAirPlan(ctxNominal);
assert(planNominal !== null && planNominal.severityLevel === 'SEVERE', 'TC-POS-001', 'Nominal plan generated with severe status');

// TC-POS-002
const diurnalMorning = getDiurnalInversion(7.5, 300);
assert(diurnalMorning.phase === 'MORNING_TRAP' && diurnalMorning.multiplier >= 2.0, 'TC-POS-002', 'Morning trap multiplier >= 2.0');

// TC-POS-003
const diurnalSolar = getDiurnalInversion(13.5, 300);
assert(diurnalSolar.phase === 'SOLAR_DISPERSAL' && diurnalSolar.isVentilationAllowed === true, 'TC-POS-003', 'Solar window allows ventilation');

// TC-POS-004
const diurnalEvening = getDiurnalInversion(20.0, 300);
assert(diurnalEvening.phase === 'EVENING_TRAP' && diurnalEvening.multiplier >= 1.8, 'TC-POS-004', 'Evening trap active at 8 PM');

// TC-POS-005
const cOut = aqiToMassConcentration(400); // 250 ug/m3
const cIn = cOut * 0.22;
const dosageAvoided = calculateParticulateAvoidance(cOut, cIn, 2.0, 0.45, 0.28);
assert(dosageAvoided > 40 && dosageAvoided < 60, 'TC-POS-005', `Dosage avoided is ${dosageAvoided}`);

// TC-POS-006
const cigs = dosageToCigarettes(133.0);
assert(Math.abs(cigs - 2.0) <= 0.05, 'TC-POS-006', `Cigarette equivalence is ${cigs}`);

// TC-POS-007
const carbonSaved = calculateCarbonAvoidance('two_wheeler', 'metro', 15.0);
assert(carbonSaved === 0.48, 'TC-POS-007', `Carbon saved is ${carbonSaved} kg`);

// TC-POS-008
const hashToken = contextToHashToken(ctxNominal);
assert(hashToken.startsWith('b=') && hashToken.length <= 16, 'TC-POS-008', `Hash token compact: ${hashToken}`);

// TC-POS-009
const decodedCtx = hashTokenToContext(hashToken);
assert(decodedCtx.city === ctxNominal.city && decodedCtx.aqi === ctxNominal.aqi && decodedCtx.vulnBits === ctxNominal.vulnBits, 'TC-POS-009', 'Context roundtrip isomorphism');

// TC-POS-010
const ri_b = calculateBulkRichardson(3.0, 100, 1.5);
assert(ri_b >= 0.25, 'TC-POS-010', `Bulk Richardson number is ${ri_b} >= 0.25`);

// ---------------------------------------------------------------------------
// 2. Negative Tests (Error Handling & Sanitization)
// ---------------------------------------------------------------------------
console.log('\n--- Category 2: Negative Test Cases (Error & Clamping) ---');

// TC-NEG-001: Underflow clamping
const dNegativeAQI = getDiurnalInversion(7.5, -50);
assert(dNegativeAQI.effectiveAQI === 0, 'TC-NEG-001', 'Negative AQI clamped to 0');

// TC-NEG-002: Overflow clamping
const dOverflowAQI = getDiurnalInversion(7.5, 1500);
assert(dOverflowAQI.effectiveAQI === 999, 'TC-NEG-002', 'Overflow AQI clamped to 999');

// TC-NEG-003: Corrupted hash token
const corruptedCtx = hashTokenToContext('b=INVALID_GARBAGE!#');
assert(corruptedCtx !== null && corruptedCtx.aqi >= 0, 'TC-NEG-003', 'Corrupted hash token gracefully defaults without exception');

// TC-NEG-004: Empty vulnerabilities
const multZero = getVulnerabilityMultiplier(0);
assert(multZero === 1.0, 'TC-NEG-004', 'Zero vulnerabilities yields multiplier 1.00');

// TC-NEG-005: Circuit Breaker trip
const breaker = new CircuitBreaker(2, 30000);
breaker.recordFailure();
breaker.recordFailure();
assert(breaker.canExecute() === false, 'TC-NEG-005', 'Circuit breaker trips to OPEN after 2 failures');

// TC-NEG-006: Token Bucket exhaustion
const limiter = new TokenBucketLimiter(3, 5);
assert(limiter.tryConsume() === true, 'TC-NEG-006a', 'Token 1 consumed');
assert(limiter.tryConsume() === true, 'TC-NEG-006b', 'Token 2 consumed');
assert(limiter.tryConsume() === true, 'TC-NEG-006c', 'Token 3 consumed');
assert(limiter.tryConsume() === false, 'TC-NEG-006d', 'Exhausted burst rejected');

// TC-NEG-007: Code fence sanitizer
const rawFenced = '```json\n{"status":"OK"}\n```';
assert(sanitizeGeminiJSON(rawFenced) === '{"status":"OK"}', 'TC-NEG-007', 'Markdown code fence stripped');

// TC-NEG-008: Zero duration dosage
assert(calculateParticulateAvoidance(300, 50, 0) === 0, 'TC-NEG-008', 'Zero duration yields 0 dosage');

// TC-NEG-009: Infiltration lower bound
assert(aqiToMassConcentration(0) === 0, 'TC-NEG-009', 'Zero AQI yields 0 concentration');

// TC-NEG-010: Brian Kernighan bitcount constraint
assert(countActiveVulnerabilities(0xFF) === 5, 'TC-NEG-010', 'Mask constrained to 5 bits maximum');

// ---------------------------------------------------------------------------
// 3. Edge-Case Tests (Boundary Invariants)
// ---------------------------------------------------------------------------
console.log('\n--- Category 3: Edge-Case Test Cases (Boundary Invariants) ---');

// TC-EDG-001: Boundary 09:29:59 vs 09:30:00
const at0929 = getDiurnalInversion(9.49, 300);
const at0930 = getDiurnalInversion(9.50, 300);
assert(at0929.phase === 'MORNING_TRAP' && at0930.phase === 'PRE_DISPERSAL', 'TC-EDG-001', 'Diurnal boundary transition at 09:30');

// TC-EDG-002: Boundary 12:29:59 vs 12:30:00
const at1229 = getDiurnalInversion(12.49, 300);
const at1230 = getDiurnalInversion(12.50, 300);
assert(at1229.phase === 'PRE_DISPERSAL' && at1230.phase === 'SOLAR_DISPERSAL', 'TC-EDG-002', 'Diurnal boundary transition at 12:30');

// TC-EDG-003: Boundary 15:29:59 vs 15:30:00
const at1529 = getDiurnalInversion(15.49, 300);
const at1530 = getDiurnalInversion(15.50, 300);
assert(at1529.phase === 'SOLAR_DISPERSAL' && at1530.phase === 'AFTERNOON_SHIFT', 'TC-EDG-003', 'Diurnal boundary transition at 15:30');

// TC-EDG-004: All 5 vulnerabilities set
const multAll = getVulnerabilityMultiplier(31);
assert(multAll === 3.30, 'TC-EDG-004', `All 5 vulnerabilities scale to 3.30 (got ${multAll})`);

// TC-EDG-005: Extreme AQI > 500 extrapolation
const cExtreme = aqiToMassConcentration(600);
assert(cExtreme === 460.0, 'TC-EDG-005', `AQI 600 extrapolates to 460 ug/m3 (got ${cExtreme})`);

// TC-EDG-006: Numerical expm1 stability for small time
const clearanceTiny = calculateRoomClearance(270, 54, 0.001);
assert(clearanceTiny > 0 && clearanceTiny < 0.05, 'TC-EDG-006', `expm1 clearance is non-zero: ${clearanceTiny}`);

// TC-EDG-007: Kahan-Neumaier summation exact precision
const floatValues = [100.0, 0.0000001, -100.0, 0.0000001];
const kahanSum = kahanNeumaierSum(floatValues);
assert(kahanSum === 0.0, 'TC-EDG-007', `Kahan summation handled float cancellation cleanly: ${kahanSum}`);

// TC-EDG-008: Ring buffer continuous wraparound
const ring = new DiurnalRingBuffer(3);
ring.push(10);
ring.push(20);
ring.push(30);
ring.push(40); // wraps over 10
assert(ring.get(0) === 40 && ring.get(1) === 30 && ring.get(2) === 20, 'TC-EDG-008', 'Ring buffer overwrites modulo head cleanly');

// TC-EDG-009: 5-Byte binary packing exact bit preservation
const originalCtx = { aqi: 485, vulnBits: 19, cookingMethod: 'induction', heatingMethod: 'heat_pump', commuteMode: 'walk_cycle', commuteKm: 75, city: 'Lahore', simulatedHour: 18 };
const packedBytes = packContextTo5Bytes(originalCtx);
const unpackedCtx = unpackContextFrom5Bytes(packedBytes);
assert(unpackedCtx.aqi === 485 && unpackedCtx.vulnBits === 19 && unpackedCtx.cookingMethod === 'induction' && unpackedCtx.commuteKm === 75, 'TC-EDG-009', '5-byte bitstream preserves exact properties');

// TC-EDG-010: Base64URL string purity (zero '+', '/', '=')
const testStr = 'Delhi|395|3|lpg|space_heater|two_wheeler|7.5';
const encodedB64 = encodeBase64URL(testStr);
assert(!encodedB64.includes('+') && !encodedB64.includes('/') && !encodedB64.includes('='), 'TC-EDG-010', 'Base64URL contains zero forbidden characters');

// TC-INF-001: Dynamic housing infiltration coefficients
const alphaSealed = getHousingInfiltrationCoefficient('sealed_apartment');
const alphaStandard = getHousingInfiltrationCoefficient('standard_flat');
const alphaDrafty = getHousingInfiltrationCoefficient('drafty_home');
assert(alphaSealed === 0.40 && alphaStandard === 0.65 && alphaDrafty === 0.85, 'TC-INF-001', 'Housing infiltration coefficients resolve correctly');

// TC-ERR-001: Typed domain error hierarchy
const netErr = new NetworkTimeoutError(8000);
assert(netErr.code === 'ERR_NET_TIMEOUT' && netErr.isTransient === true, 'TC-ERR-001', 'NetworkTimeoutError domain code and retry eligibility');

// TC-BUS-001: Typed EventBus pub-sub delivery
const testBus = new EventBus();
let busPayload = null;
testBus.on('TEST_TOPIC', (data) => { busPayload = data; });
testBus.emit('TEST_TOPIC', { status: 'DELIVERED' });
assert(busPayload && busPayload.status === 'DELIVERED', 'TC-BUS-001', 'EventBus publishes and delivers payload synchronously');

// TC-CADR-001: Room dimension volume and ACH calculation
const cadrSmallRoom = calculateFullCadrRoomClearance({ length: 10, width: 10, height: 9, unit: 'ft', cadrCfm: 273 });
assert(cadrSmallRoom.volumeCuFt === 900 && cadrSmallRoom.achClean === 18.2, 'TC-CADR-001', 'Room volume and clean air turnover (ACH) calculate accurately');

// TC-CADR-002: Monotonic clearance milestones (t50 < t90 < t99)
assert(cadrSmallRoom.t50Min < cadrSmallRoom.t90Min && cadrSmallRoom.t90Min < cadrSmallRoom.t99Min && cadrSmallRoom.t99Min < 20, 'TC-CADR-002', 'Clearance times satisfy monotonic inequality t50 < t90 < t99');

// TC-GEO-001: Haversine great-circle distance accuracy (Delhi to Lahore ~415-430 km)
const distDelhiLahore = haversineDistanceKm(28.6139, 77.2090, 31.5204, 74.3587);
assert(distDelhiLahore > 410 && distDelhiLahore < 435, 'TC-GEO-001', 'Haversine distance between Delhi and Lahore accurately resolves to ~420 km');

// TC-GEO-002: Nearest basin resolution for coordinate vector
const nearestBasin = findNearestBasin(28.65, 77.22, METRO_BASIN_COORDINATES);
assert(nearestBasin.name === 'Delhi NCR' && nearestBasin.distanceKm < 15, 'TC-GEO-002', 'Nearest air basin identifies Delhi NCR for local coordinates');

// TC-HACK-001: 4-Hack IAQ catalog definitions and CADR invariants
assert(IAQ_HACKS_CATALOG.corsi_rosenthal.cadrCfm === 273 && IAQ_HACKS_CATALOG.pc_fan_stealth.cadrCfm === 85 && IAQ_HACKS_CATALOG.wet_towel_emergency.cadrCfm === 30 && IAQ_HACKS_CATALOG.kitchen_vent_scrub.cadrCfm === 180, 'TC-HACK-001', '4-Hack IAQ catalog definitions and CADR values verified');

// TC-LANG-001: Bilingual community advisory (English and Hindi parity)
const advEn = generateCommunityAdvisory({ city: 'Delhi NCR', aqi: 395 }, { severityLevel: 'SEVERE', quantifiedImpact: { pm25InhalationAvoidedMicrograms: 140 } }, 'en');
const advHi = generateCommunityAdvisory({ city: 'Delhi NCR', aqi: 395 }, { severityLevel: 'SEVERE', quantifiedImpact: { pm25InhalationAvoidedMicrograms: 140 } }, 'hi');
assert(advEn.includes('CleanAir Community Advisory') && advHi.includes('स्वच्छ वायु समुदाय परामर्श'), 'TC-LANG-001', 'Bilingual community advisory produces localized bulletins in English and Hindi');

// TC-SUM-001: 24-hour diurnal exposure summation via Kahan-Neumaier
const hourlyConc = new Float64Array(24).fill(120.0);
const totalDosage = calculate24HourCumulativeDosage(hourlyConc, 0.45, 0.28);
assert(Math.abs(totalDosage - (120.0 * 0.45 * 0.28 * 24)) < 0.05, 'TC-SUM-001', 'calculate24HourCumulativeDosage accurately sums diurnal dosage via Kahan-Neumaier');

// TC-STRICT-001: Strict hash decoder throws InvalidStateHashError on corrupted bitstream
let strictThrew = false;
try {
  hashTokenToContextStrict('b=corruptHashToken');
} catch (e) {
  if (e instanceof InvalidStateHashError) strictThrew = true;
}
assert(strictThrew === true, 'TC-STRICT-001', 'hashTokenToContextStrict throws InvalidStateHashError on corrupted hash bitstream');

// TC-RING-001: DiurnalRingBuffer circular FIFO capacity invariant
const diurnalRing24 = new DiurnalRingBuffer(24);
for (let i = 0; i < 50; i++) {
  diurnalRing24.push(i);
}
const snapshot = diurnalRing24.toChronologicalArray();
assert(snapshot.length === 24 && snapshot[0] === 26 && snapshot[23] === 49, 'TC-RING-001', 'DiurnalRingBuffer maintains 24-hour circular FIFO invariant');

// TC-SIG-001: createSignal reactive getter, setter and subscriber notification
const [testSig, setTestSig] = createSignal(100);
let effectRuns = 0;
let observedVal = 0;
createEffect(() => {
  effectRuns++;
  observedVal = testSig();
});
assert(observedVal === 100 && effectRuns === 1, 'TC-SIG-001a', 'createSignal registers and triggers initial effect');
setTestSig(250);
assert(observedVal === 250 && effectRuns === 2, 'TC-SIG-001b', 'createSignal synchronously propagates value update to subscriber');

// TC-SIG-002: createComputed fine-grained derived signal reactivity
const [baseVal, setBaseVal] = createSignal(50);
const doubled = createComputed(() => baseVal() * 2);
assert(doubled() === 100, 'TC-SIG-002a', 'createComputed computes derived value correctly');
setBaseVal(75);
assert(doubled() === 150, 'TC-SIG-002b', 'createComputed automatically updates when upstream signal changes');

// TC-TAILOR-001: Context-tailored routine advice for cooking and transit
const tailoredPlan = generateOfflineCleanAirPlan({
  aqi: 350,
  commuteMode: 'two_wheeler',
  cookingMethod: 'biomass',
  heatingMethod: 'space_heater'
});
const morningRec = tailoredPlan.hourlyRoutines[0].recommendation;
const eveningRec = tailoredPlan.hourlyRoutines[3].recommendation;
assert(morningRec.includes('Two-wheeler riders inhale') && eveningRec.includes('Biomass fuel produces toxic'), 'TC-TAILOR-001', 'Lifestyle routines tailor advice specifically to biomass cooking and two-wheeler transit');

// TC-CURVE-001: Analytical 24-hour diurnal spline curve continuity
const diurnalCurve = generateDiurnalCurve(250);
assert(diurnalCurve.points.length === 96 && diurnalCurve.pathD.startsWith('M') && diurnalCurve.pathD.includes('L'), 'TC-CURVE-001', 'generateDiurnalCurve produces 96 continuous spline coordinates with valid SVG path syntax');

// TC-CURVE-002: Atmospheric boundary layer diurnal extremum bounds
let minMultiplier = Infinity;
let maxMultiplier = -Infinity;
for (let i = 0; i < diurnalCurve.points.length; i++) {
  const p = diurnalCurve.points[i];
  if (p.multiplier < minMultiplier) minMultiplier = p.multiplier;
  if (p.multiplier > maxMultiplier) maxMultiplier = p.multiplier;
}
assert(minMultiplier <= 0.90 && maxMultiplier >= 2.0, 'TC-CURVE-002', 'Diurnal inversion multiplier exhibits physical atmospheric range (min ~0.85-0.90, max >= 2.0)');

// TC-CLN-001: Wet-mopping vs dry-sweeping protocol enforcement (AQI > 200)
const cleanSevere = getCleaningProtocol(350);
assert(cleanSevere.isTriggered === true && cleanSevere.severity === 'WARNING' && cleanSevere.recommendation.includes('damp microfiber') && cleanSevere.warning.includes('Traditional broom dry-sweeping'), 'TC-CLN-001', 'AQI > 200 enforces damp mopping and prohibits dry sweeping per PRD FR-06');

// TC-CLN-002: Relaxed cleaning protocol for low ambient pollution (AQI <= 200)
const cleanGood = getCleaningProtocol(85);
assert(cleanGood.isTriggered === false && cleanGood.severity === 'SAFE' && cleanGood.statusBadge === 'STANDARD DAMP DUSTING', 'TC-CLN-002', 'AQI <= 200 reports standard damp cleaning with low resuspension risk');

// TC-LSP-001: Liskov Substitution Principle and Strategy Pattern inheritance
const offlineProv = new OfflinePlanProvider();
const geminiProv = new GeminiPlanProvider(new SecureKeyStore());
const lspOfflineCheck = offlineProv instanceof IPlanProvider && typeof offlineProv.getPlan === 'function';
const lspGeminiCheck = geminiProv instanceof IPlanProvider && typeof geminiProv.getPlan === 'function';
assert(lspOfflineCheck && lspGeminiCheck, 'TC-LSP-001', 'Both GeminiPlanProvider and OfflinePlanProvider satisfy IPlanProvider Liskov contract');

// TC-SCH-001: Offline plan schema conformity matching Gemini responseSchema
const schemaPlan = generateOfflineCleanAirPlan({ aqi: 300 });
const hasMandatoryKeys = Boolean(
  schemaPlan.severityLevel &&
  schemaPlan.diurnalWindowNotice &&
  Array.isArray(schemaPlan.hourlyRoutines) &&
  schemaPlan.iaqHack &&
  schemaPlan.cleaningProtocol &&
  Array.isArray(schemaPlan.sustainableAlternatives) &&
  schemaPlan.quantifiedImpact &&
  schemaPlan.communityAdvisory
);
assert(hasMandatoryKeys === true, 'TC-SCH-001', 'Action plan satisfies 100% of required responseSchema properties');




console.log('\n------------------------------------------------------');
console.log(` Test Execution Summary: ${passed} Passed, ${failed} Failed`);
console.log('------------------------------------------------------\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
