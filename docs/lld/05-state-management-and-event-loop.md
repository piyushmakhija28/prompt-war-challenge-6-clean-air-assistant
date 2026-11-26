# State Management, Event Loop & Memory Model (LLD)
## CleanAir Guardian (VayuRakshak) — Unidirectional Data Flow & Engine Dynamics

**Document Identifier:** LLD-STATE-PW-CHALLENGE-6-V1.0  
**Status:** Approved by Architecture Council  
**Lead Authors:** `frontend-architect` & `system-design-architect`  

---

## 1. Unidirectional Data Flow Architecture

CleanAir Guardian implements a strict **unidirectional state container** (inspired by Elm / Redux architecture) to guarantee predictable state mutations, zero race conditions, and complete auditability:

```
+---------------------------------------------------------------------------------------------------------+
|                                  UNIDIRECTIONAL STATE MACHINE ARCHITECTURE                              |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|       +-------------------+                                                                             |
|       |    User Action    | (Slider scrub, toggle checkbox, click generate, hash change)                |
|       +---------+---------+                                                                             |
|                 |                                                                                       |
|                 v                                                                                       |
|       +-------------------+       +-----------------------+                                             |
|       |  Action Dispatch  | ----> |  Middleware Pipeline  | (Rate Limiter, Validator, Hash Sync)        |
|       +-------------------+       +-----------+-----------+                                             |
|                                               |                                                         |
|                                               v                                                         |
|                                   +-----------------------+                                             |
|                                   |     Pure Reducer      | (State, Action) -> NewState (Frozen)        |
|                                   +-----------+-----------+                                             |
|                                               |                                                         |
|                                               v                                                         |
|                                   +-----------------------+                                             |
|                                   | Immutable State Store |                                             |
|                                   +-----------+-----------+                                             |
|                                               |                                                         |
|                 +-----------------------------+-----------------------------+                           |
|                 |                                                           |                           |
|                 v                                                           v                           |
|       +-------------------+                                       +-------------------+                 |
|       | FastDOM Scheduler | (Read Phase -> Write Phase)           | Typed EventBus    |                 |
|       +---------+---------+                                       +---------+---------+                 |
|                 |                                                           |                           |
|                 v                                                           v                           |
|       +-------------------+                                       +-------------------+                 |
|       | DOM View Render   |                                       | Telemetry / Audit |                 |
|       +-------------------+                                       +-------------------+                 |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

### 1. State Store Implementation:
```javascript
/**
 * Initial canonical application state (Immutable).
 */
export const INITIAL_STATE = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  simulatedHour: null, // null = live real-world time; number = scrubbed hour (0.0 - 23.9)
  vulnerabilities: 0,   // 5-bit bitfield
  cookingMethod: 'lpg',
  heatingMethod: 'radiator',
  commuteMode: 'twowheeler',
  commuteKm: 12,
  planStatus: 'IDLE',   // 'IDLE' | 'FETCHING' | 'SUCCESS' | 'ERROR'
  activePlan: null,
  activeStrategy: 'OFFLINE_DETERMINISTIC',
  lastError: null
});

/**
 * Pure state reducer function.
 * Must be free of side effects; returns a new frozen state object.
 *
 * @param {Object} state - Current immutable state.
 * @param {Object} action - Action descriptor { type: string, payload: any }.
 * @returns {Object} New immutable state.
 */
