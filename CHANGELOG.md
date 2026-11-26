# Changelog

All notable changes to the **CleanAir Assistant** (Prompt War Challenge No. 6) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
