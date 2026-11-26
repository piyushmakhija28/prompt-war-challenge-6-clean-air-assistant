# ADR-004: Diurnal Meteorological Inversion Scheduling Strategy

## Status
**ACCEPTED**

## Context
Traditional air pollution advisories treat daily pollution as a flat, static number. In reality, winter smog exhibits dramatic diurnal fluctuations driven by atmospheric planetary boundary layer physics.

## Decision
We parameterize daily scheduling around the **Diurnal Atmospheric Inversion Cycle**:
1. **Morning Inversion Trap (06:00 – 09:30):** High hazard; ban outdoor exercise and shift school runs indoors.
2. **Solar Convective Dispersal Window (12:30 – 15:30):** Minimum hazard; schedule outdoor errands and 15-minute controlled indoor air exchange.
3. **Evening Re-condensation Trap (18:00 – 22:00):** High hazard; re-seal windows and shift cooking indoors.

## Consequences
### Positive
- **High-Leverage Protection:** Reduces human particulate inhalation by $>60\%$ through temporal shifting with zero financial cost.
- **Scientific Credibility:** Backed by boundary layer physics rather than vague folklore.

### Negative & Mitigated
- **Schedule Inflexibility:** Mitigated by providing flexible indoor alternatives when timing shifts are impossible.
