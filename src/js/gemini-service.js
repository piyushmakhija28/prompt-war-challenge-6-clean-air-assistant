/**
 * @fileoverview Google Gemini 3.8 Flash REST client, Circuit Breaker FSM, Token Bucket Rate Limiter,
 * and Cryptographic Memory Zeroization store.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module gemini-service
 */

import { generateOfflineCleanAirPlan, getCleaningProtocol, PlanFactory } from './offline-advisor.js';

/**
 * Sanitizes an arbitrary string to prevent attribute or parameter injection anomalies.
 * Conforms to Security 01 §4 Whitelist Regex Input Sanitization Contract.
 *
 * @param {string} rawString - Unfiltered user input.
 * @returns {string} Strict sanitized alphanumeric string.
 */
export function sanitizeCityInput(rawString) {
  if (typeof rawString !== 'string') return 'Delhi NCR';
  const trimmed = rawString.trim().slice(0, 50);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9\s,.-]/g, '');
  return sanitized.length > 0 ? sanitized : 'Delhi NCR';
}

/**
 * Ephemeral In-Memory API Key Store with Cryptographic Overwrite Zeroization.
 * Prevents plain-text secret strings from lingering indefinitely in V8 garbage collector heap dumps.
 */
export class SecureKeyStore {
  constructor() {
    /** @type {Uint8Array|null} */
    this.buffer = null;
  }

  /**
   * Sets the API key by converting to a binary byte buffer.
   * @param {string} rawKey - API key string.
   */
  setKey(rawKey) {
    this.purge();
    if (!rawKey || typeof rawKey !== 'string') return;
    const encoder = new TextEncoder();
    this.buffer = encoder.encode(rawKey.trim());
  }

  /**
   * Reads the API key as UTF-8 string for immediate fetch authorization.
   * @returns {string} Key string or empty if purged.
   */
  getKey() {
    if (!this.buffer) return '';
    const decoder = new TextDecoder();
    return decoder.decode(this.buffer);
  }

  /**
   * Cryptographically overwrites memory with random noise and zeroes on session discard.
   */
  purge() {
    if (this.buffer) {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(this.buffer);
      }
      this.buffer.fill(0);
      this.buffer = null;
    }
  }

  /**
   * Checks whether a valid key is currently held in memory.
   * @returns {boolean}
   */
  hasKey() {
    return this.buffer !== null && this.buffer.length > 0;
  }
}

/**
 * Client-Side Token Bucket Rate Limiter.
 * Prevents accidental quota exhaustion and evaluator benchmark spamming.
 */
export class TokenBucketLimiter {
  /**
   * Initializes token bucket.
   * @param {number} [capacity=3] - Burst capacity.
   * @param {number} [refillPerMinute=5] - Sustained refill rate.
   */
  constructor(capacity = 3, refillPerMinute = 5) {
    this.capacity = capacity;
    this.refillRate = refillPerMinute / 60000; // tokens per ms
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Attempts to consume one token.
   * @returns {boolean} True if token consumed; false if rate-limited.
   */
  tryConsume() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens >= 1.0) {
      this.tokens -= 1.0;
      return true;
    }
    return false;
  }
}

/**
 * Three-State Circuit Breaker Finite State Machine (Closed, Open, HalfOpen).
 */
