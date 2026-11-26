# Changelog

All notable changes to the **CleanAir Assistant** (Prompt War Challenge No. 6) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-26

### Added
- **Problem Statement §5 Target Personas Quick Presets**: Added `TARGET_PERSONAS` dictionary in `src/js/config.js` and 1-click Quick Preset bar in `index.html` (`applyPersona` in `app.js`) for instant evaluation of Ananya (Infant 18m, AQI 425), Rajesh (Asthma 68y, AQI 380), Vikram (Two-Wheeler 22km, AQI 410), and Ramesh (Traffic Officer, AQI 460).
- **Resilient Network Backoff with Decorrelated Jitter (`fetchWithRetry`)**: Implemented exponential backoff and randomized decorrelated jitter ($t_{\text{wait}} = \min(t_{\text{max}}, \text{random}(t_{\text{base}}, t_{\text{prev}} \times 3))$) in `src/js/gemini-service.js` conforming to Discipline D50 Resilience Architecture (`docs/resilience/01-offline-degradation-and-fallback.md` §2).
- **Tab 11 Share Link Action Button (`#btn-copy-link`)**: Wired direct deep-link clipboard copying and polite live screen reader announcement conforming to `docs/ui-ux/02-accessibility-and-a11y-matrix.md` §4 keyboard navigation sequence.
- **Triad Test Suite Expansion to 58 Invariants**: Added `TC-PER-001` (4 quantitative target personas validation) and `TC-RES-001` (`fetchWithRetry` resilience contract), reaching 58 passing tests alongside 10,000 property-based fuzz vectors.
- **PRD FR-06 Cleaning Protocol & Resuspension Shield**: Added `getCleaningProtocol(aqi)` enforcing damp microfiber wet-mopping with 0.1% surfactant and strictly prohibiting traditional dry broom sweeping when AQI > 200.
- **Dedicated IAQ Cleaning Shield UI Card**: Rendered dynamic status badge, resuspension warning, and cleaning formula in `index.html` via `app.js`.
- **Security & Threat Model Hardening**: Integrated strict Content Security Policy (`default-src 'self'`) and OpenGraph/Twitter card social preview metadata.
- **SOLID Strategy Pattern & LSP (`IPlanProvider`, `OfflinePlanProvider`)**: Implemented abstract plan provider contract and deterministic offline provider satisfying Liskov Substitution Principle (LLD 03).
- **Native Google Gemini 3.8 Flash `responseSchema`**: Enforced native JSON schema output at the model level matching `docs/03-api-contract.md`.
- **Service Worker Cache v1.1 (`sw.js`)**: Updated cache lifetime key to `cleanair-guardian-v1.1` for clean PWA asset invalidation.
- **Triad Test Suite Expansion to 56 Invariants**: Added `TC-LSP-001` and `TC-SCH-001`, bringing total automated verification to 56 passing tests.
- **Micro-Reactive Signals Graph (`signals.js`)**: Pure dependency-tracking signals engine (`createSignal`, `createComputed`, `createEffect`) for zero dirty reads.
- **Continuous 24-Hour Diurnal Spline Curve**: Analytical 96-point spline model of atmospheric boundary layer mixing height with live animated SVG time marker.
- **Room CADR Clearance Calculator (`cadr-calculator.js`)**: Interactive dimensional volume, ACH turnover, and exponential clearance times ($t_{50}, t_{90}, t_{99}$).
- **PWA Service Worker (`sw.js`) & Manifest**: Offline Progressive Web App support with Cache-First asset runtime.
- **5-Byte Base64URL State Bitstream Codec**: Isomorphic URL hash state sharing (`#b=...`) with zero external serialization dependencies.
- **4-Hack IAQ Catalog**: DIY Corsi-Rosenthal box (273 CFM), PC-fan stealth nursery purifier (85 CFM), wet-towel emergency filter (30 CFM), and activated carbon kitchen vent scrub (180 CFM).
- **Bilingual Community Bulletins**: Localized WhatsApp/RWA broadcast generator supporting English and Hindi (हिन्दी).
- **Zero-Drift Documentation Synchronization**: Synchronized test catalog, architecture file trees, and system prompt specifications.

## [1.0.0] - 2026-11-26

### Added
- **Repository Setup**: Initialized single-branch public repository on GitHub (`main`), constrained strictly below the 10 MB competition limit.
- **Gemini Architecture**: Full integration specification with **Google Gemini 3.8 Flash** (`@google/genai` / Gemini Developer REST API).
- **Core AI Agent Specification (`agent.md`)**: System prompt, safety guardrails, diurnal inversion logic, and persona rules for the Family & Community Air Quality Guardian.
- **Dual Engine Execution**: Gemini 3.8 Flash generative reasoning engine coupled with high-fidelity deterministic offline rule engine for instantaneous, zero-key fallback.
- **Context-Aware Triage Engine**:
  - Diurnal thermal inversion monitoring (morning/evening hazardous spikes).
  - Vulnerability matrix (infants, seniors, pregnant women, asthmatics, outdoor workers, pets).
  - Household lifestyle factors (cooking method, heating system, commute type).
- **Actionable Indoor Air Quality (IAQ) Hacks**:
  - Low-cost DIY Corsi-Rosenthal Box construction guide & filtration efficiency.
  - Wet-mopping vs vacuum particulate resuspension protocols.
  - Thermal ventilation window optimization.
  - Safe hyper-accumulating indoor plants (NASA study baseline).
- **Direct Impact Calculator**:
  - Inhaled PM2.5 avoidance formula ($\Delta \text{Exposure} = \text{AQI}_{\text{delta}} \times \text{Ventilation Rate} \times \text{Hours}$).
  - Carbon footprint reduction ($\text{kg CO}_2\text{e}$ saved).
  - Community Air Shield Protection Index (0-100%).
- **Responsive Single-Page Application**:
  - Pure lightweight web application with glassmorphism aesthetic.
  - High-contrast visual AQI status themes (Good, Moderate, Poor, Very Poor, Severe, Hazardous).
  - Full keyboard accessibility and WCAG 2.1 AA compliant semantic layout.
- **Testing Suite**: Automated invariant tests covering triage logic, exposure mathematics, and offline fallback consistency.
- **Documentation Suite**: Level 2.2 compliant IEEE 29148 `SRS.md`, `README.md`, `GEMINI.md`, `docs/`, and `uml/` diagrams.
