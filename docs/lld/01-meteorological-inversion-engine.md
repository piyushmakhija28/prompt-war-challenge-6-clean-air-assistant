# Meteorological Diurnal Inversion Engine Specification (LLD)
## CleanAir Guardian (VayuRakshak) — Low-Level Design & Atmospheric Physics

**Component:** `src/js/air-quality-engine.js`  
**Mathematical Lead:** `atmospheric-climate-mathematics-expert`  
**Verification Gate:** Anti-Hallucination Gate 0  

---

## 1. Atmospheric Boundary Layer (ABL) Physics & Inversion Mechanics

### 1.1 The Thermodynamic Mechanism of Winter Smog
During winter over continental land masses (e.g. Indo-Gangetic Basin, Salt Lake Basin), nocturnal longwave radiative cooling ($F_{\text{rad}} \approx \sigma T^4$) drops surface ground temperatures rapidly under clear skies. When wind speeds are calm ($u \le 1.5\text{ m/s}$), vertical mechanical turbulence is insufficient to mix the lower atmosphere.

Under normal conditions:
$$\frac{\partial T}{\partial z} = -\Gamma_d \approx -9.8^\circ\text{C/km}$$
In winter radiation inversions:
$$\frac{\partial T}{\partial z} > 0 \quad \text{for } z \le h_{\text{inv}}$$

The positive temperature gradient creates an impenetrable lid. The Planetary Boundary Layer height ($h_{\text{PBL}}$) collapses from a summer daytime average of $1,500 - 2,500\text{ m}$ down to a shallow winter trap of $80 - 150\text{ m}$.

---

## 2. Diurnal Boundary Layer Height Equation

The time-dependent effective Planetary Boundary Layer height $h_{\text{PBL}}(t)$ is parameterized as:

$$h_{\text{PBL}}(t) = 
\begin{cases} 
h_{\text{min}} & \text{if } t < t_{\text{rise}} \lor t \ge t_{\text{dusk}} \\
h_{\text{min}} + (h_{\text{max}} - h_{\text{min}}) \cdot \sin^2\left(\frac{\pi (t - t_{\text{rise}})}{2 (t_{\text{solar\_noon}} - t_{\text{rise}})}\right) & \text{if } t_{\text{rise}} \le t < t_{\text{solar\_noon}} \\
h_{\text{max}} - (h_{\text{max}} - h_{\text{min}}) \cdot \left(\frac{t - t_{\text{solar\_noon}}}{t_{\text{dusk}} - t_{\text{solar\_noon}}}\right)^2 & \text{if } t_{\text{solar\_noon}} \le t < t_{\text{dusk}}
\end{cases}$$

### Empirical Winter Basin Constants
- $h_{\text{min}} = 90\text{ m}$ (nocturnal/morning inversion height)
- $h_{\text{max}} = 750\text{ m}$ (afternoon convective mixing height)
- $t_{\text{rise}} = 07:00$
- $t_{\text{solar\_noon}} = 12:30$
- $t_{\text{dusk}} = 17:30$

---

## 3. Four-Phase Diurnal Inversion State Machine

```
+----------------------------------------------------------------------------------------------------+
|                                DIURNAL INVERSION STATE MACHINE                                     |
+-------------------+---------------+--------------------+-------------------------------------------+
| State Identifier  | Time Interval | Ground PM2.5 Multi | Operational Protective Protocol           |
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 1:**      | 06:00 - 09:30 | **1.85x - 2.50x**  | **CRITICAL HAZARD:** Shift outdoor runs/  |
| *Morning Trap*    |               | (Peak Spike)       | walks indoors; keep school buses sealed;  |
|                   |               |                    | run Corsi-Rosenthal box continuously.     |
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 2:**      | 09:30 - 12:30 | 1.20x - 1.50x      | **TRANSITION:** Commutes finish; kitchen   |
| *Pre-Dispersal*   |               |                    | exhaust fans sealed; indoor air clean.    |
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 3:**      | 12:30 - 15:30 | **0.45x - 0.60x**  | **SOLAR DISPERSAL WINDOW:** Controlled    |
| *Convective Vent* |               | (Diurnal Minimum)  | 15-min cross-ventilation; essential outdoor|
|                   |               |                    | chores; infant short sun exposure.        |
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 4:**      | 15:30 - 18:00 | 1.10x - 1.35x      | **PRE-CONDENSATION:** Windows re-sealed;  |
| *Afternoon Shift* |               |                    | air purifiers pre-conditioned.            |
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 5:**      | 18:00 - 22:00 | **1.70x - 2.20x**  | **EVENING TRAP:** Traffic exhaust trapped;|
| *Evening Peak*    |               | (Traffic Peak)     | zero outdoor recreation; induction cooking|
+-------------------+---------------+--------------------+-------------------------------------------+
| **STATE 6:**      | 22:00 - 06:00 | 1.30x - 1.60x      | **NOCTURNAL DORMANT:** Bedroom sealing;   |
| *Night Inversion* |               |                    | Snake plant oxygenation; low fan speed.   |
+-------------------+---------------+--------------------+-------------------------------------------+
```

