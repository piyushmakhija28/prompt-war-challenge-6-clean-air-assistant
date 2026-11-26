# Direct Impact Mathematical Specification & Environmental Calculus
## CleanAir Guardian (VayuRakshak) — Low-Level Design & Mathematical Proofs

**Component:** `src/js/impact-calculator.js`  
**Mathematical Leads:** `atmospheric-climate-mathematics-expert` & `carbon-accounting-mathematics-expert`  
**Verification Gate:** Anti-Hallucination Gate 0  

---

## 1. Particulate Inhalation Dosage Calculus

### 1.1 First-Principles Human Respiratory Model
The mass of toxic particulate matter deposited in the human respiratory tract over an exposure duration $\Delta t$ is modeled as a function of environmental concentration, human minute ventilation volume, and alveolar deposition fraction:

$$\text{Mass}_{\text{inhaled}} (\mu\text{g}) = \int_{0}^{\Delta t} C_{\text{air}}(t) \cdot V_E(t) \cdot \eta_{\text{dep}} \, dt$$

Under piecewise constant conditions over discrete intervals:

$$\Delta \text{Dosage}_{\text{avoided}} = \left(C_{\text{outdoor}} - C_{\text{indoor}}\right) \times V_E \times \Delta t \times \eta_{\text{dep}}$$

Where:
- $C_{\text{outdoor}}$ = Outdoor particulate concentration ($\mu\text{g/m}^3$), derived from AQI.
- $C_{\text{indoor}}$ = Indoor baseline concentration after intervention ($\mu\text{g/m}^3$).
- $V_E$ = Minute ventilation volume ($\text{m}^3/\text{h}$).
- $\Delta t$ = Exposure duration shifted or protected (hours).
- $\eta_{\text{dep}}$ = Deposition fraction in tracheobronchial and pulmonary alveolar regions ($\approx 0.28$ for $PM_{2.5}$).

---

## 2. EPA Exposure Factors Ventilation Standards ($V_E$)

Derived from the **EPA Exposure Factors Handbook (Chapter 6: Inhalation Rates)**:

```
+---------------------------------------------------------------------------------------------------------+
|                                    MINUTE VENTILATION VOLUME TABLE                                      |
+--------------------------+---------------------+-----------------------+--------------------------------+
| Activity Level           | Adult Male (m³/h)   | Adult Female (m³/h)   | Young Child 1-3y (m³/h)        |
+--------------------------+---------------------+-----------------------+--------------------------------+
| **Sedentary / Resting**  | **0.48**            | **0.39**              | **0.24**                       |
| **Light Exertion (walk)**| **0.78**            | **0.68**              | **0.42**                       |
| **Moderate Exercise**    | **1.35**            | **1.15**              | **0.65**                       |
| **Heavy Athletics**      | **2.40**            | **1.95**              | **1.10**                       |
+--------------------------+---------------------+-----------------------+--------------------------------+
| *Adopted Model Default*  | **0.45** (Resting)  | **1.20** (Exercise)   | **0.30** (Child Composite)     |
+--------------------------+---------------------+-----------------------+--------------------------------+
```

---

## 3. Berkeley Earth Cigarette Equivalence Formulation

To make microscopic micrograms tangible to families and children, CleanAir Guardian applies the peer-reviewed **Berkeley Earth particulate-to-cigarette conversion standard** (Muller & Rohde, 2015):

$$1\text{ Cigarette Equivalent} \approx 22\ \mu\text{g/m}^3 \text{ of PM}_{2.5} \text{ inhaled over } 24\text{ hours}$$

Therefore, the daily inhaled particulate mass equivalent to smoking one cigarette is:

$$\text{Mass}_{\text{cig}} = 22\ \mu\text{g/m}^3 \times \left(0.45\text{ m}^3/\text{h} \times 24\text{ h}\right) \times \eta_{\text{dep}} \approx 22 \times 10.8 \times 0.28 \approx 66.5\ \mu\text{g PM}_{2.5}$$

$$\text{Cigarettes Avoided} = \frac{\Delta \text{Dosage}_{\text{avoided}} (\mu\text{g})}{66.5\ \mu\text{g}}$$

---

## 4. Corsi-Rosenthal Box Airflow & Particle Clearance Physics

The Clean Air Delivery Rate ($\text{CADR}$) of a DIY Corsi-Rosenthal Box constructed from a 20-inch box fan and four MERV 13 furnace filters is derived from single-pass filter efficiency and total volumetric airflow:

$$\text{CADR} = Q_{\text{fan}} \times \varepsilon_{\text{single\_pass}}$$

