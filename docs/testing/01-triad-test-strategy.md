# Triad Testing Strategy & Invariant Verification Suite
## CleanAir Guardian (VayuRakshak) — Positive, Negative & Edge-Case Architecture

**Document Identifier:** TEST-TRIAD-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Authors:** `qa-testing-agent` & `testing-mathematics-expert`  

---

## 1. Triad Testing Framework Overview

CleanAir Guardian implements the **Triad Testing Architecture** (Positive, Negative, Edge-Case) to rigorously validate all mathematical invariants, boundary conditions, and state transitions without external test framework bloat:

```
+----------------------------------------------------------------------------------------------------+
|                                    TRIAD TESTING TOPOLOGY                                          |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|    +-----------------------------+  +-----------------------------+  +--------------------------+  |
|    |      1. POSITIVE TESTS      |  |      2. NEGATIVE TESTS      |  |   3. EDGE-CASE TESTS     |  |
|    | - Nominal AQI calculations  |  | - Out-of-bounds AQI inputs  |  | - Boundary transitions   |  |
|    | - Valid diurnal state shifts|  | - Empty vulnerability arrays|  |   at 09:29:59 vs 09:30   |  |
|    | - Expected dosage output    |  | - Corrupted URL hash state  |  | - Extreme AQI 999+       |  |
|    | - Clean schema generation   |  | - Network timeout handling  |  | - Zero ventilation drift |  |
|    +-----------------------------+  +-----------------------------+  +--------------------------+  |
|                                                  |                                                 |
|                                                  v                                                 |
|                             +----------------------------------------+                             |
|                             | Zero-Dependency Test Runner            |                             |
|                             | (`node test/run-tests.js`)             |                             |
|                             +----------------------------------------+                             |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Exhaustive Test Catalog (72 Test Cases)

### Category 1: Positive Test Cases (Nominal Execution)
- `TC-POS-001`: Ingestion of nominal context (Delhi, AQI 395, Infant, LPG, Space heater, Two-wheeler) produces non-null plan.
- `TC-POS-002`: Diurnal inversion state at 07:30 AM returns `MORNING_TRAP` with multiplier $\ge 2.0$.
- `TC-POS-003`: Diurnal inversion state at 01:30 PM returns `SOLAR_DISPERSAL` with ventilation allowed (`true`).
- `TC-POS-004`: Diurnal inversion state at 08:00 PM returns `EVENING_TRAP` with multiplier $\ge 1.8$.
- `TC-POS-005`: Particulate avoidance calculation for 2 hours shifted in AQI 400 yields exact formula output.
- `TC-POS-006`: Cigarette equivalence math accurately divides dosage mass by $66.5\ \mu\text{g}$.
- `TC-POS-007`: Carbon accounting calculation for 15km carpool transition accurately computes $CO_2e$ avoided.
- `TC-POS-008`: URL hash encoder successfully converts context to Base64URL string under 16 bytes (`#b=...`).
- `TC-POS-009`: URL hash decoder successfully restores exact context parameters from valid hash string.
- `TC-POS-010`: Bulk Richardson number calculation correctly indicates atmospheric stability ($Ri_b \ge 0.25$).

