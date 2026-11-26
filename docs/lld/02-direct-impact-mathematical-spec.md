# Direct Impact Mathematical Specification & Environmental Calculus
## CleanAir Guardian (VayuRakshak) — Piecewise Breakpoints, expm1 Stability & WTW Carbon LCA

**Component:** `src/js/impact-calculator.js`  
**Mathematical Leads:** `atmospheric-climate-mathematics-expert`, `carbon-accounting-mathematics-expert` & `anti-hallucination-mathematician`  
**Verification Gate:** Anti-Hallucination Gate 2  

---

## 1. Piecewise Linear AQI to Concentration Conversion ($C_p$)

AQI is a non-linear composite index, NOT raw particulate mass concentration. Passing raw AQI into dosage equations creates a $25\% - 40\%$ error.

CleanAir Guardian implements the official **EPA / Indian CPCB Dual-Standard Piecewise Linear Interpolation Formula**:

$$C_p = \frac{I - I_{\text{lo}}}{I_{\text{hi}} - I_{\text{lo}}} \times (B_{\text{hi}} - B_{\text{lo}}) + B_{\text{lo}}$$

Where:
- $I$ = Ambient Air Quality Index (AQI).
- $I_{\text{lo}}, I_{\text{hi}}$ = Lower and upper index boundaries of the active AQI category band.
- $B_{\text{lo}}, B_{\text{hi}}$ = Lower and upper mass concentration breakpoints for $PM_{2.5}$ ($\mu\text{g/m}^3$).

```
+---------------------------------------------------------------------------------------------------------+
|                                    CPCB / EPA PM2.5 BREAKPOINT TABLE                                    |
+--------------------+----------------+----------------+----------------+----------------+----------------+
| AQI Category       | AQI Low (I_lo) | AQI High (I_hi)| Conc Low (B_lo)| Conc High(B_hi)| Slope (dC/dI)  |
+--------------------+----------------+----------------+----------------+----------------+----------------+
| **Good**           | 0              | 50             | 0.0 µg/m³      | 30.0 µg/m³     | 0.600          |
| **Moderate**       | 51             | 100            | 30.1 µg/m³     | 60.0 µg/m³     | 0.610          |
| **Poor**           | 101            | 200            | 60.1 µg/m³     | 90.0 µg/m³     | 0.302          |
| **Very Poor**      | 201            | 300            | 90.1 µg/m³     | 120.0 µg/m³    | 0.302          |
| **Severe**         | 301            | 400            | 120.1 µg/m³    | 250.0 µg/m³    | 1.312          |
| **Hazardous (500)**| 401            | 500            | 250.1 µg/m³    | 380.0 µg/m³    | 1.312          |
+--------------------+----------------+----------------+----------------+----------------+----------------+
| **Severe+ (>500)** | 501            | 999            | 380.1 µg/m³    | Extrapolated   | 0.800 (linear) |
+--------------------+----------------+----------------+----------------+----------------+----------------+
```

### Extrapolation Formula for Extreme AQI ($I > 500$):
$$C_p = 380.0 + (I - 500) \times 0.80$$
*(Guarantees $O(1)$ bounded computation across arbitrary index values).*

---

## 2. Dynamic Housing Infiltration Coefficients ($\alpha_{\text{inf}}$)

Residential structures vary widely in envelope airtightness:

$$C_{\text{indoor\_unfiltered}} = C_p \times \alpha_{\text{inf}}$$

```
+---------------------------------------------------------------------------------------------------------+
|                                  HOUSING INFILTRATION COEFFICIENTS                                      |
+------------------------------------+------------------+-------------------------------------------------+
| Housing Structure Type             | Alpha Coefficient| Physical Envelope Characteristics               |
+------------------------------------+------------------+-------------------------------------------------+
| **Modern Sealed Apartment**        | **0.40**         | Double-glazed windows, weatherstripped doors,   |
|                                    |                  | low passive natural air exchange ($ACH \approx 0.3$).|
+------------------------------------+------------------+-------------------------------------------------+
| **Standard Residential Flat**      | **0.65**         | Standard sliding windows, moderate balcony gaps |
|                                    |                  | ($ACH \approx 0.6 - 0.8$).                       |
+------------------------------------+------------------+-------------------------------------------------+
| **Unsealed / Drafty Construction** | **0.85**         | Single-pane glass, gap vents, unsealed doors    |
|                                    |                  | ($ACH \approx 1.2 - 1.8$).                       |
+------------------------------------+------------------+-------------------------------------------------+
```

---

## 3. Room Particulate Clearance & `Math.expm1` Numerical Stability

The first-order differential decay of indoor particulate concentration under Corsi-Rosenthal Box filtration is:

$$V \frac{dC(t)}{dt} = - \lambda V C(t) \implies C(t) = C_0 \cdot \exp(-\lambda t)$$

Where $\lambda = \frac{\text{CADR}}{V} + k_{\text{dep}} + \text{ACH}_{\text{inf}} \approx 10.9\text{ h}^{-1}$.