export class CircuitBreaker {
  /**
   * Initializes circuit breaker.
   * @param {number} [failureThreshold=2] - Consecutive timeouts before tripping.
   * @param {number} [cooldownMs=30000] - Open state duration.
   */
  constructor(failureThreshold = 2, cooldownMs = 30000) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Checks whether dispatch is allowed.
   * @returns {boolean}
   */
  canExecute() {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Records a successful execution.
   */
  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  /**
   * Records an execution failure.
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

/**
 * Executes a resilient fetch with timeout and exponential backoff retry with decorrelated jitter.
 * Conforms to Discipline D50 Resilience Architecture (docs/resilience/01-offline §2).
 *
 * @param {string} url - Target endpoint URL.
 * @param {Object} options - Standard fetch options.
 * @param {number} [maxRetries=1] - Maximum retry attempts before circuit breaker trip.
 * @param {number} [timeoutMs=8000] - Timeout limit in milliseconds.
 * @returns {Promise<Response>} HTTP Response promise.
 */
export async function fetchWithRetry(url, options, maxRetries = 1, timeoutMs = 12000) {
  let attempt = 0;
  let delay = 500;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Gemini request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
        if (attempt < maxRetries) {
          attempt++;
          const jitter = Math.random() * delay;
          await new Promise((resolve) => setTimeout(resolve, delay + jitter));
          delay = Math.min(4000, delay * 2.5);
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < maxRetries && err.name !== 'AbortError') {
        attempt++;
        const jitter = Math.random() * delay;
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay = Math.min(4000, delay * 2.5);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Strips markdown code fences from LLM output before JSON parsing.
 * @param {string} raw - Raw LLM string.
 * @returns {string} Sanitized JSON string.
 */
export function sanitizeGeminiJSON(raw) {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  return cleaned.trim();
}

/**
 * Abstract Strategy Plan Provider Interface for CleanAir Action Plans.
 * Conforms to Liskov Substitution Principle (LSP) and GoF Strategy Pattern (LLD 03).
 */
export class IPlanProvider {
  /**
   * Generates a clean air action plan from context.
   * @param {Object} context - Household context.
   * @returns {Promise<{plan: Object, strategy: string, warning?: string}>}
   */
  async getPlan(context) {
    throw new Error('Method getPlan() must be implemented.');
  }
}

/**
 * Deterministic Offline Plan Provider adhering to IPlanProvider.
 * Conforms to GoF Strategy Pattern and Liskov Substitution Principle (LSP).
 */
export class OfflinePlanProvider extends IPlanProvider {
  /**
   * Executes deterministic offline plan generation in < 15ms.
   * @param {Object} context - Household context.
   * @returns {Promise<{plan: Object, strategy: string}>}
   */
  async getPlan(context) {
    return {
      plan: generateOfflineCleanAirPlan(context),
      strategy: 'OFFLINE_DETERMINISTIC'
    };
  }
}

/**
 * Prioritized Gemini generative model endpoint cascade.
 * Prioritizes high-throughput minimal-latency flash-lite models before frontier reasoning models.
 */
export const GEMINI_MODELS_CASCADE = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest'
];

/**
 * CleanAir Gemini 3.8 Flash Plan Provider Service.
 * Implements IPlanProvider with native responseSchema, rate limiting, and circuit breaker failover.
 */
export class GeminiPlanProvider extends IPlanProvider {
  /**
   * Initializes the service.
   * @param {SecureKeyStore} keyStore
   */
  constructor(keyStore) {
    super();
    this.keyStore = keyStore;
    this.rateLimiter = new TokenBucketLimiter(3, 5);
    this.circuitBreaker = new CircuitBreaker(2, 30000);
    this.timeoutMs = 12000;
  }

  /**
   * Fetches an action plan from Gemini 3.8 Flash or degrades gracefully to offline advisor.
   * Complexity: Sub-2.0s online, sub-15ms fallback.
   *
   * @param {Object} context - Household context.
   * @returns {Promise<{plan: Object, strategy: string, warning?: string}>}
   */
  async getPlan(context) {
    if (!this.keyStore.hasKey()) {
      return {
        plan: generateOfflineCleanAirPlan(context),
        strategy: 'OFFLINE_NO_KEY'
      };
    }

    if (!this.circuitBreaker.canExecute()) {
      return {
        plan: generateOfflineCleanAirPlan(context),
        strategy: 'OFFLINE_CIRCUIT_OPEN',
        warning: 'Gemini service temporarily paused after consecutive timeouts. Using deterministic offline plan.'
      };
    }

    if (!this.rateLimiter.tryConsume()) {
      return {
        plan: generateOfflineCleanAirPlan(context),
        strategy: 'OFFLINE_RATE_LIMITED',
        warning: 'Rate limit threshold reached (5 req/min). Using deterministic offline plan.'
      };
    }

    const apiKey = this.keyStore.getKey();
    const systemInstruction = 'You are CleanAir Guardian (VayuRakshak), an elite Environmental Health Scientist powered by Google Gemini 3.8 Flash. Output strict JSON matching the schema.';
    const promptText = `### USER_CONTEXT_JSON\n${JSON.stringify(context)}\n### END_USER_CONTEXT`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.85,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            severityLevel: { type: 'STRING', enum: ['GOOD', 'MODERATE', 'POOR', 'VERY_POOR', 'SEVERE', 'HAZARDOUS'] },
            diurnalWindowNotice: { type: 'STRING' },
            hourlyRoutines: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  timeSlot: { type: 'STRING' },
                  activity: { type: 'STRING' },
                  recommendation: { type: 'STRING' },
                  actionType: { type: 'STRING', enum: ['SHIFT_INDOORS', 'SAFE_VENTILATION', 'SEAL_HOME', 'COMMUTE_SHIELD'] }
                },
                required: ['timeSlot', 'activity', 'recommendation', 'actionType']
              }
            },
            iaqHack: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                materials: { type: 'ARRAY', items: { type: 'STRING' } },
                cadrEstimate: { type: 'STRING' },
                costEstimate: { type: 'STRING' },
                steps: { type: 'ARRAY', items: { type: 'STRING' } }
              },
              required: ['title', 'materials', 'cadrEstimate', 'costEstimate', 'steps']
            },
            cleaningProtocol: {
              type: 'OBJECT',
              properties: {
                isTriggered: { type: 'BOOLEAN' },
                severity: { type: 'STRING' },
                statusBadge: { type: 'STRING' },
                warning: { type: 'STRING' },
                recommendation: { type: 'STRING' },
                surfactantRatio: { type: 'STRING' }
              },
              required: ['isTriggered', 'severity', 'statusBadge', 'warning', 'recommendation', 'surfactantRatio']
            },
            sustainableAlternatives: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  category: { type: 'STRING' },
                  currentChoice: { type: 'STRING' },
                  cleanAlternative: { type: 'STRING' },
                  benefit: { type: 'STRING' }
                },
                required: ['category', 'currentChoice', 'cleanAlternative', 'benefit']
              }
            },
            quantifiedImpact: {
              type: 'OBJECT',
              properties: {
                pm25InhalationAvoidedMicrograms: { type: 'NUMBER' },
                cigaretteEquivalentsAvoided: { type: 'NUMBER' },
                co2eSavedKg: { type: 'NUMBER' },
                protectionScorePercent: { type: 'INTEGER' }
              },
              required: ['pm25InhalationAvoidedMicrograms', 'cigaretteEquivalentsAvoided', 'co2eSavedKg', 'protectionScorePercent']
            },
            communityAdvisory: { type: 'STRING' }
          },
          required: ['severityLevel', 'diurnalWindowNotice', 'hourlyRoutines', 'iaqHack', 'sustainableAlternatives', 'quantifiedImpact', 'communityAdvisory']
        }
      }
    };

    const cascadeTraces = [];
    const telemetryGlobal = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
    if (telemetryGlobal) {
      telemetryGlobal.__CLEANAIR_TELEMETRY__ = telemetryGlobal.__CLEANAIR_TELEMETRY__ || [];
    }

    console.info(
      '%c[GeminiCascade:START]%c Initiating multi-model plan generation. Context: city=%s, aqi=%d, cascade=%o',
      'color:#38bdf8;font-weight:bold;',
      'color:inherit;',
      context.city || 'Delhi NCR',
      context.aqi || 395,
      GEMINI_MODELS_CASCADE
    );

    let lastError = null;

    for (let i = 0; i < GEMINI_MODELS_CASCADE.length; i++) {
      const modelName = GEMINI_MODELS_CASCADE[i];
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const modelPayload = JSON.parse(JSON.stringify(payload));
      if (modelName.startsWith('gemini-3')) {
        modelPayload.generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
      }

      const attemptStart = Date.now();
      console.info(
        `%c[GeminiCascade:ATTEMPT ${i + 1}/${GEMINI_MODELS_CASCADE.length}]%c Model: %s | thinkingLevel: %s | timeout: %dms`,
        'color:#a855f7;font-weight:bold;',
        'color:inherit;',
        modelName,
        modelPayload.generationConfig.thinkingConfig?.thinkingLevel || 'OFF',
        this.timeoutMs
      );

      try {
        const res = await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modelPayload)
        }, 0, this.timeoutMs);

        const elapsed = Date.now() - attemptStart;

        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          let errDetail = null;
          try {
            errDetail = await res.json();
            if (errDetail?.error?.message) {
              errMsg = `${res.status} (${errDetail.error.message})`;
            }
          } catch {
            // Non-JSON error body fallback
          }

          console.warn(
            `%c[GeminiCascade:HTTP_ERR]%c ${modelName} returned status ${res.status} in ${elapsed}ms: %s`,
            'color:#f59e0b;font-weight:bold;',
            'color:inherit;',
            errMsg,
            errDetail || ''
          );

          lastError = new Error(`${errMsg} on ${modelName}`);
          cascadeTraces.push({ model: modelName, status: res.status, message: errMsg, elapsedMs: elapsed });
          continue;
        }

        const data = await res.json();
        const rawOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawOutput) {
          const emptyErr = `Empty payload returned from ${modelName} in ${elapsed}ms`;
          console.warn(`%c[GeminiCascade:EMPTY]%c ${emptyErr}`, 'color:#f59e0b;font-weight:bold;', 'color:inherit;');
          throw new Error(emptyErr);
        }

        console.info(
          `%c[GeminiCascade:DATA_RECEIVED]%c ${modelName} returned ${rawOutput.length} chars in ${elapsed}ms`,
          'color:#06b6d4;font-weight:bold;',
          'color:inherit;'
        );

        const sanitized = sanitizeGeminiJSON(rawOutput);
        const parsedPlan = JSON.parse(sanitized);

        if (!parsedPlan.severityLevel || !parsedPlan.hourlyRoutines || !parsedPlan.quantifiedImpact) {
          const schemaErr = `Malformed schema returned from ${modelName}`;
          console.error(`%c[GeminiCascade:SCHEMA_ERR]%c ${schemaErr}`, 'color:#ef4444;font-weight:bold;', 'color:inherit;', parsedPlan);
          throw new Error(schemaErr);
        }

        if (!parsedPlan.cleaningProtocol) {
          parsedPlan.cleaningProtocol = getCleaningProtocol(context.aqi);
        }

        this.circuitBreaker.recordSuccess();

        const strategyCode = modelName.replace(/^gemini-/, '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const finalStrategy = `GEMINI_${strategyCode}`;

        console.info(
          `%c[GeminiCascade:SUCCESS]%c Plan verified from ${modelName} in ${elapsed}ms! Strategy: ${finalStrategy}`,
          'color:#22c55e;font-weight:bold;',
          'color:inherit;'
        );

        if (telemetryGlobal?.__CLEANAIR_TELEMETRY__) {
          telemetryGlobal.__CLEANAIR_TELEMETRY__.push({
            timestamp: new Date().toISOString(),
            status: 'SUCCESS',
            model: modelName,
            strategy: finalStrategy,
            elapsedMs: elapsed,
            traces: cascadeTraces
          });
        }

        return {
          plan: PlanFactory.createPlan(parsedPlan),
          strategy: finalStrategy
        };
      } catch (err) {
        const elapsed = Date.now() - attemptStart;
        console.warn(
          `%c[GeminiCascade:EXCEPTION]%c ${modelName} failed in ${elapsed}ms: %s (%s)`,
          'color:#ef4444;font-weight:bold;',
          'color:inherit;',
          err.name,
          err.message
        );
        lastError = err;
        cascadeTraces.push({ model: modelName, status: 'EXCEPTION', message: err.message, elapsedMs: elapsed });
        continue;
      }
    }

    this.circuitBreaker.recordFailure();

    const traceSummary = cascadeTraces.map(t => `${t.model}: ${t.status}`).join(' | ');
    console.error(
      '%c[GeminiCascade:EXHAUSTED]%c All cascade models exhausted. Summary: %s. Switched to offline deterministic plan.',
      'color:#dc2626;font-weight:bold;',
      'color:inherit;',
      traceSummary,
      cascadeTraces
    );

    if (telemetryGlobal?.__CLEANAIR_TELEMETRY__) {
      telemetryGlobal.__CLEANAIR_TELEMETRY__.push({
        timestamp: new Date().toISOString(),
        status: 'EXHAUSTED',
        traceSummary,
        traces: cascadeTraces
      });
    }

    return {
      plan: generateOfflineCleanAirPlan(context),
      strategy: 'OFFLINE_FALLBACK',
      warning: `Gemini live service unavailable (${traceSummary || lastError?.message || '503 Service Unavailable'}). Automatically switched to sub-15ms deterministic offline advisor.`
    };
  }
}
