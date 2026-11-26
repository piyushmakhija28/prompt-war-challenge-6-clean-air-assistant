# ADR-009: In-Memory Ephemeral API Key Lifecycle & Zero-Telemetry Privacy

## Status
**ACCEPTED**

## Context
Users entering their personal Google Gemini API key must be guaranteed that their secret credentials are never exposed, logged, or intercepted.

## Decision
We implement a **Zero-Persistence / Ephemeral In-Memory Key Model**:
1. API keys are stored solely in volatile JavaScript closure memory during the session (optional session storage if user checks "Remember for this session").
2. Zero outbound network transmission of API keys except directly to official Google endpoints (`generativelanguage.googleapis.com`) over TLS 1.3.
3. Zero third-party analytics scripts, tracking beacons, or error reporting telemetry.

## Consequences
### Positive
- **Maximum Security:** Eliminates risk of secret leakage or credential theft.
- **Strict Compliance:** Adheres to enterprise security standards and OWASP Top 10 for LLMs.

### Negative & Mitigated
- **Re-Entry on Hard Refresh:** If not using session storage, user re-enters key; mitigated by the zero-friction offline fallback.