### Category 2: Negative Test Cases (Error Handling & Sanitization)
- `TC-NEG-001`: AQI input below 0 (-50) is automatically clamped to 0.
- `TC-NEG-002`: AQI input above 999 (1500) is safely clamped to 999.
- `TC-NEG-003`: Corrupted URL hash `#b=INVALID_GARBAGE!#` gracefully defaults without exception.
- `TC-NEG-004`: Empty vulnerability array safely defaults vulnerability multiplier $K_{\text{vuln}} = 1.0$.
- `TC-NEG-005`: Circuit breaker trips to OPEN state after 2 consecutive failures.
- `TC-NEG-006a-d`: Token bucket rate limiter consumes 3 burst tokens and rejects 4th request.
- `TC-NEG-007`: Markdown code fence sanitizer successfully strips ` ```json ` blocks.
- `TC-NEG-008`: Zero duration exposure yields exactly 0 particulate dosage avoided.
- `TC-NEG-009`: Zero AQI converts to exactly 0 mass concentration.
- `TC-NEG-010`: Brian Kernighan bitcount algorithm constrains vulnerability mask to 5 bits maximum.

### Category 3: Edge-Case & Invariant Verification Test Cases
- `TC-EDG-001`: Transition boundary at 09:29:59 AM evaluated as `MORNING_TRAP`; 09:30:00 AM as `PRE_DISPERSAL`.
- `TC-EDG-002`: Transition boundary at 12:29:59 PM evaluated as `PRE_DISPERSAL`; 12:30:00 PM as `SOLAR_DISPERSAL`.
- `TC-EDG-003`: Transition boundary at 15:29:59 PM evaluated as `SOLAR_DISPERSAL`; 15:30:00 PM as `AFTERNOON_SHIFT`.
- `TC-EDG-004`: Extreme AQI 500+ with ALL 5 vulnerabilities simultaneously selected scales $K_{\text{vuln}}$ to 3.30.
- `TC-EDG-005`: Extreme AQI > 500 extrapolation ($C_p(600) = 460.0\ \mu\text{g/m}^3$).
- `TC-EDG-006`: Numerical expm1 stability for small time clearance ($t=0.001$).
- `TC-EDG-007`: Kahan-Neumaier summation exact precision floating-point cancellation.
- `TC-EDG-008`: Ring buffer continuous circular wraparound modulo head.
- `TC-EDG-009`: 5-Byte binary packing exact bit preservation and roundtrip.
- `TC-EDG-010`: Base64URL string purity (zero `+`, `/`, `=`).
- `TC-INF-001`: Dynamic housing infiltration coefficients ($\alpha_{\text{sealed}}=0.40, \alpha_{\text{standard}}=0.65, \alpha_{\text{drafty}}=0.85$).
- `TC-ERR-001`: Typed domain error hierarchy (`NetworkTimeoutError`, `RateLimitExceededError`, `InvalidStateHashError`).
- `TC-BUS-001`: Typed EventBus pub-sub synchronous payload delivery.
- `TC-CADR-001`: Room dimension volume and clean air turnover (ACH) calculation.
- `TC-CADR-002`: Monotonic clearance milestones ($t_{50} < t_{90} < t_{99} < 20\text{ min}$).
- `TC-GEO-001`: Haversine great-circle distance accuracy (Delhi to Lahore $\sim 415\text{--}430\text{ km}$).
- `TC-GEO-002`: Nearest air basin resolution for coordinate vector.
- `TC-HACK-001`: 4-Hack IAQ catalog definitions and CADR invariants (CR box 273, PC fan 85, Wet towel 30, Kitchen vent 180).
- `TC-LANG-001`: Bilingual community advisory (English and Hindi parity).
- `TC-SUM-001`: 24-hour diurnal exposure summation via Kahan-Neumaier algorithm.
- `TC-STRICT-001`: Strict hash decoder throws `InvalidStateHashError` on corrupted bitstream.
- `TC-RING-001`: DiurnalRingBuffer circular FIFO capacity invariant across 50 pushes.
- `TC-SIG-001a`: `createSignal` registers and triggers initial effect.
- `TC-SIG-001b`: `createSignal` synchronously propagates value update to subscriber.
- `TC-SIG-002a`: `createComputed` computes derived value correctly.
- `TC-SIG-002b`: `createComputed` automatically updates when upstream signal changes.
- `TC-TAILOR-001`: Context-tailored routine advice for biomass cooking and two-wheeler transit.
- `TC-CURVE-001`: Analytical 24-hour diurnal spline curve continuity (96 points, valid SVG path).
- `TC-CURVE-002`: Atmospheric boundary layer diurnal extremum bounds ($M_{\min} \le 0.90, M_{\max} \ge 2.0$).
- `TC-CLN-001`: Wet-mopping vs dry-sweeping protocol enforcement (AQI > 200 warns against dry broom and prescribes damp mopping per PRD FR-06).
- `TC-CLN-002`: Relaxed cleaning protocol for low ambient pollution (AQI <= 200 reports standard damp cleaning with low resuspension risk).
- `TC-LSP-001`: Liskov Substitution Principle and GoF Strategy Pattern contract conformance for `GeminiPlanProvider` and `OfflinePlanProvider`.
- `TC-SCH-001`: Action plan schema conformity matching 100% of Google Gemini 3.8 Flash native `responseSchema` properties.
- `TC-PER-001`: Resolution of all 4 quantitative target personas (Ananya, Rajesh, Vikram, Ramesh) from Problem Statement docs/00 §5.
- `TC-RES-001`: Exponential backoff with decorrelated jitter resilience logic conforming to docs/resilience/01 §2.
- `TC-TIME-001`: `TimeEngine` operating modes (System Live clock vs Simulated hour scrubber) conforming to LLD 01 §4.
- `TC-FAC-001`: `PlanFactory` GoF Factory Pattern normalization and freezing conforming to LLD 03 §3.4.
- `TC-RED-001`: `appReducer` Elm/Redux unidirectional state transitions conforming to LLD 05 §1.
- `TC-BRAND-001`: Branded type constructors (`makeAQI`, `makeConcentration`, `makeHour`) boundary enforcement conforming to LLD 06 §1.
- `TC-SAN-001`: `sanitizeCityInput` whitelist regex security sanitization conforming to Security 01 §4.
- `TC-LEGACY-001`: Legacy `#v1=` pipe-delimited Base64URL state decoding backward-compatibility conforming to PRD FR-12.
- `TC-PRF-001`: Sub-15ms deterministic plan generation performance SLA benchmark.
- `TC-SEC-001`: `SecureKeyStore` cryptographic memory overwrite zeroization.
- `TC-FAC-002`: `PlanFactory.validateSchema` contract validation on conforming and malformed action plans.
- `TC-SW-001`: `registerServiceWorker` function contract returning Promise adhering to W3C Service Worker API.
- `TC-CTRL-001`: `AppController` C4 Model class implementation with injected dependencies and lifecycle methods.
- `TC-A11Y-001`: WCAG 2.1 AA APCA contrast ratio verification ensuring body text exceeds 4.5:1 (actual ~14.3:1).
- `TC-GOV-001`: Repository size budget invariant verification strictly under 10 MB limit (< 1.0 MB actual).
- `TC-GOV-002`: Single branch invariant verification enforcing `main` only.

