# Google Gemini Guidelines & Project Context

## Project Overview
This repository contains the design, source code, and documentation for **CleanAir Assistant** (Prompt War Challenge No. 6: Clean Air & Winter Smog Family/Community Assistant).

- **Challenge Vertical:** Family & Community Winter Air Quality & Smog Navigation.
- **Core Objective:** Build a GenAI-powered assistant that helps families and communities navigate severe winter smog and urban air pollution by suggesting low-emission daily routines, indoor air quality hacks, and sustainable alternatives tailored to location and lifestyle, while clearly explaining the direct quantifiable impact of their choices.
- **Primary AI Engine:** **Google Gemini** REST API with a model cascade that starts with `gemini-3.5-flash-lite` (see `GEMINI_MODELS_CASCADE` in `src/js/gemini-service.js`).
- **Fallback Engine:** Instantaneous deterministic offline rule advisor for zero-key evaluation.

---

## Architecture & Directory Structure
```
prompt-war-challenge-6-clean-air-assistant/
├── .gitignore                         # Exclusions guaranteeing repo size < 10 MB
├── .nojekyll                          # Bypasses Jekyll on GitHub Pages for raw asset serving
├── manifest.webmanifest               # PWA Progressive Web App install manifest
├── sw.js                              # PWA Offline Service Worker (Cache-First runtime)
├── package.json                       # npm scripts; no runtime dependencies
├── SRS.md                             # Authoritative IEEE 29148 Software Requirements Spec
├── README.md                          # Official submission document & evaluation playbook
├── GEMINI.md                          # Gemini developer guidelines and project context
├── agent.md                           # Core GenAI persona, system instructions & prompt specs
├── VERSION                            # Single source of truth version
├── CHANGELOG.md                       # Release notes and changelog
├── index.html                         # Responsive web application interface
├── .github/workflows/ci.yml           # Automated GitHub Actions test workflow
├── docs/                              # Architecture documents
│   ├── 00-problem-statement.md        # IEEE 29148 Problem statement & meteorology
│   ├── 01-prd.md                      # BDD Gherkin functional requirements (FR-01 to FR-12)
│   ├── 02-gemini-prompt-engineering.md# Gemini 3.8 Flash prompt engineering specification
│   ├── 02-hld.md                      # C4 High-Level Architecture Specification
│   ├── 03-api-contract.md             # Formal REST & JSON Schema Contracts
│   ├── 04-competition-and-platform-research.md # Competitor benchmark matrix
│   ├── 05-srs-detailed.md             # Detailed engineering specifications
│   ├── 07-architecture-tradeoffs-and-faq.md # Tradeoff analysis & evaluators FAQ
│   ├── 08-rubric-compliance-matrix.md # Competition rubric compliance matrix
│   ├── 06-adr/                        # Architectural Decision Records
│   ├── lld/                           # Low-Level Design (LLD-01 to LLD-07)
│   ├── resilience/                    # Offline degradation & chaos tolerance specs
│   ├── security/                      # Threat model & API key zero-persistence specs
│   ├── testing/                       # Triad testing strategy & Hoare logic specs
│   └── ui-ux/                         # Design tokens, accessibility & WCAG 2.1 AA specs
├── uml/                               # Visual Mermaid architecture & sequence diagrams
│   ├── 01-system-context.mmd          # C4 System Context
│   ├── 02-container-diagram.mmd       # C4 Container Diagram
│   ├── 03-component-diagram.mmd       # C4 Component Architecture
│   ├── 04-decision-sequence.mmd       # Sequence diagram
│   ├── 05-diurnal-inversion-state.mmd # FSM state diagram
│   └── 06-impact-calculation-flow.mmd # Impact calculation flow
├── src/                               # Clean, modular application source code
│   ├── css/style.css                  # Design tokens, glassmorphism, responsive grid & print
│   └── js/                            # Pure vanilla ES6+ modular architecture
│       ├── config.js                  # AQI thresholds, emission constants, basin presets
│       ├── air-quality-engine.js      # Diurnal inversion engine & 24h spline generator
│       ├── impact-calculator.js       # PM2.5 dosage, Kahan-Neumaier sum & CO2e math
│       ├── cadr-calculator.js         # Room clearance decay & Haversine geo distance
│       ├── live-aqi.js                # Open-Meteo live air quality
│       ├── event-bus.js               # Synchronous typed EventBus pub-sub
│       ├── state-codec.js             # 5-byte Base64URL compact bitstream encoder/decoder
│       ├── gemini-service.js          # Google Gemini API integration
│       ├── offline-advisor.js         # Deterministic rule engine fallback & 4-hack catalog
│       └── app.js                     # FastDOM write scheduler & UI controller
└── test/                              # Invariant, unit, integration, fuzz and browser tests
```

---

## Development Guidelines for Google Gemini

### 1. Model Configuration
- **Models, timeouts and generation settings:** defined in `src/js/gemini-service.js`, which is authoritative.
- **Output:** JSON matching `GEMINI_RESPONSE_SCHEMA`; the application owns every figure.
- **System instruction:** `GEMINI_SYSTEM_INSTRUCTION` in `src/js/gemini-service.js`. [agent.md](agent.md) describes the persona.

### 2. Dual-Engine Architecture
1. **Gemini mode:** with a user-provided API key, Gemini writes routines, the community advisory and per-choice insights.
2. **Offline mode:** without a key or network, `offline-advisor.js` builds the same plan shape from rules.

### 3. Strict Size & Hygiene Constraints
- Repository must stay strictly **under 10 MB** (CI enforces the limit).
- Single Git branch: `main`.
- Clean documentation and code with docstrings explaining function contracts.
