# Software Requirements Specification (SRS)
## CleanAir Guardian — GenAI Winter Smog & Urban Pollution Assistant

**Document Identifier:** SRS-PW-CHALLENGE-6-V1.0  
**Standard:** IEEE 29148-2018 Standard for Software Requirements Engineering  
**Version:** 1.0.0  
**Target Platform:** Google Gemini 3.8 Flash / Google Antigravity Ecosystem  

---

## 1. Purpose
The purpose of this document is to specify the authoritative software and behavioral requirements for **CleanAir Guardian**, an autonomous GenAI-powered assistant designed for families and communities navigating severe winter smog and urban air pollution. This system satisfies all constraints and expectations set forth in **Prompt War Challenge No. 6**.

---

## 2. Scope
CleanAir Guardian ingests real-time localized environmental data (AQI, PM2.5, PM10) alongside household lifestyle variables (vulnerable family members, cooking and heating systems, commute modes). It applies meteorological diurnal inversion modeling and Google Gemini 3.8 Flash generative reasoning to produce:
1. Optimized, timestamped low-emission daily routines avoiding peak pollution exposure.
2. Low-cost and zero-cost practical indoor air quality (IAQ) hacks.
3. Sustainable community-level alternatives.
4. Mathematical direct impact quantification (micrograms of PM2.5 inhalation avoided, carbon emissions reduced, and community protection scores).

---

## 3. Requirements

### 3.1 Functional Requirements
- **FR-01 (Context Ingestion):** The system must accept structured user context containing location, current outdoor air quality metrics, household vulnerability profiles (infants, seniors, asthmatics), domestic heating/cooking sources, and daily commute modes.
- **FR-02 (Diurnal Inversion Modeling):** The assistant must apply diurnal atmospheric inversion rules, identifying morning (06:00-09:30) and evening (18:00-22:00) peak ground-trapping hazard windows, while identifying the mid-day thermal convective dispersion window (12:30-15:30).
- **FR-03 (Routine Rescheduling):** The assistant must generate hour-by-hour routine adjustments shifting high-ventilation and outdoor activities away from hazardous inversion windows.
- **FR-04 (Indoor Air Quality Hacks):** The system must prescribe verified, cost-effective IAQ hacks including the DIY Corsi-Rosenthal box, wet-mopping protocols, humidity modulation, and bio-filtration greenery.
- **FR-05 (Direct Impact Engine):** The system must calculate and output quantifiable impact metrics:
  - Estimated PM2.5 inhaled dose avoided ($\mu g$) using standard human minute ventilation rates.
  - Cigarette equivalent exposure avoided.
  - Household carbon emissions avoided ($kg\text{ CO}_2e$).
- **FR-06 (Community Bulletin Generation):** The assistant must generate copyable, action-oriented advisories suitable for distribution in school groups, apartment associations, and community message boards.

### 3.2 Non-Functional Requirements
- **NFR-01 (Repository Size Limit):** The entire repository footprint must remain strictly below 10 MB, verified by Git tracking.
- **NFR-02 (Branch Invariance):** The repository must maintain exactly one single branch (`main`). No auxiliary branches are permitted.
- **NFR-03 (Security & Zero Key Exposure):** System configuration must ensure zero hardcoded secrets or API tokens in tracked files.
- **NFR-04 (Scientific Accuracy):** Recommendations must adhere to World Health Organization (WHO) and EPA air quality guidelines, completely avoiding dangerous folklore or unverified home remedies.
- **NFR-05 (Tone & Communication):** The assistant must communicate with an empathetic, reassuring, and action-oriented tone without inducing fatalistic anxiety.

---

## 4. Acceptance Criteria
1. The repository is publicly accessible on GitHub under `piyushmakhija28/prompt-war-challenge-6-clean-air-assistant`.
2. Total repository size is verified to be under 10 MB.
3. Only one single branch exists (`main`).
4. `README.md` explicitly documents the Chosen Vertical, Approach & Logic, How the solution works, and Assumptions made.
5. `agent.md` defines the complete Google Gemini persona, system instruction prompt, and triage matrices.
6. `GEMINI.md` provides complete developer and evaluation execution context.

---

## 5. Out of Scope
- Hardware-level IoT particulate sensor manufacturing or firmware flashing.
- Medical diagnosis or pharmacological prescription (users with acute distress are advised to consult pulmonologists).
- Direct municipal grid or urban traffic infrastructure automation.
