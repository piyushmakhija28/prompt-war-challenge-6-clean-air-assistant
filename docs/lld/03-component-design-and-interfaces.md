# Component Design & JavaScript Module Interfaces (LLD)
## CleanAir Guardian (VayuRakshak) — Modular ES6 Architecture & JSDoc Contracts

**Document Identifier:** LLD-COMPONENTS-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 1  
**Lead Architect:** `solution-architect`  

---

## 1. Modular Source Code Architecture (`src/js/`)

The application is decomposed into six cleanly decoupled ES6 modules adhering to Level 2.2 Docstrings-Only governance (`12-docstrings-only.md`):

```
src/js/
├── config.js                 # Global constants, AQI thresholds, emission factors, default presets
├── air-quality-engine.js     # Diurnal boundary layer modeling, state machine, vulnerability index
├── impact-calculator.js      # Particulate dosage calculus, cigarette conversion, carbon accounting
├── offline-advisor.js        # Deterministic decision trees, Corsi-Rosenthal hack, schedule generator
├── gemini-service.js         # Google Gemini 3.8 Flash REST client, timeout, retry backoff with jitter
└── app.js                    # UI Controller, event bus, URL codec, DOM reconciliation engine
```

---

## 2. JSDoc Interface Contracts

### 2.1 `config.js`
```javascript
/**
 * Global configuration parameters, AQI standard bands, emission factors, and presets.
 * @module config
 */

export const AQI_BANDS = {
  GOOD: { min: 0, max: 50, label: "Good", color: "#10b981", textColor: "#ffffff" },
  MODERATE: { min: 51, max: 100, label: "Moderate", color: "#f59e0b", textColor: "#000000" },
  POOR: { min: 101, max: 200, label: "Poor", color: "#f97316", textColor: "#ffffff" },
  VERY_POOR: { min: 201, max: 300, label: "Very Poor", color: "#ef4444", textColor: "#ffffff" },
  SEVERE: { min: 301, max: 400, label: "Severe", color: "#b91c1c", textColor: "#ffffff" },
  HAZARDOUS: { min: 401, max: 999, label: "Hazardous", color: "#7f1d1d", textColor: "#ffffff" }
};

export const EMISSION_FACTORS = {
  SOLO_PETROL_CAR_G_PER_KM: 192,
  CARPOOL_G_PER_KM: 76,
  METRO_TRANSIT_G_PER_KM: 28,
  BIOMASS_HEATER_G_PER_HOUR: 850,
  ELECTRIC_RADIATOR_G_PER_HOUR: 180
};
```

### 2.2 `air-quality-engine.js`
```javascript
/**
 * Diurnal atmospheric boundary layer and vulnerability triage module.
 * @module air-quality-engine
 */

/**
 * Categorizes raw numerical AQI into standard public health tiers.
 * @param {number} aqi - Numerical Air Quality Index value.
 * @returns {Object} Tier details including band name, color token, and health summary.
 */
export function getAQITier(aqi) { ... }

/**
 * Returns current diurnal atmospheric inversion state.
 * @param {number} hour24 - Hour of day in 24-hour decimal format (e.g. 7.5 = 7:30 AM).
 * @returns {Object} State identifier, ground particulate multiplier, and ventilation flag.
 */
export function getDiurnalInversionState(hour24) { ... }

/**
 * Calculates composite biological vulnerability multiplier.
 * @param {string[]} vulnerabilities - Array of selected vulnerability keys.
 * @returns {number} Multiplier factor K_vuln >= 1.0.
 */
export function calculateVulnerabilityMultiplier(vulnerabilities) { ... }
```

### 2.3 `impact-calculator.js`
```javascript
/**
 * Environmental calculus and respiratory particulate dosage engine.
 * @module impact-calculator
 */

/**
 * Computes particulate mass avoided in micrograms and equivalent cigarettes.
 * @param {number} aqi - Ambient outdoor AQI.
 * @param {number} hoursShifted - Duration of outdoor exposure avoided.
 * @param {string} activityLevel - Activity exertion ('RESTING' | 'EXERCISE' | 'CHILD').
 * @param {boolean} hasIndoorPurifier - Whether indoor filtration is deployed.
 * @returns {Object} Dosage metrics { microgramsAvoided, cigarettesAvoided, protectionScore }.
 */
export function calculateParticulateAvoidance(aqi, hoursShifted, activityLevel, hasIndoorPurifier) { ... }

/**
 * Calculates net carbon emissions avoided.
 * @param {string} commuteMode - Current commute mode.
 * @param {number} distanceKm - One-way trip distance.
 * @returns {number} Net kilograms of CO2e avoided.
 */
export function calculateCarbonAvoided(commuteMode, distanceKm) { ... }
```

### 2.4 `gemini-service.js`
```javascript
/**
 * Google Gemini 3.8 Flash REST client with resilient backoff.
 * @module gemini-service
 */

/**
 * Dispatches structured generation request to Gemini 3.8 Flash.
 * @param {Object} context - Sanitized user context payload.
 * @param {string} apiKey - Google Gemini API key.
 * @param {number} [timeoutMs=8000] - Request timeout in milliseconds.
 * @returns {Promise<Object>} Validated CleanAirActionPlan JSON response.
 * @throws {Error} Throws network, timeout, or rate-limit exceptions.
 */
export async function generateGeminiPlan(context, apiKey, timeoutMs = 8000) { ... }
```

### 2.5 `offline-advisor.js`
```javascript
/**
 * Deterministic offline rule advisor providing 100% functional parity.
 * @module offline-advisor
 */

/**
 * Generates comprehensive action plan deterministically without external API calls.
 * @param {Object} context - User context payload.
 * @returns {Object} Complete CleanAirActionPlan matching Gemini schema exactly.
 */
export function generateOfflinePlan(context) { ... }
```

### 2.6 `app.js`
```javascript
/**
 * Main application coordinator, event delegator, and DOM reconciliation controller.
 * @module app
 */

/**
 * Initializes application lifecycle, binds event listeners, checks URL hash state.
 */
export function initApp() { ... }

/**
 * Encodes current state to URL hash fragment.
 * @param {Object} state - Application state object.
 */
export function encodeStateToHash(state) { ... }

/**
 * Decodes URL hash fragment into application state.
 * @param {string} hash - URL hash string.
 * @returns {Object|null} Hydrated state or null if invalid.
 */
export function decodeStateFromHash(hash) { ... }
```