### Fluid Mechanical Parameters:
- Total airflow through 4 filters in parallel with cardboard shroud: $Q_{\text{fan}} \approx 350\text{ CFM} = 594.6\text{ m}^3/\text{h}$.
- MERV 13 single-pass fractional collection efficiency for $0.3 - 1.0\ \mu\text{m}$ particles: $\varepsilon \approx 0.75$; for $1.0 - 3.0\ \mu\text{m}$: $\varepsilon \approx 0.90$.
- **Effective CADR for $PM_{2.5}$:**
  $$\text{CADR}_{PM_{2.5}} = 594.6\text{ m}^3/\text{h} \times 0.78 \approx 463.8\text{ m}^3/\text{h} \approx 273\text{ CFM}$$

### First-Order Room Clearance Decay Differential Equation:
In a typical closed bedroom of volume $V = 45\text{ m}^3$ ($15\text{ m}^2 \times 3\text{ m}$ height):

$$V \frac{dC(t)}{dt} = - \left(\text{CADR} + k_{\text{dep}} V + \text{ACH}_{\text{inf}} V\right) C(t)$$

$$C(t) = C_0 \cdot \exp\left(-\left(\frac{\text{CADR}}{V} + k_{\text{dep}} + \text{ACH}_{\text{inf}}\right) t\right)$$

Where natural deposition $k_{\text{dep}} \approx 0.15\text{ h}^{-1}$ and natural infiltration $\text{ACH}_{\text{inf}} \approx 0.45\text{ h}^{-1}$.

Total clearance rate:
$$\lambda = \frac{463.8}{45} + 0.15 + 0.45 = 10.3 + 0.6 = 10.9\text{ air changes/hour (ACH)}$$

Half-life of indoor particulate concentration ($t_{1/2}$):
$$t_{1/2} = \frac{\ln(2)}{\lambda} = \frac{0.693}{10.9} \approx 0.0635\text{ hours} \approx \mathbf{3.8\text{ minutes}}$$

Within **20 minutes**, indoor $PM_{2.5}$ drops by:
$$1 - \exp(-10.9 \times 0.33) = 1 - \exp(-3.63) \approx \mathbf{97.3\% \text{ reduction}}$$

---

## 5. Commute & Household Carbon Avoidance Calculus

```
+---------------------------------------------------------------------------------------------------------+
|                                    EMISSION FACTORS TABLE                                               |
+--------------------------+-----------------------+----------------------+-------------------------------+
| Mode / Activity          | Direct CO2e Factor    | Tailpipe PM2.5 Factor| Clean Alternative Displacement|
+--------------------------+-----------------------+----------------------+-------------------------------+
| **Solo Petrol Car (10km)**| 192 g CO2e / km       | 0.045 g PM2.5 / km   | Carpooling cluster (60% cut)  |
| **Two-Wheeler (10km)**   | 48 g CO2e / km        | 0.035 g PM2.5 / km   | Metro Rail transit (85% cut)  |
| **Biomass Space Heater** | 850 g CO2e / hour     | 14.50 g PM2.5 / hour | Electric Oil Radiator (100% PM|
| **LPG Unvented Cooktop** | 215 g CO2e / meal     | 0.65 g PM2.5 / meal  | Induction cooktop + lid trap  |
+--------------------------+-----------------------+----------------------+-------------------------------+
```

$$\Delta \text{CO}_2\text{e} (\text{kg}) = d_{\text{commute}} \times \left(EF_{\text{baseline}} - EF_{\text{alternative}}\right) \times N_{\text{passengers}}$$

---

## 6. Worked Numerical Example & Validation Vector

### Test Vector A: Infant Caregiver in Severe Smog
- **Location:** Delhi-NCR, Outdoor AQI 420 ($C_{\text{outdoor}} \approx 380\ \mu\text{g/m}^3$).
- **Intervention 1:** Shift 1.5 hours of morning stroller walk indoors.
  $$\Delta \text{Dosage}_1 = (380 - 45) \times 0.30\text{ m}^3/\text{h} \times 1.5\text{ h} \times 0.28 = 335 \times 0.126 = \mathbf{42.2\ \mu\text{g PM}_{2.5}}$$
- **Intervention 2:** Deploy Corsi-Rosenthal Box in nursery for 8 hours of sleep ($C_{\text{indoor}}$ drops from $160\ \mu\text{g/m}^3$ baseline down to $18\ \mu\text{g/m}^3$).
  $$\Delta \text{Dosage}_2 = (160 - 18) \times 0.24\text{ m}^3/\text{h} \times 8\text{ h} \times 0.28 = 142 \times 0.5376 = \mathbf{76.3\ \mu\text{g PM}_{2.5}}$$
- **Total Inhaled Dose Avoided:**
  $$\text{Total} = 42.2 + 76.3 = \mathbf{118.5\ \mu\text{g PM}_{2.5}}$$
- **Equivalent Cigarettes Avoided:**
  $$\frac{118.5\ \mu\text{g}}{66.5\ \mu\text{g}} = \mathbf{1.78\text{ cigarettes prevented from infant lungs today}}$$