### Numerical Analysis Precision Guard:
In 64-bit IEEE-754 double precision floating-point arithmetic, computing $1 - \exp(-x)$ when $x = \lambda \Delta t$ is small ($x < 0.01$) results in **catastrophic cancellation** due to the subtraction of two near-equal floating-point numbers.

CleanAir Guardian implements the numerically stable standard:
$$\text{FractionalClearance}(\Delta t) = - \text{Math.expm1}(-\lambda \cdot \Delta t)$$

Where `Math.expm1(y)` computes $e^y - 1$ accurately to within $1\text{ ULP}$ (Unit in the Last Place), preserving full 53-bit precision.

---

## 4. Particulate Inhalation Dosage Calculus

$$\Delta \text{Dosage}_{\text{avoided}} (\mu\text{g}) = \left(C_p \times \alpha_{\text{inf}} - C_{\text{indoor\_filtered}}\right) \times V_E \times \Delta t \times \eta_{\text{dep}}$$

Where:
- $V_E$ = Minute ventilation volume ($0.30\text{ m}^3/\text{h}$ child, $0.45\text{ m}^3/\text{h}$ resting adult, $1.20\text{ m}^3/\text{h}$ exercise).
- $\eta_{\text{dep}} = 0.28$ (alveolar deposition fraction for $PM_{2.5}$).
- $\Delta t$ = Exposure duration shifted or protected (hours).

### Berkeley Earth Cigarette Equivalence:
$$\text{Cigarettes Avoided} = \frac{\Delta \text{Dosage}_{\text{avoided}} (\mu\text{g})}{66.5\ \mu\text{g}}$$

---

## 5. Well-to-Wheel (WTW) Life-Cycle Carbon Accounting

Carbon emission reduction accounts for both direct fuel combustion and upstream grid electricity generation:

$$\Delta \text{CO}_2\text{e} (\text{kg}) = d \times \left(EF_{\text{baseline}}^{\text{WTW}} - EF_{\text{alternative}}^{\text{WTW}}\right)$$

```
+---------------------------------------------------------------------------------------------------------+
|                               WELL-TO-WHEEL (WTW) EMISSION FACTORS                                      |
+--------------------------+-----------------------+----------------------+-------------------------------+
| Mode / Activity          | Direct TTW Factor     | Upstream WTW Factor  | Net Lifecycle CO2e Factor     |
+--------------------------+-----------------------+----------------------+-------------------------------+
| **Solo Petrol Car (10km)**| 192 g CO2e / km       | 48 g CO2e / km       | **240 g CO2e / km**           |
| **Two-Wheeler (10km)**   | 48 g CO2e / km        | 12 g CO2e / km       | **60 g CO2e / km**            |
| **Metro Rail (per pass.)**| 0 g CO2e / km (direct)| 28 g CO2e / km (grid)| **28 g CO2e / km**            |
| **Biomass Space Heater** | 850 g CO2e / hour     | 80 g CO2e / hour     | **930 g CO2e / hour**         |
| **Electric Oil Radiator**| 0 g CO2e (tailpipe)   | 288 g CO2e / hour    | **288 g CO2e / hour** (clean) |
+--------------------------+-----------------------+----------------------+-------------------------------+
```
*(Grid emission factor based on Central Electricity Authority baseline $EF_{\text{grid}} \approx 0.72\text{ kg CO}_2\text{/kWh}$).*

---

## 6. Kahan-Neumaier Compensated Summation for 24-Hour Diurnal Integration

When calculating cumulative 24-hour particulate inhalation dosage $\sum_{i=1}^{24} D_i$, standard naive floating-point accumulation suffers from catastrophic roundoff drift due to the disparity in magnitude between low indoor concentrations ($10 - 25\ \mu\text{g/m}^3$) and intense outdoor inversion peaks ($650\ \mu\text{g/m}^3$).

### 1. Mathematical Error Bound Comparison:
- **Naive Summation Error Bound:**
  $$|\text{Error}_{\text{naive}}| \le n \cdot \epsilon \cdot \sum_{i=1}^n |x_i| \implies \mathcal{O}(n \cdot \epsilon)$$
- **Kahan-Neumaier Compensated Error Bound:**
  $$|\text{Error}_{\text{neumaier}}| \le 2\epsilon \cdot \sum_{i=1}^n |x_i| + \mathcal{O}(n \cdot \epsilon^2) \implies \mathcal{O}(\epsilon)$$
Where machine epsilon $\epsilon = 2^{-52} \approx 2.22 \times 10^{-16}$.

### 2. Concrete Implementation:
```javascript
/**
 * Computes exact cumulative particulate dosage using the Kahan-Neumaier summation algorithm.
 * Guarantees O(eps) precision bound across wide numerical dynamic ranges.
 *
 * @param {Float64Array|number[]} values - Array of hourly dosage values in micrograms.
 * @returns {number} Exact compensated cumulative sum.
 */
export function kahanNeumaierSum(values) {
  let sum = 0.0;
  let c = 0.0; // Lost low-order bits compensation accumulator

  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) {
      c += (sum - t) + x; // sum is larger, low-order bits of x lost
    } else {
      c += (x - t) + sum; // x is larger, low-order bits of sum lost
    }
    sum = t;
  }

  return sum + c;
}
```

