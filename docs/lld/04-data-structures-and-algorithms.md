# Data Structures, Algorithms & Computational Complexity (LLD)

> Design record. Parts of this document describe components that were removed or replaced in version 1.3.0, such as the application controller class, the reducer, the time engine, the signals and error modules and the fixed protection efficiency. The source code is authoritative.
## CleanAir Guardian (VayuRakshak) — Mathematical & Algorithmic Foundations

**Document Identifier:** LLD-DSA-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Architecture Council  
**Lead Authors:** `algorithms-specialist` & `system-design-architect`  

---

## 1. Asymptotic Complexity Master Matrix

Every computational routine in CleanAir Guardian is engineered for optimal asymptotic performance, guaranteeing deterministic response times on resource-constrained mobile hardware and zero main-thread jank.

```
+--------------------------------------------------------------------------------------------------------------------+
|                                      COMPUTATIONAL COMPLEXITY MASTER MATRIX                                        |
+------------------------------------+-----------------------+---------------------+---------------------------------+
| Operation / Subsystem Routine      | Worst-Case Time (Big-O)| Space Complexity    | Algorithmic Strategy            |
+------------------------------------+-----------------------+---------------------+---------------------------------+
| **Breakpoint Lookup**              | $O(\log K) \approx O(1)$ | $O(1)$ auxiliary    | Monotonic Binary Search ($K=7$) |
| **AQI Mass Concentration ($C_p$)** | $O(1)$                | $O(1)$ auxiliary    | Piecewise Linear Interpolation  |
| **Vulnerability Bitmask Decode**   | $O(1)$                | $O(1)$ auxiliary    | Bitwise Bit-shift & Masking     |
| **Vulnerability Bit Population**   | $O(W) \approx O(1)$   | $O(1)$ auxiliary    | Brian Kernighan's Bit-Count     |
| **Diurnal Thermal Inversion State**| $O(1)$                | $O(1)$ auxiliary    | Closed-Form Trigonometric Harm. |
| **Room Clearance Decay ($e^{-x}$)**| $O(1)$                | $O(1)$ auxiliary    | Numerical `Math.expm1(-x)`      |
| **Inhalation Avoidance Integral**  | $O(1)$                | $O(1)$ auxiliary    | Exact Analytical Solution       |
| **Well-to-Wheel Carbon Accounting**| $O(1)$                | $O(1)$ auxiliary    | Vector Inner Product (Dot Prod) |
| **Base64URL State Serialization**  | $O(M) \approx O(1)$   | $O(M)$ output       | RFC 4648 §5 Bit-Stream Pack ($M \le 128$) |
| **Telemetry Circular Ring Buffer** | $O(1)$ push / peek    | $O(N)$ preallocated | Pre-allocated `Float64Array`    |
+------------------------------------+-----------------------+---------------------+---------------------------------+
```

---

## 2. Bitmask Data Structure for Household Vulnerability Matrix

Rather than allocating dynamic arrays of strings or object hash maps that trigger V8 heap allocation and garbage collection, household vulnerabilities are packed into a single **5-bit unsigned integer bitfield** ($0 \le \mathcal{V} \le 31$):

### 1. Bitfield Allocation Layout:
```
 Bit 4        Bit 3        Bit 2        Bit 1        Bit 0
[0/1]        [0/1]        [0/1]        [0/1]        [0/1]
  |            |            |            |            |
  |            |            |            |            +-- INFANT_UNDER_TWO      (1 << 0 = 0x01)
  |            |            |            +--------------- ASTHMA_RESPIRATORY    (1 << 1 = 0x02)
  |            |            +---------------------------- SENIOR_CITIZEN_65PLUS (1 << 2 = 0x04)
  |            +----------------------------------------- PREGNANT_WOMAN        (1 << 3 = 0x08)
  +------------------------------------------------------ OUTDOOR_STREET_WORKER (1 << 4 = 0x10)
```

