# Product Requirements Document (PRD) & BDD Gherkin Scenarios
## CleanAir Guardian (VayuRakshak) — GenAI Winter Smog & Urban Air Quality Assistant

**Document Identifier:** PRD-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Authors:** `business-analyst-agent` & `solution-architect`  

---

## 1. Executive Summary & Product Vision

### 1.1 Vision Statement
To empower urban families and community clusters with a hyper-personalized, scientifically rigorous GenAI guardian that transforms paralyzing air pollution data into precise, timestamped action routines, affordable life-saving indoor hacks, and quantified environmental impact metrics.

### 1.2 Core Value Propositions
1. **Dynamic Context-Aware Intelligence:** Adapts to user location, live AQI, vulnerable family demographics (infants, asthmatics, pregnant women, seniors), domestic heating/cooking, and commute modes.
2. **Diurnal Inversion Scheduling:** Exploits atmospheric physics to shift vulnerable outdoor exposure from hazardous morning/evening peaks to the solar convective dispersal window.
3. **Affordable Community IAQ Hacks:** Replaces unreachable $300 commercial appliances with open-source, scientifically validated hacks (DIY Corsi-Rosenthal boxes, wet-mopping protocols, strategic window sealing).
4. **Transparent Mathematical Impact:** Gives immediate positive reinforcement through calculated micrograms of $\text{PM}_{2.5}$ non-inhaled, cigarette equivalents avoided, and kilograms of $\text{CO}_2\text{e}$ prevented.
5. **Universal Zero-Friction Evaluator Experience:** Runs 100% in-browser on GitHub Pages with Dual-Engine capability (Google Gemini 3.8 Flash + Instant Deterministic Rule Advisor).

---

## 2. Numbered Functional Requirements & Formal BDD Gherkin Scenarios

### FR-01: Context Ingestion & Normalization
```gherkin
Scenario: Ingest and sanitize nominal user context
  Given a user enters city "Delhi-NCR", AQI "395", and selects "Infant" and "Asthma"
  When the user submits the form or adjusts the slider
  Then the system normalizes the context into a validated UserContext object
  And computes the vulnerability multiplier K_vuln = 2.25
```

### FR-02: Diurnal Atmospheric Inversion Tracking
```gherkin
Scenario: Detect morning inversion trap window
  Given the local solar time is 07:30 AM
  When the atmospheric inversion engine evaluates the hour
  Then it returns state "MORNING_TRAP" with ground multiplier 2.15x
  And sets ventilationAllowed to false
```

### FR-03: Vulnerability Weighting Index ($K_{\text{vuln}}$)
```gherkin
Scenario: Compute composite vulnerability score for multi-risk home
  Given a household with an infant (w=0.45) and a senior with asthma (w=0.35 + 0.80)
  When calculateVulnerabilityMultiplier is evaluated
  Then the composite multiplier K_vuln is exactly 2.60
```

### FR-04: Dynamic Routine Rescheduling Engine
```gherkin
Scenario: Reschedule outdoor morning walk during severe smog
  Given the current outdoor AQI is 410 and morning inversion is active
  When the schedule generator runs
  Then outdoor morning walks between 06:30 AM and 09:30 AM are flagged as "SHIFT_INDOORS"
  And outdoor sunlight exposure is scheduled for the solar window at 01:15 PM
```

### FR-05: DIY Corsi-Rosenthal Box IAQ Prescription
```gherkin
Scenario: Deliver step-by-step Corsi-Rosenthal box plan
  Given user context indicates no commercial air purifier is owned
  When action plan is generated
  Then it provides instructions for 1 box fan + 4 MERV 13 filters
  And displays estimated CADR of 273 CFM for $35 total cost
```

### FR-06: Wet-Mopping vs. Dry-Brooming Protocol
```gherkin
Scenario: Enforce damp mopping over dry sweeping
  Given outdoor AQI exceeds 200 (Poor or worse)
  When IAQ cleaning advice is output
  Then traditional broom sweeping is explicitly warned against
  And damp microfiber wet mopping with 0.1% surfactant is prescribed
```

