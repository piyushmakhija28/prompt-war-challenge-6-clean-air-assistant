# ADR-001: Selection of Google Gemini 3.8 Flash as Primary AI Engine

## Status
**ACCEPTED**

## Context
Prompt War Challenge No. 6 requires an intelligent, dynamic assistant capable of generating context-tailored clean air routines, indoor hacks, and impact feedback. The assistant runs in a web browser where latency, token efficiency, structured outputs, and operational cost are paramount.

## Decision
We select **Google Gemini 3.8 Flash** (`gemini-3.8-flash`) as the primary generative AI engine.

## Consequences
### Positive
- **Sub-Second TTFT:** Achieves time-to-first-token in $400 - 800\text{ms}$, essential for responsive web interaction.
- **Native Strict JSON Schema:** Native support for `responseMimeType: "application/json"` guarantees $100\%$ compliance with the structured schema.
- **Cost & Token Efficiency:** Low token costs ($0.075 / 1M input) allow sustainable community deployment.
- **Large Context Window:** 1M token capacity provides ample headroom for rich system instructions and prompt few-shot anchors.

### Negative & Mitigated
- **API Key Requirement:** Solved via the Dual-Engine architecture, providing a zero-key deterministic fallback.
