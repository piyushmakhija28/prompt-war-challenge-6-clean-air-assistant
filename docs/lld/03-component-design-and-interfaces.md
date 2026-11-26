# Component Design & JavaScript Module Interfaces (LLD)
## CleanAir Guardian (VayuRakshak) — SOLID Principles, GoF Patterns & V8 Internals

**Document Identifier:** LLD-COMPONENTS-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Anti-Hallucination Gate 2  
**Lead Architects:** `solution-architect` & `system-design-architect`  

---

## 1. Modular Source Code Architecture (`src/js/`)

The application is decomposed into six cleanly decoupled ES6 modules adhering to Level 2.2 Docstrings-Only governance (`12-docstrings-only.md`) and the 8 CS Pillars:

```
src/js/
├── config.js                 # Global constants, AQI breakpoints, emission factors, default presets
├── air-quality-engine.js     # Diurnal boundary layer modeling, TimeEngine scrubber, vulnerability index
├── impact-calculator.js      # EPA breakpoint interpolation, expm1 particle decay, WTW carbon calculus
├── offline-advisor.js        # Deterministic decision trees, Corsi-Rosenthal hack, schedule generator
├── gemini-service.js         # Google Gemini 3.8 Flash REST client, timeout, code-fence sanitizer, rate limiter
└── app.js                    # UI Controller, EventBus, Result monad pipeline, DOM reconciliation engine
```

---

## 2. SOLID Object-Oriented Principles Implementation

```
+---------------------------------------------------------------------------------------------------------+
|                                    SOLID PRINCIPLES DECONSTRUCTION                                      |
+-----+-------------------------------+-------------------------------------------------------------------+
| ID  | SOLID Principle               | Concrete CleanAir Guardian Implementation                         |
+-----+-------------------------------+-------------------------------------------------------------------+
| **S**| **Single Responsibility**     | `air-quality-engine` owns meteorology only; `impact-calculator`   |
|     | **Principle (SRP)**           | owns respiratory physics only; `gemini-service` owns HTTP transport.|
+-----+-------------------------------+-------------------------------------------------------------------+
| **O**| **Open/Closed**               | New clean air hacks or alternative transit modes are registered   |
|     | **Principle (OCP)**           | via extensible strategy dictionaries without modifying math loops.|
+-----+-------------------------------+-------------------------------------------------------------------+
| **L**| **Liskov Substitution**       | `GeminiPlanProvider` and `OfflinePlanProvider` both satisfy the   |
|     | **Principle (LSP)**           | `IPlanProvider` interface and can be substituted with zero drift. |
+-----+-------------------------------+-------------------------------------------------------------------+
| **I**| **Interface Segregation**     | UI components depend on `RenderablePlan`; serializer depends only |
|     | **Principle (ISP)**           | on `SerializableContext`; calculation engines depend on numbers.  |
+-----+-------------------------------+-------------------------------------------------------------------+
| **D**| **Dependency Inversion**      | `AppController` depends on abstract `IPlanProvider` interface, not|
|     | **Principle (DIP)**           | concrete browser `fetch` or local heuristic implementations.      |
+-----+-------------------------------+-------------------------------------------------------------------+
```

---

## 3. GoF Design Patterns & Functional Programming Patterns

### 3.1 Railway-Oriented Programming (`Result<T, E>`)
```javascript
/**
 * Algebraic Result Data Type representing either Success (Ok) or Failure (Err).
 * @template T, E
 */
export const Result = {
  ok: (value) => Object.freeze({ isOk: true, value, error: null }),
  err: (error) => Object.freeze({ isOk: false, value: null, error })
};
```

### 3.2 Strategy Pattern (`IPlanProvider`)
```javascript
/**
 * Common plan provider contract.
 */
export class IPlanProvider {
  /**
   * @param {Object} context - User context object.
   * @returns {Promise<Object>} Result wrapping CleanAirActionPlan.
   */
  async getPlan(context) {
    throw new Error('Method getPlan() must be implemented.');
  }
}

export class GeminiPlanProvider extends IPlanProvider { ... }
export class OfflinePlanProvider extends IPlanProvider { ... }
```

### 3.3 Observer Pattern (`EventBus`)
```javascript
/**
 * Decoupled event dispatcher managing UI state notifications.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback); // Unsubscribe closure
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) set.delete(callback);
  }

  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try { cb(data); } catch (err) { console.error(`EventBus error on ${event}:`, err); }
      });
    }
  }
}
```

### 3.4 Factory Method Pattern (`PlanFactory`)
```javascript
/**
 * Factory creating validated, normalized CleanAirActionPlan instances.
 */
export class PlanFactory {
  static createPlan(raw) {
    return Object.freeze({
      severityLevel: raw.severityLevel || 'MODERATE',
      diurnalWindowNotice: raw.diurnalWindowNotice || 'Standard diurnal schedule.',
      hourlyRoutines: Array.isArray(raw.hourlyRoutines) ? raw.hourlyRoutines.map(Object.freeze) : [],
      iaqHack: Object.freeze(raw.iaqHack || { title: 'Damp Wet-Mopping', materials: [], steps: [] }),
      sustainableAlternatives: Array.isArray(raw.sustainableAlternatives) ? raw.sustainableAlternatives.map(Object.freeze) : [],
      quantifiedImpact: Object.freeze({
        pm25InhalationAvoidedMicrograms: Number(raw.quantifiedImpact?.pm25InhalationAvoidedMicrograms) || 0,
        cigaretteEquivalentsAvoided: Number(raw.quantifiedImpact?.cigaretteEquivalentsAvoided) || 0,
        co2eSavedKg: Number(raw.quantifiedImpact?.co2eSavedKg) || 0,
        protectionScorePercent: Math.min(Math.max(Number(raw.quantifiedImpact?.protectionScorePercent) || 0, 0), 100)
      }),
      communityAdvisory: String(raw.communityAdvisory || '')
    });
  }
}
```

---

## 4. V8 Monomorphic Hidden Classes & Layout Thrashing Elimination

### 4.1 Monomorphic Hidden Classes
All state objects initialize properties in strictly identical lexical order:
```javascript
export function createContext(city, aqi, vulnBits, cookIdx, heatIdx, commuteIdx, timeHour) {
  // Always create properties in this exact sequence for V8 IC monomorphism:
  return {
    city: String(city),
    aqi: Number(aqi),
    vulnBits: Number(vulnBits),
    cookIdx: Number(cookIdx),
    heatIdx: Number(heatIdx),
    commuteIdx: Number(commuteIdx),
    timeHour: Number(timeHour)
  };
}
```

### 4.2 FastDOM / Layout Thrashing Elimination
To prevent Forced Synchronous Layouts:
1. DOM read phase: Measure dimensions or scroll positions first.
2. DOM write phase: Batch all text updates and class toggles inside `window.requestAnimationFrame()`.
3. Elements apply CSS `contain: content;` to isolate repaints.
