# Software Requirements Specification (SRS)
## CleanAir Guardian (VayuRakshak) — GenAI Winter Smog & Urban Pollution Assistant

**Document Identifier:** SRS-PW-CHALLENGE-6-V1.0  
**Standard:** IEEE 29148-2018 Standard for Software Requirements Engineering  
**Version:** 1.1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Target Platform:** Google Gemini 3.8 Flash / Pure Web Runtime  

---

## 1. Purpose
The purpose of this document is to specify the authoritative software and behavioral requirements for **CleanAir Guardian**, an autonomous GenAI-powered assistant designed for families and communities navigating severe winter smog and urban air pollution. This system satisfies all constraints and expectations set forth in **Prompt War Challenge No. 6**.

---

## 2. Scope
CleanAir Guardian ingests real-time localized environmental data (AQI, PM2.5, PM10) alongside household lifestyle variables (vulnerable family members, cooking and heating systems, commute modes). It applies meteorological diurnal inversion modeling and Google Gemini 3.8 Flash generative reasoning to produce:
1. Optimized, timestamped low-emission daily routines avoiding peak pollution exposure.
2. Low-cost and zero-cost practical indoor air quality (IAQ) hacks (DIY Corsi-Rosenthal boxes, wet mopping protocols).
3. Sustainable community-level transit and heating alternatives.
4. Mathematical direct impact quantification (micrograms of PM2.5 inhalation avoided, carbon emissions reduced, and community protection scores).

---

## 3. Requirements Overview & Deep Architecture Cross-References

