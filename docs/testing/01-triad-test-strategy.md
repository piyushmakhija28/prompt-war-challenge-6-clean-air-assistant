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

## 2. Exhaustive Test Catalog (30 Test Cases)

### Category 1: Positive Test Cases (Nominal Execution)
- `TC-POS-001`: Ingestion of nominal context (Delhi, AQI 395, Infant, LPG, Space heater, Two-wheeler) produces non-null plan.
- `TC-POS-002`: Diurnal inversion state at 07:30 AM returns `MORNING_TRAP` with multiplier $\approx 2.15$.
- `TC-POS-003`: Diurnal inversion state at 01:30 PM returns `SOLAR_DISPERSAL` with ventilation allowed (`true`).
- `TC-POS-004`: Diurnal inversion state at 08:00 PM returns `EVENING_TRAP` with multiplier $\approx 1.95$.
- `TC-POS-005`: Particulate avoidance calculation for 2 hours shifted in AQI 400 yields exact formula output.
- `TC-POS-006`: Cigarette equivalence math accurately divides dosage mass by $66.5\ \mu\text{g}$.
- `TC-POS-007`: Carbon accounting calculation for 15km carpool transition accurately computes $CO_2e$ avoided.
- `TC-POS-008`: URL hash encoder successfully converts context to Base64URL string under 128 bytes.
- `TC-POS-009`: URL hash decoder successfully restores exact context parameters from valid hash string.
- `TC-POS-010`: Offline advisor returns full plan matching Gemini JSON schema properties identically.

### Category 2: Negative Test Cases (Error Handling & Sanitization)
- `TC-NEG-001`: AQI input below 0 (-50) is automatically clamped to 0.
- `TC-NEG-002`: AQI input above 999 (1500) is safely clamped to 999.
- `TC-NEG-003`: Corrupted URL hash `#v1=INVALID_BASE64` gracefully falls back to default preset without throw.
- `TC-NEG-004`: Empty vulnerability array safely defaults vulnerability multiplier $K_{\text{vuln}} = 1.0$.
- `TC-NEG-005`: Simulated Gemini network timeout after 8,000ms trips circuit breaker and activates offline mode.
- `TC-NEG-006`: Simulated HTTP 429 response activates offline mode with informational user notification.
- `TC-NEG-007`: Unrecognized city string input sanitized against script tags and XSS payloads.
- `TC-NEG-008`: Missing heating method defaults safely to electric radiator baseline.
- `TC-NEG-009`: Incomplete Gemini JSON response missing required key triggers offline fallback.
- `TC-NEG-010`: Invalid API key string format rejected before outbound network dispatch.

### Category 3: Edge-Case Test Cases (Boundary Invariants)
- `TC-EDG-001`: Transition boundary at 09:29:59 AM evaluated as `MORNING_TRAP`; 09:30:00 AM as `PRE_DISPERSAL`.
- `TC-EDG-002`: Transition boundary at 12:29:59 PM evaluated as `PRE_DISPERSAL`; 12:30:00 PM as `SOLAR_DISPERSAL`.
- `TC-EDG-003`: Transition boundary at 15:29:59 PM evaluated as `SOLAR_DISPERSAL`; 15:30:00 PM as `AFTERNOON_SHIFT`.
- `TC-EDG-004`: Extreme AQI 500+ with ALL 5 vulnerabilities simultaneously selected scales $K_{\text{vuln}}$ to 3.30.
- `TC-EDG-005`: Outdoor AQI of 0 (Pristine) yields 0 micrograms avoided without division-by-zero errors.
- `TC-EDG-006`: Zero hours shifted ($t=0$) yields exactly 0 micrograms and 0 cigarettes avoided.
- `TC-EDG-007`: Extremely long commute distance ($500\text{ km}$) scales linearly without numeric overflow.
- `TC-EDG-008`: Fractional decimal hours ($1.333\text{ hours}$) evaluated with floating-point precision ($\pm 0.001$).
- `TC-EDG-009`: Simultaneous multi-tab URL hash modification correctly synchronizes UI state.
- `TC-EDG-010`: Rapid toggle between online and offline modes preserves user input form values.

---

## 3. Test Runner Architecture (`test/run-tests.js`)

A lightweight, zero-dependency Node.js test runner verifies all 30 test cases:

```bash
# Verification Command (Executes in < 500ms)
node test/run-tests.js
```
- Zero `npm install` required.
- Standard ANSI colored output (`PASS` in green, `FAIL` in red).
- Exits with code `0` on 100% pass, code `1` on any invariant violation.
