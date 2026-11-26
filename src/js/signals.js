/**
 * @fileoverview Micro-Reactive Signal Graph.
 * Implements fine-grained reactive state primitives (Signal, Computed, Effect) with zero framework dependencies,
 * eliminating Virtual DOM diffing overhead and updating dirty DOM nodes in granular O(1) time.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module signals
 */

/**
 * Global subscriber tracking stack pointer.
 * @type {Function|null}
 */
let activeSubscriber = null;

/**
 * Creates a reactive state signal.
 * @template T
 * @param {T} initialValue - Initial state value.
 * @returns {[() => T, (nextValue: T | ((prev: T) => T)) => void]} Tuple containing [getter, setter].
 */
export function createSignal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();

  const read = () => {
    if (activeSubscriber) {
      subscribers.add(activeSubscriber);
    }
    return value;
  };

  const write = (nextValue) => {
    const resolved = typeof nextValue === 'function' ? nextValue(value) : nextValue;
    if (resolved !== value) {
      value = resolved;
      // Shallow copy subscribers to allow modifications during iteration
      const currentSubs = Array.from(subscribers);
      for (let i = 0; i < currentSubs.length; i++) {
        currentSubs[i]();
      }
    }
  };

  return [read, write];
}

/**
 * Creates a derived reactive computed signal.
 * @template T
 * @param {() => T} fn - Pure derivation function.
 * @returns {() => T} Getter for computed value.
 */
export function createComputed(fn) {
  const [read, write] = createSignal(undefined);
  createEffect(() => write(fn()));
  return read;
}

/**
 * Registers a reactive side effect that automatically tracks signal dependencies.
 * @param {() => void} fn - Side effect execution callback.
 */
export function createEffect(fn) {
  const execute = () => {
    activeSubscriber = execute;
    try {
      fn();
    } finally {
      activeSubscriber = null;
    }
  };
  execute();
}
