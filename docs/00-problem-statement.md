# ISO/IEC/IEEE 29148 Problem Statement & Domain Invariants
## CleanAir Guardian (VayuRakshak) — Winter Smog & Urban Pollution Navigation

---

## 1. Executive Summary & Challenge Mandate

**Target Challenge:** Prompt War Challenge No. 6  
**Problem Statement:**  
> *"Create a GenAI-powered assistant that helps families and communities navigate severe winter smog and urban air pollution. The application should suggest low-emission daily routines, indoor air quality hacks, and sustainable alternatives tailored to their location and lifestyle, while clearly explaining the direct impact of their choices."*

In continental and river-basin urban metropolises across the globe—most notably the Indo-Gangetic Plain (Delhi-NCR, Lahore, Patna, Lucknow), the Salt Lake Valley, Beijing, and London—winter triggers severe, recurring air quality emergencies. During these episodes, the Air Quality Index (AQI) frequently surges beyond **400 to 500+ (Hazardous / Severe+)**, characterized by extreme concentrations of fine particulate matter ($\text{PM}_{2.5}$ and $\text{PM}_{10}$), nitrogen oxides ($\text{NO}_x$), sulfur dioxide ($\text{SO}_2$), and secondary ammonium nitrate/sulfate aerosols.

Existing public health responses rely predominantly on **passive data broadcasting** (e.g., municipal AQI dashboards) and **broad generic advisories** ("wear a mask", "avoid outdoors"). These fail because:
1. They ignore the **meteorological diurnal cycle** of thermal temperature inversions.
2. They do not account for **heterogeneous household vulnerabilities** (e.g., infants, asthmatics, pregnant women, elderly retirees, outdoor workers).
3. They offer unaffordable recommendations (e.g., commercial $300 HEPA purifiers) while ignoring proven **zero/low-cost community hacks** (e.g., DIY Corsi-Rosenthal boxes, wet-mopping protocols).
4. They provide **zero quantifiable feedback** on how personal and community behavioral shifts directly save lungs and reduce emissions.

CleanAir Guardian (*VayuRakshak*) solves this crisis by combining **Google Gemini 3.8 Flash** GenAI reasoning with rigorous atmospheric physics and respiratory mathematics to deliver personalized routines, community hacks, and transparent impact metrics.

---

## 2. Ground Truth & Meteorological Reality

### 2.1 The Diurnal Temperature Inversion Mechanism
Under normal daytime meteorological conditions, air temperature decreases with altitude at the Environmental Lapse Rate ($\Gamma \approx 6.5^\circ\text{C/km}$). Warm, buoyant surface air rises, lofting vehicular and industrial pollutants upward into the free troposphere where wind dispersion dilutes them.

During winter, continental urban basins experience intense nocturnal radiative ground cooling under clear skies and stagnant winds ($\le 1.5\text{ m/s}$):
1. **The Ground Trap (Nocturnal Radiation Inversion):**
   The Earth's surface cools rapidly after sunset. A shallow layer of dense, freezing air forms at ground level ($0 - 150\text{ m}$), capped by a layer of warmer air aloft. This creates a vertical temperature inversion:
   $$\frac{\partial T}{\partial z} > 0$$
   Buoyant vertical convection is completely suppressed. Surface emissions from vehicular exhausts, biomass burning, and road dust are trapped in the shallow breathing zone.
2. **The Morning Spike (06:00 – 09:30):**
   Morning rush-hour vehicular emissions and domestic heating coincide with the lowest Planetary Boundary Layer (PBL) height ($h_{PBL} \approx 80 - 120\text{ m}$). Ground-level $\text{PM}_{2.5}$ reaches catastrophic peaks ($350 - 650\ \mu\text{g/m}^3$). Outdoor morning exercise or school runs during this window inflict severe alveolar particulate deposition.
3. **The Solar Convective Window (12:30 – 15:30):**
   Solar insolation warms the ground, eroding the shallow inversion cap from below. Convective thermal updrafts re-establish mixing heights ($h_{PBL} \approx 600 - 900\text{ m}$), temporarily dispersing ground particulate concentrations by $40\% - 60\%$. This represents the **only safe, low-risk diurnal window** for brief indoor air exchange, outdoor school breaks, and essential errands.
4. **The Evening Re-Condensation (18:00 – 22:00):**
   As solar heating terminates, rapid radiative cooling immediately re-establishes the inversion cap, trapping evening rush hour traffic and dinner cooking emissions.

---

## 3. Chemical & Particulate Profiling

```
+---------------------------------------------------------------------------------------------------------+
|                                    PARTICULATE & GASEOUS PROFILING                                      |
+-------------------+--------------------+--------------------------------+-------------------------------+
| Pollutant         | Aerodynamic Diam.  | Primary Urban Sources          | Human Pathophysiology         |
+-------------------+--------------------+--------------------------------+-------------------------------+
| **PM2.5**         | $\le 2.5\ \mu\text{m}$| Tailpipe exhaust, crop residue, | Deep alveolar penetration,    |
|                   |                    | biomass burning, secondary SOA | crosses air-blood barrier,    |
|                   |                    |                                | systemic vascular inflammation|
+-------------------+--------------------+--------------------------------+-------------------------------+
| **PM10**          | $2.5 - 10\ \mu\text{m}$| Unpaved road dust, dry sweeping| Tracheobronchial deposition,  |
|                   |                    | construction dust resuspension | severe asthma exacerbation    |
+-------------------+--------------------+--------------------------------+-------------------------------+
| **NO2**           | Gaseous            | Diesel engines, gas stoves     | Airway hyperreactivity,       |
|                   |                    |                                | pediatric asthma induction    |
+-------------------+--------------------+--------------------------------+-------------------------------+
| **SO2**           | Gaseous            | Coal-fired thermal generation, | Bronchoconstriction within    |
|                   |                    | heavy fuel oil industrial units| 10 minutes of exposure        |
+-------------------+--------------------+--------------------------------+-------------------------------+
| **PM0.1** (UFP)   | $\le 0.1\ \mu\text{m}$| Fresh vehicular exhaust, open  | Enters bloodstream directly,  |
|                   |                    | pan frying, incense / chulhas  | crosses blood-brain barrier   |
+-------------------+--------------------+--------------------------------+-------------------------------+
```

