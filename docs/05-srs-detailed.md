# Detailed Software Requirements Specification (SRS) & VCRX
## CleanAir Guardian (VayuRakshak) — Authoritative ISO/IEC/IEEE 29148 Standard

**Document Identifier:** SRS-DETAILED-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 1  
**Lead Authors:** `solution-architect` & `business-analyst-agent`  

---

## 1. System Scope & Verification Cross-Reference Index (VCRX)

```
+---------------------------------------------------------------------------------------------------------+
|                                  VERIFICATION CROSS-REFERENCE INDEX (VCRX)                              |
+-------------+-----------------------------+--------------------+-------------------+--------------------+
| Req ID      | Requirement Description     | Verification Method| Design Ref        | Test Case Ref      |
+-------------+-----------------------------+--------------------+-------------------+--------------------+
| **FR-01**   | Context Ingestion & Normal  | Automated Test     | `docs/01-prd.md`  | `TC-CTX-001`, 002  |
| **FR-02**   | Diurnal Inversion Tracking  | Automated Test     | `docs/lld/01`     | `TC-INV-001`, 002  |
| **FR-03**   | Vulnerability Index Math    | Mathematical Proof | `docs/lld/01`     | `TC-VUL-001`, 002  |
| **FR-04**   | Dynamic Routine Rescheduler | Inspection & Test  | `docs/02-hld.md`  | `TC-SCH-001`, 002  |
| **FR-05**   | Corsi-Rosenthal DIY Hack    | Inspection         | `docs/06-adr/006` | `TC-HAK-001`, 002  |
| **FR-06**   | Wet-Mopping IAQ Protocol    | Inspection         | `docs/agent.md`   | `TC-CLN-001`, 002  |
| **FR-07**   | Solar Ventilation Alerts    | Automated Test     | `docs/lld/01`     | `TC-VNT-001`, 002  |
| **FR-08**   | Transit Mode Optimizer      | Automated Test     | `docs/lld/02`     | `TC-TRN-001`, 002  |
| **FR-09**   | PM2.5 Inhaled Dosage Math   | Mathematical Proof | `docs/lld/02`     | `TC-DOS-001`, 002  |
| **FR-10**   | CO2e Emission Savings Math  | Mathematical Proof | `docs/lld/02`     | `TC-CRB-001`, 002  |
| **FR-11**   | Community Advisory Bulletin | Automated Test     | `docs/03-api`     | `TC-COM-001`       |
| **FR-12**   | Stateless URL Hash Codec    | Automated Test     | `docs/03-api`     | `TC-URL-001`, 002  |
| **NFR-01**  | Sub-second Latency SLA      | Performance Test   | `docs/02-hld.md`  | `TC-PRF-001`       |
| **NFR-02**  | Zero PII & Client Privacy   | Security Audit     | `docs/security/01`| `TC-SEC-001`       |
| **NFR-03**  | WCAG 2.1 AA Accessibility   | Accessibility Audit| `docs/ui-ux/02`   | `TC-A11Y-001`      |
| **NFR-04**  | Repository Size < 10 MB     | Size Audit (Git)   | `docs/04-research`| `TC-GOV-001`       |
| **NFR-05**  | Single Branch Invariant     | Git Branch Audit   | `docs/04-research`| `TC-GOV-002`       |
+-------------+-----------------------------+--------------------+-------------------+--------------------+
```

---

## 2. Functional Requirement Deconstructions

### FR-09: Particulate Inhalation Dosage Avoidance Calculation
- **Pre-Conditions:** User has selected or inputted valid numeric AQI ($0 \le \text{AQI} \le 500+$) and at least one vulnerability status.
- **Trigger:** Form submission or dynamic slider adjustment.
- **Processing Logic:**
  1. Calculate indoor protected baseline concentration:
     $$C_{\text{indoor}} = C_{\text{outdoor}} \times \text{InfiltrationRatio} \times (1 - \text{PurificationEfficiency})$$
  2. Compute minute ventilation rate $V_E$ using vulnerability profile ($0.30\text{ m}^3/\text{h}$ for child, $0.45\text{ m}^3/\text{h}$ for resting adult, $1.20\text{ m}^3/\text{h}$ for exercise).
  3. Integrate over exposure hours avoided:
     $$\Delta \text{Dosage} = (C_{\text{outdoor}} - C_{\text{indoor}}) \times V_E \times t \times 0.28$$
- **Post-Conditions:** Display formatted micrograms ($\mu\text{g}$) and equivalent cigarettes avoided.
- **Invariants:** $\Delta \text{Dosage} \ge 0$; non-negative dosage values strictly enforced.

### FR-12: Stateless URL Hash State Codec
- **Pre-Conditions:** Application state contains valid `UserContext`.
- **Trigger:** Any context change or "Share Plan" button click.
- **Processing Logic:**
  1. Serialize parameters to delimited string format `city|aqi|vuln_flags|cook|heat|commute`.
  2. Apply Base64URL encoding without padding characters.
  3. Replace browser hash fragment via `window.history.replaceState`.
- **Post-Conditions:** Shareable URL generated under 128 bytes total length.
- **Invariants:** Codec round-trip property holds: $\text{Decode}(\text{Encode}(\text{ctx})) \equiv \text{ctx}$.

---

## 3. Non-Functional Constraint Auditing Standards

1. **Deterministic Fallback Consistency:** In offline mode, mathematical outputs must match online calculations to within $\pm 0.1\%$ numerical precision.
2. **Zero Build Step Verification:** The application must execute natively in Chromium $\ge 90$, Firefox $\ge 88$, and Safari $\ge 14$ by opening `index.html` directly from disk or HTTP server with zero transpilation or bundling.
3. **Fail-Safe Degradation:** If network request to Google Gemini times out after $8,000\text{ms}$ or returns HTTP $429/500$, the application seamlessly renders the deterministic offline recommendation with an ambient indicator banner ("Operating in High-Performance Offline Mode").