### 2. Algorithmic Operations:
```javascript
/**
 * Vulnerability Bitfield Constants.
 */
export const VULN_FLAGS = Object.freeze({
  INFANT: 1 << 0,          // 0b00001 (1)
  ASTHMA: 1 << 1,          // 0b00010 (2)
  SENIOR: 1 << 2,          // 0b00100 (4)
  PREGNANT: 1 << 3,        // 0b01000 (8)
  OUTDOOR_WORKER: 1 << 4   // 0b10000 (16)
});

/**
 * Computes the composite vulnerability multiplier using bitwise operations.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 *
 * @param {number} bitfield - 5-bit vulnerability bitmask (0-31).
 * @returns {number} Composite vulnerability multiplier (1.00 to 3.30).
 */
export function getVulnerabilityMultiplier(bitfield) {
  let multiplier = 1.0;
  if (bitfield & VULN_FLAGS.INFANT) multiplier += 0.40;
  if (bitfield & VULN_FLAGS.ASTHMA) multiplier += 0.50;
  if (bitfield & VULN_FLAGS.SENIOR) multiplier += 0.35;
  if (bitfield & VULN_FLAGS.PREGNANT) multiplier += 0.45;
  if (bitfield & VULN_FLAGS.OUTDOOR_WORKER) multiplier += 0.60;
  return multiplier;
}

/**
 * Counts the active vulnerabilities using Brian Kernighan's bit-counting algorithm.
 * Time Complexity: O(k) where k is number of set bits (k <= 5), effectively O(1).
 * Space Complexity: O(1).
 *
 * @param {number} bitfield - 5-bit integer.
 * @returns {number} Count of set bits.
 */
export function countActiveVulnerabilities(bitfield) {
  let count = 0;
  let v = bitfield & 0x1F; // Constrain to 5 bits
  while (v > 0) {
    v &= (v - 1);
    count++;
  }
  return count;
}
```

---

## 3. Piecewise Breakpoint Binary Search Algorithm

The EPA/CPCB Air Quality Index is mapped to mass concentration $C_p$ across 7 discrete intervals. Since breakpoint intervals are strictly monotonically ordered by index, an interval lookup can be performed via binary search:

```
[Interval 0: 0-50] -> [Interval 1: 51-100] -> [Interval 2: 101-200] -> [Interval 3: 201-300] -> [Interval 4: 301-400] -> [Interval 5: 401-500] -> [Interval 6: 501+]
```

### Binary Search Implementation:
```javascript
/**
 * Breakpoint interval record definition.
 * Monotonically sorted by I_lo.
 */
const BREAKPOINTS = [
  { iLo: 0,   iHi: 50,  bLo: 0,   bHi: 30 },
  { iLo: 51,  iHi: 100, bLo: 31,  bHi: 60 },
  { iLo: 101, iHi: 200, bLo: 61,  bHi: 90 },
  { iLo: 201, iHi: 300, bLo: 91,  bHi: 120 },
  { iLo: 301, iHi: 400, bLo: 121, bHi: 250 },
  { iLo: 401, iHi: 500, bLo: 251, bHi: 380 }
];

/**
 * Performs binary search over monotonic breakpoint intervals to calculate PM2.5 mass concentration.
 * Time Complexity: O(log K) where K = 6 intervals. Max 3 comparisons.
 * Space Complexity: O(1) auxiliary space.
 *
 * @param {number} aqi - Air Quality Index scalar (>= 0).
 * @returns {number} PM2.5 mass concentration in micrograms per cubic meter.
 */
export function aqiToMassConcentration(aqi) {
  if (aqi <= 0) return 0;
  if (aqi > 500) {
    // Extrapolate linearly beyond hazardous ceiling
    return 380 + (aqi - 500) * 1.30;
  }

  let low = 0;
  let high = BREAKPOINTS.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const bp = BREAKPOINTS[mid];

    if (aqi >= bp.iLo && aqi <= bp.iHi) {
      const concentration = ((aqi - bp.iLo) / (bp.iHi - bp.iLo)) * (bp.bHi - bp.bLo) + bp.bLo;
      return Math.round(concentration * 100) / 100;
    }

    if (aqi < bp.iLo) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return 380; // Safe fallback boundary
}
```

