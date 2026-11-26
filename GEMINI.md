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
├── SRS.md                             # Authoritative IEEE 29148 Software Requirements Spec
├── README.md                          # Official submission document & evaluation playbook
├── GEMINI.md                          # Gemini developer guidelines and project context
├── agent.md                           # Core GenAI persona, system instructions & prompt specs
├── VERSION                            # Single source of truth version (1.0.0)
├── CHANGELOG.md                       # Release notes and changelog
├── index.html                         # Responsive web application interface
├── docs/                              # Deep architectural and domain documentation
│   ├── 01-architecture-and-logic.md   # Mathematical model, thermal inversion, AQI triage
│   ├── 02-gemini-prompt-engineering.md# Prompt templates, few-shot schemas, guardrails
│   └── 03-rubric-compliance-matrix.md # Evaluation rubric mapping (High/Med/Low impact)
├── uml/                               # Visual Mermaid architecture & sequence diagrams
│   ├── architecture-flow.mmd          # Component and data flow diagram
│   └── decision-sequence.mmd          # User context to recommendation sequence
├── src/                               # Clean, modular application source code
│   ├── css/                           # Design tokens, air quality indicators, glassmorphic UI
│   │   ├── style.css                  # Core layout & typography
│   │   └── aqi-themes.css             # Dynamic AQI visual indicator styles
│   └── js/                            # Modular JavaScript modules
│       ├── config.js                  # AQI thresholds, emission constants, default presets
│       ├── air-quality-engine.js      # Diurnal smog inversion detection & vulnerability scoring
│       ├── impact-calculator.js       # Mathematical PM2.5 exposure and CO2e reduction math
│       ├── gemini-service.js          # Google Gemini 3.8 Flash API integration
│       ├── offline-advisor.js         # Deterministic rule engine fallback
│       └── app.js                     # UI controller, accessibility & event handlers
└── test/                              # Automated test suite
    └── run-tests.js                   # Node.js automated test runner for all calculations
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
