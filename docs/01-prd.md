# Product Requirements Document (PRD)
## CleanAir Guardian (VayuRakshak) — GenAI Winter Smog & Urban Air Quality Assistant

**Document Identifier:** PRD-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 0  
**Target Platform:** Google Gemini 3.8 Flash / Pure Web Runtime  

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

## 2. User Journeys & End-to-End Interaction Lifecycles

```
+----------------------------------------------------------------------------------------------------+
|                                    END-TO-END USER JOURNEY                                         |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [ Step 1: Input Context ]                                                                         |
|  User enters City (e.g. Delhi), Current AQI (e.g. 395), Household Vulnerabilities (Infant +      |
|  Asthmatic Grandma), Cooking (LPG), Heating (Space heater), Commute (Two-wheeler).                 |
|                                         |                                                          |
|                                         v                                                          |
|  [ Step 2: Atmospheric Triage & Dual Engine Routing ]                                              |
|  System models diurnal boundary layer height -> If Gemini API key present: routes to Gemini 3.8   |
|  Flash; Else: routes to Deterministic Offline Rule Advisor (<15ms latency).                        |
|                                         |                                                          |
|                                         v                                                          |
|  [ Step 3: Personalized Clean Air Action Plan ]                                                    |
|  - Diurnal Schedule: "Shift 7:30 AM stroller walk to 1:15 PM indoor sunlight window".             |
|  - IAQ Hack: Step-by-step Corsi-Rosenthal box plan (250 CFM CADR for $30).                         |
|  - Commute: "Switch to N95 mask + AC recirculation mode on transit; avoid Ring Road bottlenecks".  |
|                                         |                                                          |
|                                         v                                                          |
|  [ Step 4: Quantified Impact Verification ]                                                        |
|  Displays: "142 µg PM2.5 Inhalation Avoided Today (6.4 Cigarettes Equivalent)", "2.1 kg CO2e Saved"|
|                                         |                                                          |
|                                         v                                                          |
|  [ Step 5: Community Sharing & State Serialization ]                                               |
|  User clicks "Copy WhatsApp Advisory" or shares `#v1=...` URL hash state with neighborhood RWA.   |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Numbered Functional Requirements (FR-01 to FR-12)

### FR-01: Context Ingestion & Normalization
- **Description:** The system SHALL accept and validate user context parameters: city/region name, current outdoor AQI ($0 - 500+$), vulnerable household members (infants, asthmatics, pregnant women, elderly, outdoor workers), domestic cooking method (Induction, PNG, LPG, Biomass), space heating type (Electric radiator, Space heater, Heat pump, Open fire), and commute mode (Private car, Two-wheeler, Public transit, Walking/Cycling).
- **Validation:** Numeric inputs sanitized; non-empty selections enforced; missing parameters assigned conservative default presets.

### FR-02: Diurnal Atmospheric Inversion Tracking
- **Description:** The system SHALL compute the local diurnal Planetary Boundary Layer (PBL) state based on time-of-day:
  - Morning Inversion Trap Window ($06:00 - 09:30$)
  - Solar Convective Dispersal Window ($12:30 - 15:30$)
  - Evening Inversion Re-condensation Window ($18:00 - 22:00$)
  - Baseline Night Window ($22:00 - 06:00$)

### FR-03: Vulnerability Weighting Index ($K_{\text{vuln}}$)
- **Description:** The system SHALL compute a composite biological vulnerability factor:
  $$K_{\text{vuln}} = 1.0 + \sum_{m \in M} w_m$$
  Where $w_{\text{infant}} = 0.45$, $w_{\text{asthma}} = 0.80$, $w_{\text{senior}} = 0.35$, $w_{\text{pregnant}} = 0.40$, $w_{\text{outdoor}} = 0.30$.

### FR-04: Dynamic Routine Rescheduling Engine
- **Description:** The system SHALL generate an hour-by-hour tailored daily schedule that systematically reschedules strenuous physical exertion, school drop-offs, and outdoor chores outside the morning and evening hazard windows and into the solar dispersal window.

### FR-05: DIY Corsi-Rosenthal Box IAQ Prescription
- **Description:** The system SHALL output detailed assembly instructions, material specifications (1x 20-inch box fan, 4x MERV 13 furnace filters, cardboard shroud), airflow mechanics, and safety guidelines for constructing a low-cost high-CADR air purifier.