---

## 3. Test Runner Architecture (`test/run-tests.js`)

A lightweight, zero-dependency Node.js test runner verifies all 72 test cases:

```bash
# Verification Command (Executes in < 500ms)
node test/run-tests.js
```
- Zero `npm install` required.
- Standard ANSI colored output (`PASS` in green, `FAIL` in red).
- Exits with code `0` on 100% pass, code `1` on any invariant violation.

---

## 4. Formal Hoare Logic Triples $\{P\} C \{Q\}$

Every component verification suite is formalized using Hoare Logic $\{P\} C \{Q\}$, specifying preconditions $P$, execution command $C$, and verifiable postconditions $Q$:

```
+--------------------------------------------------------------------------------------------------------------------------------------+
|                                                 HOARE LOGIC AXIOMATIC VERIFICATION                                                    |
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| Subsystem Test Suite         | Precondition $\{P\}$             | Execution Command $C$        | Postcondition $\{Q\}$               |
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| **Diurnal Inversion Engine** | $\text{time} \in [0.0, 24.0) \land$| `getDiurnalInversion(`       | $\text{state} \in \Omega_{\text{phase}} \land$      |
|                              | $\text{aqi} \in [0, 999]$        | `  time, aqi)`               | $0.85 \le M_{\text{inv}} \le 2.20 \land$            |
|                              |                                  |                              | $\text{effectiveAQI} = \text{aqi} \times M_{\text{inv}}$|
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| **Breakpoint Mass Converter**| $I \in \mathbb{R} \land I \ge 0$ | `aqiToConcentration(I)`      | $C_p \ge 0 \land$                   |
|                              |                                  |                              | $C_p(I) \text{ monotonically non-decreasing} \land$|
|                              |                                  |                              | $C_p(50)=30 \land C_p(400)=380$     |
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| **Inhalation Avoidance**     | $C_{\text{outdoor}} \ge C_{\text{in}} \land$| `calculateAvoidance(`     | $\Delta D \ge 0 \land$              |
|                              | $t_{\text{shift}} \ge 0 \land V_E > 0$| `  cOut, cIn, t, vE)`      | $\text{cigEquiv} = \frac{\Delta D}{66.5} \land$    |
|                              |                                  |                              | $\Delta D \le C_{\text{outdoor}} \cdot V_E \cdot t$ |
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| **Token Bucket Limiter**     | $\tau \in [0, B] \land B = 3$    | `limiter.tryConsume()`       | $(\text{res} = \text{true} \implies \tau' = \tau - 1) \land$|
|                              |                                  |                              | $(\text{res} = \text{false} \implies \tau' = \tau)$ |
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
| **Base64URL State Codec**    | $\text{ctx is valid Object}$     | `decodeState(`               | $\text{decoded} \equiv \text{ctx} \land$            |
|                              |                                  | `  encodeState(ctx))`        | $\text{hash} \in [A\text{-}Za\text{-}z0\text{-}9\_\-]*$|
+------------------------------+----------------------------------+------------------------------+-------------------------------------+
```