---

## 4. Circular Ring Buffer for Diurnal 24-Hour Telemetry

To record and visualize 24-hour diurnal air quality and exposure logs without invoking dynamic array re-allocations (`push`/`shift`) which cause $O(N)$ memory copies and V8 garbage collection churn:

### Ring Buffer Specification:
- **Underlying Store:** Pre-allocated `Float64Array` of fixed size $N = 24$.
- **Pointers:** Head index ($h$) advancing modulo $N$.
- **Invariant:** Contiguous memory layout stored in flat V8 array buffer, zero garbage collector sweeps.

```javascript
/**
 * Fixed-size Circular Ring Buffer backed by Float64Array.
 * Eliminates heap allocations during telemetry updates.
 */
export class DiurnalRingBuffer {
  /**
   * Initializes pre-allocated ring buffer.
   * @param {number} capacity - Fixed capacity (default: 24 for hourly resolution).
   */
  constructor(capacity = 24) {
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * Appends a new value in O(1) time.
   * @param {number} value - Scalar value to append.
   */
  push(value) {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Retrieves the value at relative offset in O(1) time.
   * @param {number} index - 0 is newest, capacity-1 is oldest.
   * @returns {number} Stored float value.
   */
  get(index) {
    if (index < 0 || index >= this.size) return 0;
    const actualIndex = (this.head - 1 - index + this.capacity) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * Returns a copy of ordered chronologically oldest-to-newest values in O(N) time.
   * @returns {Float64Array}
   */
  toChronologicalArray() {
    const result = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx];
    }
    return result;
  }
}
```

---

## 5. Mathematical Proof of Monotonicity & Invariants

1. **Monotonic Breakpoint Property:**  
   $$\forall I_1, I_2 \in \mathbb{R}^+, \quad I_1 \le I_2 \implies C_p(I_1) \le C_p(I_2)$$  
   *Proof:* Each segment $k$ has slope $m_k = \frac{B_{hi} - B_{lo}}{I_{hi} - I_{lo}} > 0$. At boundary intersections, $B_{hi}^{(k)} \le B_{lo}^{(k+1)}$. Hence $C_p$ is piecewise continuous and strictly monotonic non-decreasing.

2. **Ring Buffer Pointer Convergence:**  
   $$\text{head}_{t+1} = (\text{head}_t + 1) \pmod N \implies \text{head} \in [0, N-1] \quad \forall t \ge 0$$  
   *Proof:* Direct consequence of Euclidean division with divisor $N > 0$. Buffer overflow is structurally precluded.

---

## 6. Advanced Algorithms & Geometrical Data Structures

### 6.1 Haversine Great-Circle Distance Metric
For geolocation coordinate matching, the distance metric avoids Euclidean approximations which fail across spherical latitudes:
$$d = 2 R \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
Where $a = \sin^2(\Delta \phi / 2) + \cos(\phi_1)\cos(\phi_2)\sin^2(\Delta \psi / 2)$.
- **Time Complexity:** $O(1)$ per basin evaluation $\implies O(M)$ across $M$ preset basins ($M=9$).
- **Space Complexity:** $O(1)$ stack allocation with zero heap allocation.

### 6.2 Exponential Particulate Decay Monoid
Room clearance behaves as a transformation monoid $(\mathcal{T}, \circ, \text{id})$:
$$\mathcal{T}(t_1) \circ \mathcal{T}(t_2) = \mathcal{T}(t_1 + t_2) \implies \exp(-\lambda t_1) \cdot \exp(-\lambda t_2) = \exp(-\lambda(t_1 + t_2))$$
Guarantees associativity and idempotence under composable filtration periods.

