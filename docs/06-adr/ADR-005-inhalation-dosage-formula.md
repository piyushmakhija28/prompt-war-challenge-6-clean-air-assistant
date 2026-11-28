# ADR-005: Particulate Inhalation Dosage Calculus Based on EPA Standards

> Design record. Parts of this document describe components that were removed or replaced in version 1.3.0, such as the application controller class, the reducer, the time engine, the signals and error modules and the fixed protection efficiency. The source code is authoritative.

## Status
**ACCEPTED**

## Context
Behavioral adoption requires transparent, quantifiable feedback. Simply saying "your choices helped" does not create sustained community motivation.

## Decision
We adopt the **EPA Exposure Factors minute ventilation rate standard ($V_E$)** and the **Berkeley Earth cigarette equivalence model** to compute:
$$\Delta \text{Dosage} = (C_{\text{outdoor}} - C_{\text{indoor}}) \times V_E \times t \times \eta_{\text{dep}}$$
$$\text{Cigarettes Avoided} = \frac{\Delta \text{Dosage}}{66.5\ \mu\text{g}}$$

## Consequences
### Positive
- **Tangible Metric:** Converts abstract micrograms into human-understandable metrics (e.g. "Prevented 5.4 cigarettes of smog from your child's lungs today").
- **Physiological Accuracy:** Differentiates breathing volumes between resting adults ($0.45\text{ m}^3/\text{h}$), exercisers ($1.20\text{ m}^3/\text{h}$), and infants ($0.30\text{ m}^3/\text{h}$).

### Negative & Mitigated
- **Approximation Variance:** Mitigated by documenting exact EPA and Berkeley Earth assumptions in the methodology disclosure.
