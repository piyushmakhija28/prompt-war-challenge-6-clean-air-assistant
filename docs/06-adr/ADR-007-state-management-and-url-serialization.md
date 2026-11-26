# ADR-007: Stateless URL Hash State Codec (#v1=...) for Instant Sharing

## Status
**ACCEPTED**

## Context
Families, schools, and apartment associations want to share customized clean air plans and local AQI contexts over WhatsApp and community groups. Requiring user registration or a backend database adds latency, maintenance overhead, and privacy risks.

## Decision
We implement a **Stateless URL Hash State Codec (`#v1=...`)** using compact delimited string serialization and Base64URL encoding.

## Consequences
### Positive
- **Zero Database / Zero Backend:** 100% serverless, zero personal data stored anywhere.
- **Instant Community Sharing:** Clicking a shared link instantly hydrates the entire plan on any recipient's device.
- **Tiny Footprint:** Encoded hash string is under 128 bytes, well within URL length limits for messaging apps.

### Negative & Mitigated
- **Hash State Visibility:** State is visible in the URL; mitigated by containing zero sensitive PII (only city, AQI, and generic flags).