export function appReducer(state, action) {
  switch (action.type) {
    case 'SET_AQI':
      return Object.freeze({
        ...state,
        aqi: Math.max(0, Math.min(999, Math.round(Number(action.payload) || 0)))
      });

    case 'SET_SIMULATED_HOUR':
      return Object.freeze({
        ...state,
        simulatedHour: action.payload === null ? null : Math.max(0, Math.min(23.99, Number(action.payload)))
      });

    case 'TOGGLE_VULNERABILITY': {
      const flag = Number(action.payload);
      return Object.freeze({
        ...state,
        vulnerabilities: state.vulnerabilities ^ flag
      });
    }

    case 'SET_LIFESTYLE_FIELD':
      return Object.freeze({
        ...state,
        [action.payload.field]: action.payload.value
      });

    case 'PLAN_REQUEST_INITIATED':
      return Object.freeze({
        ...state,
        planStatus: 'FETCHING',
        lastError: null
      });

    case 'PLAN_REQUEST_SUCCEEDED':
      return Object.freeze({
        ...state,
        planStatus: 'SUCCESS',
        activePlan: action.payload.plan,
        activeStrategy: action.payload.strategy,
        lastError: null
      });

    case 'PLAN_REQUEST_FAILED':
      return Object.freeze({
        ...state,
        planStatus: 'ERROR',
        lastError: action.payload.error
      });

    default:
      return state;
  }
}
```

---

## 2. JavaScript Event Loop Execution Pipeline

To achieve a consistent 60 FPS ($16.67\text{ms}$ frame budget) and eliminate UI freezing during intense slider manipulation or network I/O, tasks are strictly categorized across the browser event loop phases:

```
+----------------------------------------------------------------------------------------------------+
|                                    EVENT LOOP EXECUTION PIPELINE                                   |
+-------------------+----------------------------+---------------------------------------------------+
| Queue Type        | Target Operations          | Execution Guarantees & Constraints                |
+-------------------+----------------------------+---------------------------------------------------+
| **Macrotasks**    | User events (`input`),     | Debounced by 250ms via `setTimeout` to prevent    |
|                   | `fetch()` responses, I/O   | flooding the execution pipeline.                  |
+-------------------+----------------------------+---------------------------------------------------+
| **Microtasks**    | `queueMicrotask`,          | State updates and Reducer execution complete      |
|                   | `Promise.then` resolution  | immediately before rendering, ensuring consistency.|
+-------------------+----------------------------+---------------------------------------------------+
| **Render Phase**  | FastDOM DOM batching,      | Executed strictly within `requestAnimationFrame`. |
|                   | CSS class transitions      | Read phase completes before Write phase begins.   |
+-------------------+----------------------------+---------------------------------------------------+
```

---

## 3. FastDOM Read/Write Phasing (Zero Layout Thrashing)

Forced Synchronous Layouts (FSL) occur when JavaScript queries layout properties (e.g. `offsetHeight`, `getBoundingClientRect`) immediately after modifying the DOM, forcing the browser layout engine to recalculate synchronously. CleanAir Guardian partitions all DOM operations into two discrete phases:

```javascript
/**
 * FastDOM Frame Scheduler: Isolates DOM reads from DOM writes.
 */
export class FastDOMScheduler {
  constructor() {
    this.reads = [];
    this.writes = [];
    this.scheduled = false;
  }

  /**
   * Schedules a read operation.
   * @param {Function} task
   */
  measure(task) {
    this.reads.push(task);
    this.scheduleFlush();
  }

  /**
   * Schedules a DOM mutation write operation.
   * @param {Function} task
   */
  mutate(task) {
    this.writes.push(task);
    this.scheduleFlush();
  }

  /**
   * Flushes all reads followed by all writes within requestAnimationFrame.
   */
  scheduleFlush() {
    if (this.scheduled) return;
    this.scheduled = true;

    requestAnimationFrame(() => {
      // Phase 1: All Reads (Zero Reflows)
      const currentReads = this.reads.slice();
      this.reads.length = 0;
      for (let i = 0; i < currentReads.length; i++) {
        currentReads[i]();
      }

      // Phase 2: All Writes (Batched in single browser paint)
      const currentWrites = this.writes.slice();
      this.writes.length = 0;
      for (let i = 0; i < currentWrites.length; i++) {
        currentWrites[i]();
      }

      this.scheduled = false;
    });
  }
}
```

---

## 4. Memory Lifecycle, Allocation Profiles & Garbage Collection (GC)

### 1. V8 Garbage Collection Mitigations:
1. **Zero Allocations in Steady-State Scrubbing:**  
   During rapid AQI slider scrubbing, calculations reuse pre-allocated scalar primitive variables and typed array ring buffers (`Float64Array`) rather than instantiating transient objects. This prevents minor GC (V8 Scavenge) spikes.
2. **Event Listener Teardown:**  
   When dynamic DOM elements are regenerated, existing event listeners are unbound or delegated through root container delegation (`document.getElementById('app').addEventListener(...)`), preventing detached DOM tree memory leaks.
3. **Closure Scope Isolation:**  
   Module scopes avoid capturing large global references inside callbacks; all handlers receive explicit state slices as arguments.