### FR-07: Strategic Solar Ventilation Window Alerting
```gherkin
Scenario: Alert user to controlled solar ventilation purge
  Given local solar time enters the 12:30 PM to 03:30 PM window
  When the user checks the live status
  Then a green convective dispersal badge is displayed
  And a controlled 15-minute cross-ventilation flush is advised
```

### FR-08: Sustainable Transit & Commute Alternatives
```gherkin
Scenario: Recommend clean transit shift for two-wheeler commuter
  Given user commutes 18 km daily on a solo two-wheeler
  When recommendations are generated
  Then it recommends transitioning to Metro Rail or a carpool cluster
  And specifies cabin air recirculation mode if carpooling
```

### FR-09: Inhaled PM2.5 Dosage Avoidance Calculation
```gherkin
Scenario: Calculate micrograms and cigarette equivalents avoided
  Given outdoor AQI is 400 (Cp = 380 µg/m³) and infant avoids 2 hours outdoor exposure
  When impact calculator evaluates dosage
  Then it computes 42.2 µg of PM2.5 inhalation avoided
  And converts to 0.63 equivalent cigarettes prevented from infant lungs
```

### FR-10: Carbon Emissions & Fuel Savings Calculation
```gherkin
Scenario: Compute carbon reduction for transit displacement
  Given commute distance of 20 km shifted from solo petrol car to electric metro
  When carbon accounting formula executes
  Then net avoided emissions are calculated as exactly 4.24 kg CO2e
```

### FR-11: One-Click Copyable Community Advisory Generator
```gherkin
Scenario: Generate formatted WhatsApp community bulletin
  Given a completed clean air plan for Delhi AQI 395
  When user clicks "Copy WhatsApp Advisory"
  Then formatted markdown announcement is copied to clipboard
  And user receives visual confirmation toast
```

### FR-12: Stateless URL Hash State Codec (`#v1=...`)
```gherkin
Scenario: Encode and decode context state via RFC 4648 Base64URL
  Given user state with city "Delhi", AQI 395, and 2 vulnerabilities
  When state is serialized to URL hash
  Then hash contains prefix "#v1=" followed by Base64URL string with no "=" padding
  And loading the URL in another tab hydrates the exact same state
```

---

## 3. Requirements Traceability Matrix (RTM)

```
+---------------------------------------------------------------------------------------------------------+
|                                    REQUIREMENTS TRACEABILITY MATRIX                                     |
+-------------+---------------------------+-----------------------------------+---------------------------+
| Req ID      | Architecture Component    | Code Implementation Unit          | Verification Test Case ID |
+-------------+---------------------------+-----------------------------------+---------------------------+
| FR-01       | Context Ingestion Layer   | `src/js/app.js`                   | `TC-CTX-001`, `TC-CTX-002`|
| FR-02       | Diurnal Inversion Engine  | `src/js/air-quality-engine.js`    | `TC-INV-001`, `TC-INV-002`|
| FR-03       | Vulnerability Engine      | `src/js/air-quality-engine.js`    | `TC-VUL-001`, `TC-VUL-002`|
| FR-04       | Routine Scheduler         | `src/js/offline-advisor.js`       | `TC-SCH-001`, `TC-SCH-002`|
| FR-05       | IAQ Hack Engine           | `src/js/offline-advisor.js`       | `TC-HAK-001`, `TC-HAK-002`|
| FR-06       | IAQ Cleaning Engine       | `src/js/offline-advisor.js`       | `TC-CLN-001`, `TC-CLN-002`|
| FR-07       | Ventilation Alert Engine  | `src/js/air-quality-engine.js`    | `TC-VNT-001`, `TC-VNT-002`|
| FR-08       | Transit Optimizer         | `src/js/offline-advisor.js`       | `TC-TRN-001`, `TC-TRN-002`|
| FR-09       | Particulate Dosage Math   | `src/js/impact-calculator.js`     | `TC-DOS-001`, `TC-DOS-002`|
| FR-10       | Carbon Accounting Math    | `src/js/impact-calculator.js`     | `TC-CRB-001`, `TC-CRB-002`|
| FR-11       | Community Bulletin Gen    | `src/js/app.js`                   | `TC-COM-001`              |
| FR-12       | URL Hash State Codec      | `src/js/app.js`                   | `TC-URL-001`, `TC-URL-002`|
+-------------+---------------------------+-----------------------------------+---------------------------+
```
