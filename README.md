# CleanAir Guardian (VayuRakshak) — Winter Smog & Urban Pollution Community AI Assistant

> **Prompt War Challenge No. 6 Submission**
> **Challenge Problem Statement:** *"Create a GenAI-powered assistant that helps families and communities navigate severe winter smog and urban air pollution. The application should suggest low-emission daily routines, indoor air quality hacks, and sustainable alternatives tailored to their location and lifestyle, while clearly explaining the direct impact of their choices."*
> **Public Repository:** [https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant](https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant)
> **AI platform:** Google Gemini API / Google Antigravity ecosystem

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant)
[![Build Status](https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant/actions)
[![AI Engine](https://img.shields.io/badge/AI_Engine-Google_Gemini-4285F4?logo=google)](https://ai.google.dev/)
[![PWA](https://img.shields.io/badge/PWA-Offline_Ready-purple.svg)](#overview)

---

## Overview

CleanAir Guardian is a static web app for households living with winter smog. A family describes its location, air quality, members at risk, home, cooking, heating, commute and indoor air hack. The app then shows:

| The challenge asks for | What the app does |
|---|---|
| Low-emission daily routines | A four-slot schedule (morning, midday, afternoon, evening) built for the household |
| Indoor air quality hacks | Four selectable low-cost hacks with materials and steps, a room clearance estimator and a cleaning protocol |
| Sustainable alternatives | Commute, cooking and heating alternatives with their modelled effect |
| Tailored to location and lifestyle | Live modelled air quality for the chosen or detected area, plus vulnerabilities, housing and habits |
| Clear direct impact of choices | PM2.5 avoided, cigarette equivalents, CO₂e, and one sentence per choice saying what switching it would change |
| GenAI | Google Gemini writes the routines, advisory and per-choice explanations; the app owns every number |

It works without an API key through a deterministic on-device advisor.

### Chosen Vertical

**Family and community winter air quality and smog navigation.**

- **Households with people at risk:** infants, older adults, pregnant women, people with asthma or COPD.
- **Communities:** an English or Hindi advisory that can be shared to a WhatsApp or residents' group.
- **Daily commuters and outdoor workers:** exposure on the road and during an outdoor shift.

Background: [problem statement](docs/00-problem-statement.md) and [product requirements](docs/01-prd.md).

---

## Approach and Logic

The app moves from passive data ("AQI is 482") to actions chosen for this household, each with its estimated effect.

```
Household profile + AQI (live or manual)
            |
            v
  Protection policy  ----  which measures today? (filter, mask, timed airing, stay in)
            |
            v
  Daily exposure model ----  unprotected day vs. protected day, and one comparison per choice
            |
            +--> Cards, dose bars, per-choice explanations   (updated immediately)
            |
            v
  Advice engine: Gemini, or the on-device advisor
  (routines, community advisory, sustainable alternatives)
```

### A. Protection policy

Households with any vulnerability start protecting themselves at a lower AQI.

| Measure | Applies above AQI | With a vulnerable member |
|---|---:|---:|
| Run the indoor air filter | 100 | 50 |
| Wear a mask outdoors (car: recirculate) | 200 | 100 |
| Shorten window airing and move it to early afternoon | 200 | 100 |
| Postpone non-essential trips | 300 | 200 |

On clean-air days the app does not tell people to seal windows or wear N95 masks.

### B. Daily exposure model

The model compares choices with each other. Its constants are planning estimates, listed under [Assumptions](#assumptions-made), not measurements.

1. **Home:** outdoor PM2.5 that leaks in, plus cooking and heating particles. A room filter removes the share `CADR / (CADR + air exchange + deposition)` during the filtered hours.
2. **Window airing:** one hour at the morning peak, or a short early-afternoon airing on protected days.
3. **Travel:** the commute, plus an eight-hour shift for outdoor workers; masks or car recirculation reduce it.

Inhaled dose is `concentration × breathing rate × hours × deposition fraction`, scaled for the vulnerabilities selected.

### C. What changes the figures

| Choice | Effect in the model |
|---|---|
| Indoor air hack | Clean air delivery of the filter, capture of cooking particles at the stove, or fewer leaks |
| Cooking fuel | Indoor particles while cooking |
| Heating | Indoor particles and CO₂e per heating hour |
| Commute mode and distance | Time on the road, exposure, effort and CO₂e per km |
| Housing | Share of outdoor smog that leaks in |
| Vulnerabilities | Thresholds above and dose sensitivity |

While solid fuel burns indoors the app never suggests a tighter home or sealing gaps, and credits no benefit for it, because of carbon monoxide; it asks for a vent to stay open.

### D. Time-of-day inversion model

Winter inversions usually trap pollution near the ground around dawn and dusk. The time scrubber applies a fixed daily curve, with a morning trap (06:00–09:30), a lower window (12:30–15:30) and an evening trap (18:00–22:00). It is an illustrative model, not a forecast. See [the inversion design note](docs/lld/01-meteorological-inversion-engine.md) and [ADR-004](docs/06-adr/ADR-004-diurnal-thermal-inversion-modeling.md).

---

## How the Solution Works

### Two advice engines

- **Gemini mode:** the app sends a whitelisted profile, the figures it displays and, for each choice, whether a better option exists. The request uses a response schema. Gemini returns routines, an English and Hindi community advisory, and an alternative with a reason for each choice. Text that states a figure the app owns, contains markup or links, or names an unknown choice is rejected. Models are tried in order: `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-flash-latest`.
- **Offline mode:** with no key, no network or a Gemini failure, `offline-advisor.js` builds the same plan shape from rules. Its routines and advisory differ by AQI band, vulnerability, housing, cooking, heating, commute and hack.

Requests are debounced (800 ms), a newer request always wins, temporary failures are retried at most three times, and a rate limiter and circuit breaker protect the quota. See the [API contract](docs/03-api-contract.md).

### Features

- **Four target personas** that fill the whole profile in one click: Ananya (18-month-old infant, Delhi NCR), Rajesh (68, asthma, Lahore), Vikram (two-wheeler commuter), Ramesh (outdoor worker with biomass cooking and an open fire).
- **Impact panel:** cards, unprotected versus protected dose bars, where the avoided dose comes from, and one explanation per choice.
- **Four indoor air hacks:** Corsi-Rosenthal box (273 CFM, about $48 in parts), PC-fan purifier (85 CFM, about $20), wet towels at door gaps (a stopgap far weaker than a fan filter, about $2) and a kitchen exhaust carbon filter (180 CFM, about $15).
- **Room clearance estimator:** air changes per hour and 50/90/99% clearance times, in feet or metres.
- **Cleaning protocol:** above AQI 200 the app advises damp mopping instead of dry sweeping.
- **Community advisory:** English or Hindi, shareable or copyable, and a print layout.
- **Shareable link:** the profile is encoded in the URL fragment (`#b=...` for common profiles, `#v1=...` otherwise).
- **Offline PWA:** a service worker caches the app shell.

### Live data and binding

| What you see | Where it comes from | When it changes |
|---|---|---|
| AQI | Open-Meteo modelled PM2.5 (`AQI: Live`) or your own value (`AQI: Manual`) | load, city change, detect, refresh button, every 15 minutes, slider, persona |
| Metric cards, dose bars, explanations | one on-device calculation (`computeImpact`) | immediately on every change |
| Routines and advisory text | Gemini (`Advice: Gemini <model>`) or the on-device advisor (`Advice: Offline`) | after 800 ms without further changes; `Advice: Refreshing` meanwhile |

Slider moves, personas and shared links switch to manual AQI; **Use live AQI** switches back. If the feed or Gemini fails, the app keeps working with on-device results and says why.

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0, non-commercial free tier).

### Security and privacy

- The API key is held in page memory only. It is never written to storage, cookies or the URL, and it is gone when the tab is closed or reloaded.
- The input field is cleared on activation. **Purge Key** overwrites the stored bytes with random data and then zeroes.
- The key travels only in the `x-goog-api-key` header to `generativelanguage.googleapis.com`. There is no backend or analytics.
- A Content Security Policy limits network connections to the services listed here, and page text is written without `innerHTML`.
- Locating yourself sends coordinates rounded to about 1 km to Open-Meteo, BigDataCloud and OpenStreetMap. Gemini never receives coordinates.
- A shared link contains your household profile, including vulnerability selections, so share it with people you trust.

Design record: [ADR-009](docs/06-adr/ADR-009-client-side-security-and-key-safety.md) and the [threat model](docs/security/01-threat-model-and-safety.md).

---

## Assumptions Made

All figures are planning estimates for comparing choices. They are not measurements of a real home or medical advice.

| Area | Assumption |
|---|---|
| AQI to PM2.5 | Piecewise linear breakpoints in `src/js/config.js` |
| Live AQI | A modelled hourly area estimate converted from PM2.5, not a local sensor |
| Housing leak share | Airtight 0.40, standard 0.65, drafty 0.85 of outdoor PM2.5 |
| Air changes per hour | Airtight 0.4, standard 0.7, drafty 1.5; deposition 0.24 per hour |
| Room and filter use | 54 m³ room, filter running 14 hours a day |
| Cooking particles (2 h) | Induction 15, gas 35, biomass 300 µg/m³ |
| Heating particles (6 h) | Heat pump and oil radiator 0, space heater 20, open fire 200 µg/m³ |
| Window airing | Unprotected: 1 h at 07:30. Protected high-AQI day: 15 minutes at 13:00 |
| Commute | One trip of the chosen distance a day; walk 8, two-wheeler and car 25, metro 20 km/h |
| Roadside exposure factor | Walk 1.2, two-wheeler 1.5, metro 0.9, car 0.8 |
| Protection | Mask removes 80%, car recirculation 60% |
| Breathing | 10.8 m³/day × 1.3, doubled for walking or cycling and outdoor work (8 h); 28% deposition |
| Cigarette equivalent | 66.5 µg inhaled PM2.5, a conversion derived from the Berkeley Earth rule of thumb |
| CO₂e per km | Solo petrol car 240 g, two-wheeler 60 g, metro 28 g, walking 0 g |
| CO₂e per heating hour | Open fire 930 g, oil radiator 288 g, heat pump 96 g; no factor for the space heater or cooking |
| CO₂e You Could Save | Switching the commute to metro and the heating to a heat pump |

### Known Limitations

- The exposure model is simplified and has not been validated against field measurements.
- A shared link carries the household's health selections, because the recipient's figures depend on them. The selected indoor air hack is not part of the link.
- Automated browser tests run in Chromium only (desktop and mobile emulation). Firefox, Safari, colour contrast, real screen readers and printed output have not been verified.

---

## Prerequisites / Requirements

- A modern browser.
- Node.js 22 or newer to use the bundled server or run the tests.
- Optional: a Google Gemini API key.

## Installation / Setup

The app has no runtime dependencies and no build step. It uses ES modules, so open it over HTTP; double-clicking `index.html` does not work.

```bash
git clone https://github.com/piyushmakhija28/prompt-war-challenge-6-clean-air-assistant.git
cd prompt-war-challenge-6-clean-air-assistant
npm start
```

Then open [http://localhost:8080](http://localhost:8080). The [server](server.js) opens your browser (disable with `NO_OPEN=1`) and accepts another port through `PORT`. Any static file server also works, for example `python -m http.server 8080`.

## Usage

1. Choose a persona, or set the location, air quality and household profile.
2. Read the cards, dose bars and **How Your Choices Change the Impact**.
3. Switch a choice, such as the commute or the hack tab, and compare.
4. To use Gemini, paste a key under **Google Gemini AI Settings** and press **Activate (In-Memory)**.
5. Share the advisory or link, or print the plan.

---

## Testing

Playwright is the only development dependency.

```bash
npm ci
npx playwright install chromium

npm test              # invariant suite plus node:test unit and integration suites
npm run test:fuzz     # property-based fuzz suite
npm run test:browser  # Chrome DevTools Protocol browser suite (needs Chrome or Edge)
npm run test:e2e      # Playwright end-to-end scenarios, desktop and mobile
npm run verify        # all of the above
```

| Suite | Location | What it covers |
|---|---|---|
| Invariants | `test/run-tests.js` | Formulas, codec, cascade, UI contracts and repository rules |
| Unit | `test/unit/` | Impact model, offline advisor, live AQI, state codec, input cleaning, Gemini helpers, server paths |
| Integration | `test/integration/` | Gemini request and response contract, model cascade, timing, rate limit and circuit breaker, application binding |
| Fuzz | `test/run-fuzz-tests.js` | Algebraic invariants over pseudorandom inputs |
| Browser | `test/run-browser-tests.js` | Checks in headless Chrome or Edge |
| End-to-end | `test/e2e/` | Key lifecycle, live binding, consistency, races, Gemini failures, resilience, live AQI, shared links, offline, accessibility, mobile viewport |

Every suite intercepts or stubs Gemini, Open-Meteo and the geocoding services, so no key or network access to them is needed. CI also rejects committed API keys and enforces the 10 MB size limit.

### Manual QA scenarios

| ID | Scenario | Steps | Expected result |
|:--:|---|---|---|
| TS-01 | Persona preset | Click **Ananya (Infant)** | Delhi NCR, manual AQI 425, `HAZARDOUS`; infant checked; standard flat, LPG, heater, two-wheeler 8 km. With the Corsi-Rosenthal box: 674 µg avoided |
| TS-02 | Time scrubber | Move the scrubber to 08:00, 14:00 and 20:00 | The badge ends in `Trap`, `Safe`, `Trap`; the notice and curve marker agree |
| TS-03 | Room clearance | Enter 15 × 12 × 9 ft with the Corsi-Rosenthal device | 1,620 ft³; about 10.1 air changes per hour; 50% in about 4 min, 90% in about 13 min, 99% in about 26 min |
| TS-04 | One set of figures | Select **Vikram** | Unprotected 772 µg, protected 309 µg; cards show 463 µg, 7.0 Cigs, 0.7 kg, 60% |
| TS-05 | Choices change impact | With Vikram, open the **PC Fan** tab; then choose **Metro** | PC fan: 400 µg avoided. Metro with the Corsi-Rosenthal tab: 452 µg avoided, 0 kg CO₂e left to save. Explanations update |
| TS-06 | Shared link | Press **Link**, open the URL in a private window | Location, AQI and household profile restore |
| TS-07 | Advisory and print | Toggle the language, press **Share / Copy WhatsApp Advisory**, then **Print** | The advisory switches between English and Hindi, is shared or copied, and the print dialog opens |
| TS-08 | Offline and Gemini | Change inputs without a key; activate a key; purge it | `Advice: Offline`; then `Advice: Gemini <model>`; then offline again. Numbers never wait for advice |
| TS-09 | Live AQI | Change the city, move the slider, press **Use live AQI** | The source line reads live, then manual, then live |
| TS-10 | Clean-air day | Set the AQI to 30 with the Corsi-Rosenthal tab | No sealing or N95 advice; no avoided dose |

---

## Deployment

The repository is a static site, so any static host works. For GitHub Pages: **Settings → Pages → Deploy from a branch → `main`, `/ (root)`**. Vercel, Netlify and Cloudflare Pages work with an empty build command and the repository root as output. CI tests only and does not deploy.

---

## Architecture

```
index.html, sw.js, manifest.webmanifest      Page, offline cache, install manifest
server.js                                    Local static server
agent.md                                     Assistant persona specification
src/css/style.css                            Styles and print layout
src/js/
  config.js              AQI breakpoints, emission factors, cities, personas
  air-quality-engine.js  Time-of-day model and vulnerability weights
  impact-calculator.js   Exposure model, protection policy, per-choice comparison
  offline-advisor.js     On-device routines, hacks, alternatives, advisory
  gemini-service.js      Key store, rate limit, circuit breaker, Gemini cascade, validation
  live-aqi.js            Open-Meteo readings
  state-codec.js         Shareable URL encoding
  cadr-calculator.js     Room clearance and nearest-city distance
  event-bus.js           In-page publish/subscribe
  app.js                 UI controller
test/                    Test suites
docs/                    Design documents and decision records
uml/, drawio/            Diagrams
```

Documentation: [high-level design](docs/02-hld.md), [component design](docs/lld/03-component-design-and-interfaces.md), [prompt design](docs/02-gemini-prompt-engineering.md), [decision records](docs/06-adr/), [diagrams](uml/) and the [requirements specification](SRS.md). The design documents record the original design; the source code is authoritative.

---

## Contributing

Keep all work on the `main` branch (a challenge rule), keep the repository under 10 MB, never commit an API key, and run `npm run verify` before pushing. Release notes are in the [changelog](CHANGELOG.md).

## License

`package.json` declares MIT. The repository does not yet include a `LICENSE` file.