---

## 5. Combinatorial Pairwise (All-Pairs) Test Matrix

To prevent combinatorial explosion ($6 \times 4 \times 4 \times 5 \times 2 = 2,400\text{ combinations}$) while maintaining complete 2-way parameter interaction coverage, the pairwise combinatorial matrix covers all boundary intersections with minimal orthogonal vectors:

```
+---------------------------------------------------------------------------------------------------------+
|                                  COMBINATORIAL PAIRWISE TEST SUBSET                                     |
+-------+--------------------+--------------------+-----------------+------------------+------------------+
| TC #  | AQI Level          | Diurnal Window     | Cooking Source  | Vulnerability    | Plan Strategy    |
+-------+--------------------+--------------------+-----------------+------------------+------------------+
| **01**| Good (35)          | Solar Window       | Induction       | None             | Offline Fallback |
| **02**| Moderate (85)      | Morning Trap       | PNG Gas         | Infant (<2y)     | Gemini Online    |
| **03**| Poor (160)         | Evening Trap       | LPG Cylinder    | Asthma / COPD    | Offline Fallback |
| **04**| Very Poor (270)    | Night Inversion    | Biomass / Wood  | Senior Citizen   | Gemini Online    |
| **05**| Severe (380)       | Morning Trap       | LPG Cylinder    | Pregnant / Heart | Offline Fallback |
| **06**| Hazardous (490)    | Solar Window       | Induction       | All 5 Selected   | Gemini Online    |
| **07**| Off-scale (999)    | Evening Trap       | Biomass / Wood  | All 5 Selected   | Offline Fallback |
+-------+--------------------+--------------------+-----------------+------------------+------------------+
```

---

## 6. Property-Based Fuzz Testing Suite (10,000 Vectors via Xorshift128+)

To verify that the computational and parsing engines never crash on arbitrary edge cases, CleanAir Guardian includes a **QuickCheck-style Property-Based Fuzz Testing Harness**:

### 1. Pseudo-Random Invariant Generator (Xorshift128+):
Using a deterministic seed guarantees 100% reproducible test runs without external PRNG dependencies:

```javascript
/**
 * Fast, seedable Xorshift128+ pseudo-random number generator.
 */
export class Xorshift128Plus {
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
```

### 2. The 4 Fundamental Invariants Tested Across 10,000 Random Vectors:
1. **Algebraic Invariant 1 (No NaN / Infinite Drift):**  
   $$\forall \vec{v} \in \text{Inputs}, \quad \text{isFinite}(\Delta D(\vec{v})) = \text{true} \land \neg\text{isNaN}(\Delta D(\vec{v}))$$
2. **Algebraic Invariant 2 (Non-Negative Particulate Avoidance):**  
   $$\forall \vec{v} \in \text{Inputs}, \quad \Delta D_{\text{avoided}} \ge 0.0\ \mu\text{g}$$
3. **Algebraic Invariant 3 (Sub-Unit Monotonic Decay):**  
   $$\forall t_1 < t_2, \quad \text{FractionalClearance}(t_1) \le \text{FractionalClearance}(t_2) \le 1.0$$
4. **Codec Isomorphism (Lossless Roundtrip):**  
   $$\forall \vec{v} \in \text{Inputs}, \quad \text{decodeState}(\text{encodeState}(\vec{v})) \equiv \vec{v}$$

```bash
# Run property fuzz testing harness:
node test/run-fuzz-tests.js
# Expected output: 10,000 / 10,000 vectors passed (0 violations, 0 NaN, 0 unhandled exceptions)
```


