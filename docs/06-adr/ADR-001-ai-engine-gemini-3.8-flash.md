# ADR-001: Selection of Google Gemini 3.8 Flash as Primary AI Engine

## Status
**ACCEPTED**

## Context
Prompt War Challenge No. 6 requires an intelligent, dynamic assistant capable of generating context-tailored clean air routines, indoor hacks, and impact feedback. The assistant runs in a web browser where latency, token efficiency, structured outputs, and operational cost are paramount.

## Decision
We select **Google Gemini 3.8 Flash** (`gemini-3.8-flash`) as the primary generative AI engine, backed by an operational 5-model high-availability cascade prioritizing minimal-latency models:
1. `gemini-3.5-flash-lite` (Ultra-low latency, ~1.7s, thinkingLevel: LOW)
2. `gemini-flash-lite-latest` (Sub-2.5s response, GA Flash-Lite tier)
3. `gemini-3.1-flash-lite` (Reliable alternative, thinkingLevel: LOW)
4. `gemini-3.8-flash` (Primary frontier flagship reasoning)
5. `gemini-flash-latest` (Stable fallback alias)

If an endpoint responds with HTTP 503 (Service Unavailable) or high-demand queue throttling, the system seamlessly transitions to the next available model in the cascade before failing over to the deterministic offline advisor.

## Consequences
### Positive
- **Sub-Second TTFT:** Achieves time-to-first-token in $400 - 800\text{ms}$, essential for responsive web interaction.
- **Native Strict JSON Schema:** Native support for `responseMimeType: "application/json"` guarantees $100\%$ compliance with the structured schema.
- **Cost & Token Efficiency:** Low token costs ($0.075 / 1M input) allow sustainable community deployment.
- **Large Context Window:** 1M token capacity provides ample headroom for rich system instructions and prompt few-shot anchors.

### Negative & Mitigated
- **API Key Requirement:** Solved via the Dual-Engine architecture, providing a zero-key deterministic fallback.