---

## 4. The 5 Core Problem Invariants

1. **Invariant 1 (Static AQI Fatalism):** Displaying static numbers (e.g., "AQI 465 - Hazardous") without immediate, low-cost actionable protocols induces cognitive paralysis and fatalistic indifference rather than protective action.
2. **Invariant 2 (Diurnal Temporal Leverage):** Exposure is a function of time and ventilation rate ($\text{Dose} = C \times V_E \times t$). Shifting an activity by 3 hours (from 07:30 to 13:30) reduces inhaled particulate mass by over $60\%$ without requiring any financial expense.
3. **Invariant 3 (Economic Accessibility Floor):** Over $70\%$ of urban families in developing metropolises cannot afford commercial $\$250+$ HEPA purifiers. Solutions must provide open-source, DIY alternatives (such as the Corsi-Rosenthal Box) that achieve equivalent CADR ($\ge 250\text{ CFM}$) at under $15\%$ of the cost.
4. **Invariant 4 (Biological Vulnerability Disparity):** An infant breathing at $V_E = 0.30\text{ m}^3/\text{h}$ with an underdeveloped immune system or a 68-year-old asthmatic with reduced $FEV_1$ suffers irreversible damage at thresholds that a healthy adult can temporarily tolerate. Recommendations must be dynamically scaled by vulnerability multipliers.
5. **Invariant 5 (Direct Quantifiable Impact Requirement):** Community compliance requires visible, immediate feedback. Users must see exact micrograms ($\mu\text{g}$) of $\text{PM}_{2.5}$ saved, cigarette equivalents avoided, and kilograms of $\text{CO}_2\text{e}$ prevented.

---

## 5. Quantitative Target Personas

### Persona A: Ananya (Mother of 18-Month-Old Infant, Delhi-NCR)
- **Profile:** 29-year-old software engineer working hybrid; lives in a 3rd-floor apartment in Noida.
- **Vulnerabilities:** 18-month-old infant (Aarav) with recovering bronchiolitis; elderly mother-in-law (67y).
- **Current Baseline:** Outdoor AQI 425; cooking on LPG gas; using electric fan heaters; taking baby out in stroller at 08:30 AM for morning sun.
- **CleanAir Intervention:** Shifts stroller walk to 01:15 PM (solar dispersal); deploys DIY Corsi-Rosenthal nursery filter; wet-mopping protocol. Inhaled dose avoided: **$114.7\ \mu\text{g PM}_{2.5}/\text{day}$**.

### Persona B: Rajesh (68-Year-Old Asthmatic Retiree, Lahore)
- **Profile:** Retired bank officer; lifelong asthma patient with Baseline $FEV_1 = 64\%$.
- **Vulnerabilities:** Acute cold-induced bronchospasm; coronary artery disease.
- **Current Baseline:** Outdoor AQI 380; morning walk in neighborhood park at 06:45 AM; dry-brooming dust off balcony twice daily.
- **CleanAir Intervention:** Replaces morning outdoor walk with indoor stretching; damp microfiber mopping; bedroom air sealing.

### Persona C: Vikram (32-Year-Old Two-Wheeler Commuter, Gurugram)
- **Profile:** Field sales manager riding a 150cc motorcycle 22 km daily across arterial highways.
- **Vulnerabilities:** Unfiltered airway exposure during peak morning (09:00 AM) and evening (07:30 PM) rush hour.
- **Current Baseline:** Wears standard cloth mask (3% filtration efficiency for submicron particles); idling at signal intersections.
- **CleanAir Intervention:** Upgrades to N95/FFP2 with verified seal; routes commute via Metro rail or carpool cluster; uses zero-idle stop techniques.

### Persona D: Ramesh (44-Year-Old Traffic Officer / Street Vendor, Central Delhi)
- **Profile:** Traffic sub-inspector standing at major arterial intersections for 8 to 10 hours daily.
- **Vulnerabilities:** Prolonged high-ventilation ambient exposure ($V_E = 1.25\text{ m}^3/\text{h}$); zero home structural envelope during duty shifts.
- **Current Baseline:** Standing directly in vehicular tailpipe slipstreams in AQI 450+ ($C_{\text{outdoor}} \approx 420\ \mu\text{g/m}^3$). Daily baseline alveolar dose: **$1,176\ \mu\text{g PM}_{2.5}/\text{day}$** ($\approx 17.7$ cigarettes equivalent).
- **CleanAir Intervention:** Prescribes fitted dual-strap elastomeric N95 respirators (95% penetration reduction); schedules duty rotations away from traffic bottlenecks during morning/evening inversion peaks; prescribes evening nasal saline irrigation to clear macro-particulates. Dose avoided: **$882\ \mu\text{g PM}_{2.5}/\text{day}$**.
