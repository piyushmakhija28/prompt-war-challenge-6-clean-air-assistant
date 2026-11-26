# Error Handling, Algebraic Types & Branded Primitives (LLD)
## CleanAir Guardian (VayuRakshak) — Railway-Oriented Programming & Type Safety

**Document Identifier:** LLD-TYPES-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Architecture Council  
**Lead Authors:** `code-quality-auditor` & `system-design-architect`  

---

## 1. Dimensional Unit Safety via Branded Types

To prevent catastrophic dimensional arithmetic errors (such as accidentally adding raw AQI index points to particulate mass concentration $\mu\text{g/m}^3$ or carbon grams), CleanAir Guardian establishes **Nominal/Branded Types**:

```typescript
/**
 * Nominal Brand Symbol Declaration.
 */
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

/**
 * Dimensional Physics Unit Types.
 */
export type AQIScalar = Brand<number, 'AQIScalar'>;                     // 0 - 999 AQI Points
export type PM25Concentration = Brand<number, 'PM25Concentration'>;     // Micrograms per cubic meter (ug/m3)
export type InhalationDosage = Brand<number, 'InhalationDosage'>;       // Micrograms inhaled (ug)
export type CigaretteEquivalent = Brand<number, 'CigaretteEquivalent'>; // Cigarettes smoked eq.
export type CarbonGrams = Brand<number, 'CarbonGrams'>;                 // Grams CO2e
export type HourDecimal = Brand<number, 'HourDecimal'>;                 // 0.00 - 23.99 Hours

/**
 * Unit Constructors (Type Narrowing with Boundary Enforcement).
 */
export function makeAQI(val: number): AQIScalar {
  const clamped = Math.max(0, Math.min(999, Math.round(val)));
  return clamped as AQIScalar;
}

export function makeConcentration(val: number): PM25Concentration {
  return Math.max(0, val) as PM25Concentration;
}

export function makeHour(val: number): HourDecimal {
  const norm = ((val % 24) + 24) % 24;
  return norm as HourDecimal;
}
```

---

## 2. Railway-Oriented Programming (ROP) via `Result<T, E>` Monad

Traditional exception throwing (`throw new Error(...)`) creates hidden control flow jumps, unhandled runtime crashes, and ambiguous call sites. CleanAir Guardian enforces the **`Result<T, E>` Algebraic Data Type**, modeling computations as a two-track railway (Success Track `Ok` vs Failure Track `Err`):

```
+---------------------------------------------------------------------------------------------------------+
|                                    RAILWAY-ORIENTED PROGRAMMING (ROP)                                   |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
| Input ---> [ Validation ] === Ok ===> [ Breakpoint Math ] === Ok ===> [ Plan Generation ] ===> Success  |
|                 ||                          ||                                ||                        |
|                Err                         Err                               Err                        |
|                 ||                          ||                                ||                        |
|                 v                           v                                 v                         |
|                 +===========================+=================================+=============> Fallback |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### Complete Monadic Implementation:
```javascript
/**
 * Algebraic Result Monad representing either Success (Ok) or Failure (Err).
 */
export class Result {
  /**
   * Constructs an Ok result.
   * @param {*} value
   * @returns {Result}
   */
  static ok(value) {
    return new Result(true, value, null);
  }

  /**
   * Constructs an Err result.
   * @param {*} error
   * @returns {Result}
   */
  static err(error) {
    return new Result(false, null, error);
  }

  constructor(isSuccess, value, error) {
    this.isSuccess = isSuccess;
    this.value = value;
    this.error = error;
    Object.freeze(this);
  }

  /**
   * Transforms the inner value if Ok; preserves Err.
   * @param {Function} fn - (value: T) => U
   * @returns {Result}
   */
  map(fn) {
    if (!this.isSuccess) return this;
    try {
      return Result.ok(fn(this.value));
    } catch (e) {
      return Result.err(e);
    }
  }

  /**
   * Chains another Result-returning computation (monadic bind).
   * @param {Function} fn - (value: T) => Result<U, E>
   * @returns {Result}
   */
  andThen(fn) {
    if (!this.isSuccess) return this;
    return fn(this.value);
  }

  /**
   * Maps over the error value if Err; preserves Ok.
   * @param {Function} fn - (error: E) => F
   * @returns {Result}
   */
  mapErr(fn) {
    if (this.isSuccess) return this;
    return Result.err(fn(this.error));
  }

  /**
   * Pattern matches over Ok and Err cases.
   * @param {Object} branches - { ok: (value) => any, err: (error) => any }
   * @returns {*}
   */
  match(branches) {
    return this.isSuccess ? branches.ok(this.value) : branches.err(this.error);
  }

  /**
   * Unwraps value or returns provided fallback default.
   * @param {*} fallback
   * @returns {*}
   */
  unwrapOr(fallback) {
    return this.isSuccess ? this.value : fallback;
  }
}
```

---

## 3. Comprehensive Domain Error Taxonomy

```
+---------------------------------------------------------------------------------------------------------+
|                                        TYPED ERROR HIERARCHY                                            |
+--------------------------+---------------------+---------------------+----------------------------------+
| Error Class              | Error Code          | Transient / Fatal   | Automated Recovery Strategy      |
+--------------------------+---------------------+---------------------+----------------------------------+
| `NetworkTimeoutError`    | `ERR_NET_TIMEOUT`   | Transient           | Retry with decorrelated jitter;  |
|                          |                     |                     | trip circuit breaker on $k \ge 2$|
+--------------------------+---------------------+---------------------+----------------------------------+
| `RateLimitExceededError` | `ERR_RATE_LIMIT`    | Transient           | Trip circuit breaker to Open;    |
|                          |                     |                     | activate offline fallback engine |
+--------------------------+---------------------+---------------------+----------------------------------+
| `SchemaValidationError`  | `ERR_SCHEMA_MISMATCH`| Recoverable        | Discard malformed JSON payload;  |
|                          |                     |                     | fallback to deterministic plan   |
+--------------------------+---------------------+---------------------+----------------------------------+
| `InvalidStateHashError`  | `ERR_HASH_CORRUPT`  | Recoverable         | Revert to canonical default      |
|                          |                     |                     | household preset silently        |
+--------------------------+---------------------+---------------------+----------------------------------+
| `ArithmeticDomainError`  | `ERR_MATH_DOMAIN`   | Recoverable         | Clamp input scalar to valid      |
|                          |                     |                     | mathematical domain $[0, 999]$   |
+--------------------------+---------------------+---------------------+----------------------------------+
```

---

## 4. Compile-Time Exhaustiveness Checking

For union types and finite state transitions, exhaustive pattern matching guarantees zero missing branches:

```typescript
/**
 * Exhaustive check helper. Triggers compile-time error if any union member is unhandled.
 * @param {never} x - Must resolve to never if all cases handled.
 * @returns {never}
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled union variant: ${JSON.stringify(x)}`);
}
```
