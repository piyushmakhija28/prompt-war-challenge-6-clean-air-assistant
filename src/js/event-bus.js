/**
 * @fileoverview Typed Pub-Sub EventBus.
 * Implements the GoF Observer Pattern matching LLD-03 Section 3 specification,
 * enabling loosely coupled event coordination across calculation engines and UI components.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module event-bus
 */

/**
 * Typed EventBus implementation.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribes a listener to a named event topic.
   * Complexity: O(1) time.
   *
   * @param {string} event - Topic name (e.g. 'CONTEXT_UPDATED', 'PLAN_GENERATED').
   * @param {Function} callback - Execution callback receiving event payload.
   * @returns {() => void} Unsubscribe cleanup function.
   */
  on(event, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const topicSet = this.listeners.get(event);
    topicSet.add(callback);

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribes a listener from an event topic.
   * Complexity: O(1) time.
   *
   * @param {string} event - Topic name.
   * @param {Function} callback - Target callback reference to remove.
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const topicSet = this.listeners.get(event);
    topicSet.delete(callback);
    if (topicSet.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Publishes an event to all registered topic subscribers.
   * Complexity: O(N) where N is subscriber count for the topic.
   *
   * @param {string} event - Topic name.
   * @param {*} [data] - Event payload data.
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return;
    const subscribers = Array.from(this.listeners.get(event));
    for (let i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](data);
      } catch (err) {
        // Prevent subscriber exception from blocking remaining event broadcast
        if (typeof console !== 'undefined' && console.error) {
          console.error(`Error in EventBus subscriber for event '${event}':`, err);
        }
      }
    }
  }

  /**
   * Clears all registered listeners.
   */
  clear() {
    this.listeners.clear();
  }
}

export const globalEventBus = new EventBus();