### FR-06: Wet-Mopping vs. Dry-Brooming Protocol
- **Description:** The system SHALL provide actionable indoor cleaning rules, prescribing damp microfiber mopping (with $0.1\%$ mild surfactant) and banning traditional dry broom sweeping during high AQI alerts to prevent particulate resuspension.

### FR-07: Strategic Solar Ventilation Window Alerting
- **Description:** The system SHALL calculate and display the exact safe afternoon ventilation window ($12:30 - 15:30$) when residents can perform a controlled 15-minute cross-ventilation purge to dilute indoor $CO_2$ and volatile organic compounds (VOCs) without saturating the home with peak smog particulates.

### FR-08: Sustainable Transit & Commute Alternatives
- **Description:** The system SHALL recommend commute optimizations based on user transit modes: routing two-wheelers through low-traffic green corridors, enforcing car cabin air recirculation, and recommending carpool clusters or electric mass transit.

### FR-09: Inhaled PM2.5 Dosage Avoidance Calculation
- **Description:** The system SHALL compute the exact particulate inhalation avoided in micrograms ($\mu\text{g}$) and equivalent non-smoked cigarettes:
  $$\text{Dosage}_{\text{avoided}} = \left(C_{\text{outdoor}} - C_{\text{indoor}}\right) \times V_E \times \Delta t \times \eta_{\text{dep}}$$

### FR-10: Carbon Emissions & Fuel Savings Calculation
- **Description:** The system SHALL compute the net carbon emissions avoided in kilograms ($\text{kg CO}_2\text{e}$) when the user adopts recommended commute or heating alternatives.

### FR-11: One-Click Copyable Community Advisory Generator
- **Description:** The system SHALL generate structured, markdown-formatted announcements tailored for WhatsApp parent groups, resident welfare association (RWA) notice boards, and school transport committees.

### FR-12: Stateless URL Hash State Codec (`#v1=...`)
- **Description:** The system SHALL serialize the complete user context and plan configuration into a compressed, Base64URL-encoded hash string within the browser address bar, enabling zero-database sharing across users and evaluators.

---

## 4. Numbered Non-Functional Requirements (NFR-01 to NFR-10)

| ID | Requirement Category | Metric / Specification |
|:---|:---|:---|
| **NFR-01** | **Latency & Responsiveness** | Offline engine execution $\le 15\text{ms}$; Google Gemini Flash response $\le 1.8\text{s}$; DOM paint $\le 60\text{ms}$. |
| **NFR-02** | **Privacy & Zero Telemetry** | 100% client-side execution; zero PII sent to servers; API keys stored in volatile memory only. |
| **NFR-03** | **Accessibility (WCAG)** | Strict compliance with WCAG 2.1 Level AA; APCA contrast ratio $\ge 4.5:1$ across all AQI themes. |
| **NFR-04** | **Repository Footprint** | Total Git repository size strictly $< 10\text{ MB}$ (target actual $< 2.0\text{ MB}$). |
| **NFR-05** | **Branch Invariance** | Exactly ONE single branch (`main`) in Git repository; zero dangling feature branches. |
| **NFR-06** | **Zero External Build Step**| Pure modular web application (HTML5/CSS3/ES6+); runs natively in modern browsers with zero bundling steps. |
| **NFR-07** | **Dual-Engine Graceful Degradation** | 100% feature parity in Offline Mode when Gemini API key is omitted, invalid, or rate-limited. |
| **NFR-08** | **Ergonomics & Responsiveness**| Seamless usability across Mobile ($\le 480\text{px}$), Tablet ($481-768\text{px}$), and Desktop ($\ge 769\text{px}$). |
| **NFR-09** | **Mathematical Determinism** | Dosage and carbon equations produce mathematically identical results given identical input vectors. |
| **NFR-10** | **High-Contrast Smog Palettes** | High-contrast visual indicators allowing immediate readability under low-contrast, smoggy outdoor glare. |

---

## 5. Requirements Traceability Matrix (RTM)

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
| NFR-01..10  | Cross-Cutting Governance  | Full Application Framework        | `TC-GOV-001` to `005`     |
+-------------+---------------------------+-----------------------------------+---------------------------+
```