### 3.1 Functional Requirements (FR-01 to FR-12)
- **FR-01 (Context Ingestion & Normalization):** Accepted and validated context parameters. *Details in [docs/01-prd.md](file:///docs/01-prd.md#fr-01-context-ingestion--normalization).*
- **FR-02 (Diurnal Inversion Tracking):** Computes atmospheric boundary layer height and peak hazard hours. *Details in [docs/lld/01-meteorological-inversion-engine.md](file:///docs/lld/01-meteorological-inversion-engine.md).*
- **FR-03 (Vulnerability Index Math):** Computes $K_{\text{vuln}}$ biological susceptibility factor. *Details in [docs/lld/01-meteorological-inversion-engine.md](file:///docs/lld/01-meteorological-inversion-engine.md).*
- **FR-04 (Dynamic Routine Rescheduling):** Generates hour-by-hour schedules avoiding peak morning/evening traps. *Details in [docs/01-prd.md](file:///docs/01-prd.md#fr-04-dynamic-routine-rescheduling-engine).*
- **FR-05 (Corsi-Rosenthal DIY Hack):** Delivers verified CADR $\ge 270\text{ CFM}$ filter build plans. *Details in [ADR-006](file:///docs/06-adr/ADR-006-diy-iaq-corsi-rosenthal-hack.md).*
- **FR-06 (Wet-Mopping IAQ Protocol):** Prescribes damp microfiber cleaning and bans dry sweeping. *Details in [agent.md](file:///agent.md) and [docs/01-prd.md](file:///docs/01-prd.md#fr-06-indoor-air-quality-iaq-and-wet-mopping-protocol).*
- **FR-07 (Solar Ventilation Alerts):** Identifies 12:30–15:30 safe convective aeration window. *Details in [docs/lld/01-meteorological-inversion-engine.md](file:///docs/lld/01-meteorological-inversion-engine.md).*
- **FR-08 (Sustainable Commute Optimizer):** Prescribes transit alternatives and carpool clusters. *Details in [docs/lld/02-direct-impact-mathematical-spec.md](file:///docs/lld/02-direct-impact-mathematical-spec.md).*
- **FR-09 (PM2.5 Inhaled Dosage Calculus):** Computes micrograms and cigarette equivalents avoided. *Details in [docs/lld/02-direct-impact-mathematical-spec.md](file:///docs/lld/02-direct-impact-mathematical-spec.md).*
- **FR-10 (Carbon Emissions Avoidance):** Calculates kilograms of $CO_2e$ prevented. *Details in [docs/lld/02-direct-impact-mathematical-spec.md](file:///docs/lld/02-direct-impact-mathematical-spec.md).*
- **FR-11 (Community Bulletin Generator):** Generates one-click WhatsApp/RWA advisories. *Details in [docs/03-api-contract.md](file:///docs/03-api-contract.md).*
- **FR-12 (Stateless URL Hash Codec):** Encodes context into `#v1=...` string under 128 bytes. *Details in [ADR-007](file:///docs/06-adr/ADR-007-state-management-and-url-serialization.md).*

### 3.2 Non-Functional Requirements (NFR-01 to NFR-10)
- **NFR-01 (Latency):** Sub-15ms offline execution; sub-1.8s Gemini Flash latency. *Details in [docs/02-hld.md](file:///docs/02-hld.md).*
- **NFR-02 (Privacy):** Zero PII retention; ephemeral in-memory API key lifecycle. *Details in [docs/security/01-threat-model-and-safety.md](file:///docs/security/01-threat-model-and-safety.md).*
- **NFR-03 (Accessibility):** WCAG 2.1 Level AA conformance; APCA contrast $\ge 4.5:1$. *Details in [docs/ui-ux/02-accessibility-and-a11y-matrix.md](file:///docs/ui-ux/02-accessibility-and-a11y-matrix.md).*
- **NFR-04 (Repository Size):** Total repo footprint $< 10\text{ MB}$ (actual $< 2.0\text{ MB}$). *Details in [docs/04-competition-and-platform-research.md](file:///docs/04-competition-and-platform-research.md).*
- **NFR-05 (Single Branch):** Exactly ONE branch (`main`). *Details in [ADR-010](file:///docs/06-adr/ADR-010-repo-size-and-single-branch-hygiene.md).*
- **NFR-06 (Zero Build Step):** Pure modular web app (HTML5/CSS3/ES6+). *Details in [ADR-003](file:///docs/06-adr/ADR-003-static-client-side-runtime.md).*
- **NFR-07 (Dual-Engine Fallback):** 100% feature parity in Offline Mode. *Details in [ADR-002](file:///docs/06-adr/ADR-002-dual-engine-fallback-strategy.md).*
- **NFR-08 (Ergonomics):** Responsive across mobile, tablet, and desktop. *Details in [docs/ui-ux/01-design-system-and-tokens.md](file:///docs/ui-ux/01-design-system-and-tokens.md).*
- **NFR-09 (Determinism):** Calculations produce mathematically identical results given identical inputs. *Details in [docs/lld/02-direct-impact-mathematical-spec.md](file:///docs/lld/02-direct-impact-mathematical-spec.md).*
- **NFR-10 (High-Contrast Themes):** Legible under outdoor smog haze. *Details in [docs/ui-ux/01-design-system-and-tokens.md](file:///docs/ui-ux/01-design-system-and-tokens.md).*

---

## 4. Authoritative Specifications & Architecture Suite Links

For the exhaustive engineering specifications, reference the authoritative documentation suite:
- [Detailed SRS & Verification Index (VCRX)](file:///docs/05-srs-detailed.md)
- [Gemini 3.8 Flash Prompt Engineering Specification](file:///docs/02-gemini-prompt-engineering.md)
- [Data Structures & Computational Complexity (LLD-04)](file:///docs/lld/04-data-structures-and-algorithms.md)
- [State Management, Event Loop & Memory Model (LLD-05)](file:///docs/lld/05-state-management-and-event-loop.md)
- [Error Handling, Algebraic Types & Branded Primitives (LLD-06)](file:///docs/lld/06-error-handling-and-algebraic-types.md)
- [Component Design & Module Interfaces (LLD-03)](file:///docs/lld/03-component-design-and-interfaces.md)
- [High-Level Design & C4 Models](file:///docs/02-hld.md)
- [API Contracts & JSON Schemas](file:///docs/03-api-contract.md)
- [The 10 Architectural Decision Records (ADRs)](file:///docs/06-adr/)
- [Meteorological Inversion Engine (LLD)](file:///docs/lld/01-meteorological-inversion-engine.md)
- [Direct Impact Mathematical Specification (LLD)](file:///docs/lld/02-direct-impact-mathematical-spec.md)
- [Modular Component Interfaces (LLD)](file:///docs/lld/03-component-design-and-interfaces.md)
- [Accessibility Matrix & WCAG 2.1 AA Audit](file:///docs/ui-ux/02-accessibility-and-a11y-matrix.md)
- [STRIDE Threat Model & Security Architecture](file:///docs/security/01-threat-model-and-safety.md)
- [Resilience & Circuit Breaker Architecture](file:///docs/resilience/01-offline-degradation-and-fallback.md)
- [Triad Testing Strategy & Test Catalog](file:///docs/testing/01-triad-test-strategy.md)
- [Rubric Compliance & Scorecard Matrix](file:///docs/08-rubric-compliance-matrix.md)
- [Canonical Mermaid UML Diagrams Suite](file:///uml/)