---

## 4. Vulnerability Multiplier Derivation ($K_{\text{vuln}}$)

Individual human susceptibility is parameterized through physiological minute ventilation $V_E$ ($\text{m}^3/\text{h}$), baseline forced expiratory volume in one second ($FEV_1$), and immunosenescence:

$$K_{\text{vuln}} = 1.0 + \sum_{m \in \text{Vulnerabilities}} w_m$$

```
+----------------------------------------------------------------------------------------------------+
|                                  VULNERABILITY WEIGHTING VALUES                                    |
+-----------------------+----------+-----------------------------------------------------------------+
| Vulnerability Group   | Weight   | Physiological & Epidemiological Rationale                       |
+-----------------------+----------+-----------------------------------------------------------------+
| **Infant (<2 years)** | **0.45** | $V_E/\text{body weight}$ is 2.5x higher than adults; immature   |
|                       |          | alveolar blood-gas barrier; lifelong pulmonary remodeling risk. |
+-----------------------+----------+-----------------------------------------------------------------+
| **Asthma / COPD**     | **0.80** | Chronic baseline airway inflammation; hyperreactive bronchospasm|
|                       |          | triggered at threshold $PM_{2.5} > 75\ \mu\text{g/m}^3$.        |
+-----------------------+----------+-----------------------------------------------------------------+
| **Senior (>65 years)**| **0.35** | Reduced mucociliary clearance; cardiovascular systemic plaque   |
|                       |          | rupture risk under fine particulate translocation.             |
+-----------------------+----------+-----------------------------------------------------------------+
| **Pregnant Women**    | **0.40** | Placental translocation of ultrafine particles; maternal blood  |
|                       |          | hypercoagulability and pre-term birth risk.                     |
+-----------------------+----------+-----------------------------------------------------------------+
| **Outdoor Worker**    | **0.30** | Sustained high ventilation exposure ($V_E \approx 1.2\text{ m}^3/\text{h}$) |
|                       |          | for 8 to 10 hours continuously without structural protection.  |
+-----------------------+----------+-----------------------------------------------------------------+
```

---

## 5. Algorithmic Implementation (`air-quality-engine.js`)

```javascript
/**
 * Computes diurnal atmospheric state and vulnerability-weighted triage.
 * @module air-quality-engine
 */

/**
 * Calculates current diurnal atmospheric state based on local hour.
 * @param {number} hour24 - Hour of day in 24h format (0 - 23.99).
 * @returns {Object} Atmospheric status, relative factor, and recommendation.
 */
export function getDiurnalInversionState(hour24) {
  if (hour24 >= 6.0 && hour24 < 9.5) {
    return {
      state: "MORNING_TRAP",
      factor: 2.15,
      isHazardPeak: true,
      ventilationAllowed: false,
      label: "Morning Inversion Trap (Peak Hazard)"
    };
  } else if (hour24 >= 12.5 && hour24 < 15.5) {
    return {
      state: "SOLAR_DISPERSAL",
      factor: 0.52,
      isHazardPeak: false,
      ventilationAllowed: true,
      label: "Solar Convective Window (Safest Diurnal Window)"
    };
  } else if (hour24 >= 18.0 && hour24 < 22.0) {
    return {
      state: "EVENING_TRAP",
      factor: 1.95,
      isHazardPeak: true,
      ventilationAllowed: false,
      label: "Evening Re-Condensation Peak"
    };
  } else {
    return {
      state: "BASELINE_DORMANT",
      factor: 1.35,
      isHazardPeak: false,
      ventilationAllowed: false,
      label: "Baseline Atmospheric Stagnation"
    };
  }
}

/**
 * Computes composite vulnerability score.
 * @param {string[]} vulnerabilities - Array of selected vulnerability keys.
 * @returns {number} Multiplier K_vuln (>= 1.0).
 */
export function calculateVulnerabilityMultiplier(vulnerabilities) {
  const WEIGHT_MAP = {
    infant: 0.45,
    asthma: 0.80,
    senior: 0.35,
    pregnant: 0.40,
    outdoor: 0.30
  };

  return vulnerabilities.reduce((acc, v) => acc + (WEIGHT_MAP[v] || 0.0), 1.0);
}
```
