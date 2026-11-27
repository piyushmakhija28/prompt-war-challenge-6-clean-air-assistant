# ADR-002: Dual-Engine Resilience (Live GenAI + Offline Rule Advisor)

## Status
**ACCEPTED**

## Context
In competitive evaluations and real-world urban crises, users may lack an API key, exhaust rate quotas (HTTP 429), or face intermittent mobile network connectivity. Relying purely on an external API would cause fatal application crashes or blank screens.

## Decision
We architect a **Dual-Engine Execution Pipeline**:
1. When a valid Google Gemini API key is present and network is available, invoke the Gemini model cascade (12s per model ceiling).
2. If the API key is omitted, invalid, times out, or returns an error across all models, gracefully failover to the local **Deterministic Offline Rule Advisor**.

## Consequences
### Positive
- **Zero Evaluation Friction:** Competition judges can test $100\%$ of features immediately without entering an API key.
- **Sub-15ms Local Execution:** Instantaneous rendering of comprehensive clean air plans.
- **Mathematical Consistency:** The offline advisor shares the exact same calculation formulas as the online system.

### Negative & Mitigated
- **Dual Maintenance:** Mitigated by sharing identical TypeScript/JSDoc interface contracts and config tables across both engines.
