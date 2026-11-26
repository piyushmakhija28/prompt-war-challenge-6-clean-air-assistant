# ADR-010: Repository Size Limitation (< 10 MB) & Single Branch Governance

## Status
**ACCEPTED**

## Context
Competition Rule 2 strictly mandates that the total repository size must remain strictly under 10 MB. Competition Rule 4 mandates that the repository must contain exactly one branch. Violating either rule leads to immediate evaluation rejection.

## Decision
1. **Size Governance:** Zero node_modules or heavy binary dependencies committed. Strict `.gitignore` rules. Total repository footprint capped at $< 2.0\text{ MB}$.
2. **Branch Governance:** All development and documentation committed strictly to `main`. Zero secondary branches created or pushed.

## Consequences
### Positive
- **100% Competition Compliance:** Eliminates any disqualification risk under Rules 2 and 4.
- **Lightweight Clone Speed:** Entire repo clones in $< 2$ seconds on any network.

### Negative & Mitigated
- **Asset Constraints:** Cannot store uncompressed videos or large raster assets; mitigated by utilizing SVG vector illustrations and pure CSS glassmorphism.
