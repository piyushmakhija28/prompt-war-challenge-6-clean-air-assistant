# Prompt War Challenge No. 6: Rubric Traceability Matrix
## CleanAir Guardian (VayuRakshak)

This matrix points each evaluation area to evidence in the repository. It assigns no scores; that is the evaluators' job.

## 1. Evidence by Area

| Area | Expectation | Evidence | Not covered |
|---|---|---|---|
| Problem statement alignment | Routines, indoor air hacks, sustainable alternatives, location and lifestyle, impact of choices | `src/js/impact-calculator.js`, `src/js/offline-advisor.js`, `src/js/gemini-service.js`, `index.html` | The exposure model is an unvalidated planning estimate |
| Code quality | Modular, maintainable code with documented contracts | `src/js/`, `docs/lld/03-component-design-and-interfaces.md` | `src/js/app.js` is a large UI controller |
| Security and privacy | Responsible GenAI use and key handling | `src/js/gemini-service.js`, CSP in `index.html`, `docs/security/01-threat-model-and-safety.md` | No external security review |
| Efficiency | Small footprint, no runtime dependencies, debounced requests | `package.json`, `.github/workflows/ci.yml` (size gate) | No load or latency benchmark |
| Testing | Unit, integration, fuzz, browser and end-to-end suites | `test/`, CI workflow | Chromium only |
| Accessibility | Keyboard use, ARIA announcements | `test/e2e/accessibility.spec.js` | Colour contrast and real screen readers unverified |
| Usability | Personas, live air quality, shareable advisory, offline use | `index.html`, `src/css/style.css`, `sw.js` | Printed output unverified |

## 2. Mandatory Rules Checklist

| Rule | How it is checked |
|---|---|
| Public repository | GitHub repository visibility |
| One branch (`main`) | `git ls-remote --heads origin` |
| Repository smaller than 10 MB | CI size gate |
| README states vertical, approach and logic, how it works, assumptions | `README.md` |
