# Google Gemini Guidelines & Project Context

## Project Overview
This repository contains the design, source code, and documentation for **CleanAir Assistant** (Prompt War Challenge No. 6: Clean Air & Winter Smog Family/Community Assistant).

- **Challenge Vertical:** Family & Community Winter Air Quality & Smog Navigation.
- **Core Objective:** Build a GenAI-powered assistant that helps families and communities navigate severe winter smog and urban air pollution by suggesting low-emission daily routines, indoor air quality hacks, and sustainable alternatives tailored to location and lifestyle, while clearly explaining the direct quantifiable impact of their choices.
- **Primary AI Engine:** **Google Gemini 3.8 Flash** (`gemini-3.8-flash` / `gemini-2.5-flash`) via Google GenAI API.
- **Fallback Engine:** Instantaneous deterministic offline rule advisor for zero-key evaluation.

---

## Architecture & Directory Structure
```
prompt-war-challenge-6-clean-air-assistant/
├── .gitignore                         # Exclusions guaranteeing repo size < 10 MB
├── .nojekyll                          # Bypasses Jekyll on GitHub Pages for raw asset serving
├── manifest.webmanifest               # PWA Progressive Web App install manifest
├── sw.js                              # PWA Offline Service Worker (Cache-First runtime)
├── package.json                       # Zero-dependency npm scripts metadata
├── SRS.md                             # Authoritative IEEE 29148 Software Requirements Spec
├── README.md                          # Official submission document & evaluation playbook
├── GEMINI.md                          # Gemini developer guidelines and project context
├── agent.md                           # Core GenAI persona, system instructions & prompt specs
├── VERSION                            # Single source of truth version (1.1.0)
├── CHANGELOG.md                       # Release notes and changelog
├── index.html                         # Responsive web application interface
├── .github/workflows/ci.yml           # Automated GitHub Actions test workflow
├── docs/                              # Deep 28-document architecture suite
│   ├── 00-problem-statement.md        # IEEE 29148 Problem statement & meteorology
│   ├── 01-prd.md                      # BDD Gherkin functional requirements (FR-01 to FR-12)
│   ├── 02-gemini-prompt-engineering.md# Gemini 3.8 Flash prompt engineering specification
│   ├── 02-hld.md                      # C4 High-Level Architecture Specification
│   ├── 03-api-contract.md             # Formal REST & JSON Schema Contracts
│   ├── 04-competition-and-platform-research.md # Competitor benchmark matrix
│   ├── 05-srs-detailed.md             # Detailed engineering specifications
│   ├── 07-architecture-tradeoffs-and-faq.md # Tradeoff analysis & evaluators FAQ
│   ├── 08-rubric-compliance-matrix.md # Competition rubric compliance matrix
│   ├── 06-adr/                        # Architectural Decision Records (ADR-001 to ADR-006)
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
│       ├── signals.js                 # Micro-reactive fine-grained dependency graph
│       ├── errors.js                  # Typed domain error hierarchy
│       ├── event-bus.js               # Synchronous typed EventBus pub-sub
│       ├── state-codec.js             # 5-byte Base64URL compact bitstream encoder/decoder
│       ├── gemini-service.js          # Google Gemini 3.8 Flash API integration
│       ├── offline-advisor.js         # Deterministic rule engine fallback & 4-hack catalog
│       └── app.js                     # FastDOM scheduler, Result monad & UI controller
└── test/                              # Automated zero-dependency test suite
    ├── run-tests.js                   # Node.js runner for all 54 Triad invariant tests
    └── run-fuzz-tests.js              # 10,000 Property-based fuzz tests (Xorshift128+)
```

---

## Development Guidelines for Google Gemini

### 1. Model Configuration & Parameters
- **Target Model:** `gemini-3.8-flash` (or `gemini-2.5-flash` where standard availability applies).
- **Generation Config:**
  - `temperature: 0.3` (Low temperature to ensure scientifically grounded, high-precision air quality advice).
  - `topP: 0.85`
  - `responseMimeType: "application/json"` (for structured recommendations) or clean Markdown with clear headings.
- **System Instructions:** Strictly derived from [agent.md](file:///C:/Users/techd/Documents/workspace-spring-tool-suite-4-4.27.0-new/prompt-war-challenge-6-clean-air-assistant/agent.md).

### 2. Dual-Engine Architecture
1. **Live Gemini 3.8 Flash Mode:** When a Google Gemini API Key is provided by the user, calls are routed to Gemini Flash endpoint for real-time generative reasoning, contextual empathy, and dynamic plan tailoring.
2. **Deterministic Offline Mode:** If no API key is provided or the client is offline, the application seamlessly activates `offline-advisor.js` to deliver mathematically verified recommendations, ensuring evaluators can test 100% of the functionality instantly without API keys or setup friction.

### 3. Strict Size & Hygiene Constraints
- Repository must stay strictly **under 10 MB** (current footprint < 1.5 MB).
- Single Git branch: `main`.
- Clean documentation and code with docstrings explaining function contracts.
