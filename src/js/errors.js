/**
 * @fileoverview Typed Domain Error Hierarchy for CleanAir Guardian.
 * Implements bounded, domain-specific error taxonomy matching LLD-06 specification.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module errors
 */

/**
 * Base abstract error class for all CleanAir Guardian domain errors.
 * @abstract
 */
export class CleanAirBaseError extends Error {
  /**
   * Initializes base error.
   * @param {string} code - Domain error identifier code.
   * @param {string} message - Descriptive error contract message.
   * @param {boolean} [isTransient=false] - Whether error is eligible for automated retry.
   */
  constructor(code, message, isTransient = false) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isTransient = isTransient;
    Object.freeze(this);
  }
}

/**
 * Thrown when outbound Gemini API request exceeds the 8,000ms AbortController timeout ceiling.
 */
export class NetworkTimeoutError extends CleanAirBaseError {
  /**
   * @param {number} timeoutMs - Timeout duration in milliseconds.
   */
  constructor(timeoutMs = 8000) {
    super('ERR_NET_TIMEOUT', `Gemini API request timed out after ${timeoutMs}ms ceiling.`, true);
  }
}

/**
 * Thrown when the client-side Token Bucket Rate Limiter exhausts burst capacity (5 req/min).
 */
export class RateLimitExceededError extends CleanAirBaseError {
  /**
   * @param {number} limitPerMin - Max requests allowed per minute.
   */
  constructor(limitPerMin = 5) {
    super('ERR_RATE_LIMIT', `Client token bucket exhausted (${limitPerMin} req/min). Operating in offline mode.`, true);
  }
}

/**
 * Thrown when Gemini REST output violates Draft-07 JSON schema or fails parsing.
 */
export class SchemaValidationError extends CleanAirBaseError {
  /**
   * @param {string} details - Schema validation failure specifics.
   */
  constructor(details) {
    super('ERR_SCHEMA_MISMATCH', `Model response failed JSON schema validation: ${details}`, false);
  }
}

/**
 * Thrown when URL hash state contains corrupted or non-decodable Base64URL tokens.
 */
export class InvalidStateHashError extends CleanAirBaseError {
  /**
   * @param {string} token - Raw unparseable hash token.
   */
  constructor(token) {
    super('ERR_HASH_CORRUPT', `Malformed URL hash state token: ${token}. Reverted to canonical default preset.`, false);
  }
}

/**
 * Thrown when mathematical input values exceed valid physical domain boundaries.
 */
export class ArithmeticDomainError extends CleanAirBaseError {
  /**
   * @param {string} parameter - Name of out-of-bounds parameter.
   * @param {number} value - Violating numeric scalar.
   */
  constructor(parameter, value) {
    super('ERR_MATH_DOMAIN', `Parameter '${parameter}' value ${value} out of physical bounds. Clamped to valid range.`, false);
  }
}

/**
 * Constructs a bounded AQI scalar (0 to 999).
 * Conforms to LLD 06 §1.
 *
 * @param {number} val - Raw numerical value.
 * @returns {number} Clamped AQI integer.
 */
export function makeAQI(val) {
  return Math.max(0, Math.min(999, Math.round(Number(val) || 0)));
}

/**
 * Constructs a bounded non-negative particulate mass concentration.
 * Conforms to LLD 06 §1.
 *
 * @param {number} val - Raw concentration.
 * @returns {number} Non-negative concentration float.
 */
export function makeConcentration(val) {
  return Math.max(0, Number(val) || 0);
}

/**
 * Normalizes decimal hour into cyclic 24-hour interval [0.0, 24.0).
 * Conforms to LLD 06 §1.
 *
 * @param {number} val - Arbitrary hour number.
 * @returns {number} Normalized decimal hour.
 */
export function makeHour(val) {
  const num = Number(val) || 0;
  return ((num % 24) + 24) % 24;
}

/**
 * Exhaustiveness check helper for union types.
 * Throws an exception if reached at runtime.
 * Conforms to LLD 06 §4.
 *
 * @param {*} x - Unexpected value.
 * @returns {never}
 */
export function assertNever(x) {
  throw new Error(`Unexpected object in exhaustive check: ${JSON.stringify(x)}`);
}
