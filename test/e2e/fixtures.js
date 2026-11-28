/**
 * @fileoverview Shared Playwright harness for the CleanAir Guardian scenario suite.
 * Intercepts every third-party host with controllable mocks, fails any test that reaches an
 * unmocked external host or reports a console error or CSP violation, installs a controllable
 * clock, and exposes a page object for the real user interface.
 * @module test/e2e/fixtures
 */

import { test as base, expect } from '@playwright/test';
import { computeImpact, massConcentrationToAqi } from '../../src/js/impact-calculator.js';
import { METRO_BASIN_COORDINATES, TARGET_PERSONAS } from '../../src/js/config.js';

export { expect, computeImpact, massConcentrationToAqi, TARGET_PERSONAS, METRO_BASIN_COORDINATES };

export const FAKE_KEY = 'test-key-123';
export const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
export const START_TIME = new Date('2026-11-28T08:00:00Z');
export const OBSERVED_AT = '2026-11-28T10:00';

export const HOSTS = Object.freeze({
  gemini: 'generativelanguage.googleapis.com',
  air: 'air-quality-api.open-meteo.com',
  bigDataCloud: 'api.bigdatacloud.net',
  nominatim: 'nominatim.openstreetmap.org'
});

const VULN_LABELS = Object.freeze([
  [1, 'infant'],
  [2, 'asthma or COPD'],
  [4, 'senior'],
  [8, 'pregnant'],
  [16, 'outdoor worker']
]);

const PM25_BY_CITY = Object.freeze({
  'Delhi NCR': 150,
  Lahore: 205,
  Kolkata: 72,
  Patna: 101,
  Lucknow: 88,
  Beijing: 41,
  Ulaanbaatar: 262,
  'Salt Lake City Basin': 17
});

export const DEFAULT_PM25 = 55;

/**
 * Mock PM2.5 concentration served for a listed city.
 *
 * @param {string} city - Preset city name.
 * @returns {number} Concentration in ug/m3.
 */
export function pm25ForCity(city) {
  return PM25_BY_CITY[city] ?? DEFAULT_PM25;
}

/**
 * AQI the application must show for the mocked live reading of a city.
 *
 * @param {string} city - Preset city name.
 * @returns {number} Integer AQI.
 */
export function liveAqiFor(city) {
  return massConcentrationToAqi(pm25ForCity(city));
}

/**
 * Household context the application starts with once the live reading has landed.
 *
 * @param {Object} [overrides] - Fields to replace.
 * @returns {Object} Expected context.
 */
export function defaultModel(overrides = {}) {
  return {
    city: 'Delhi NCR',
    aqi: liveAqiFor('Delhi NCR'),
    aqiSource: 'live',
    vulnBits: 3,
    housingType: 'standard_flat',
    cookingMethod: 'lpg',
    heatingMethod: 'space_heater',
    commuteMode: 'two_wheeler',
    commuteKm: 14,
    ...overrides
  };
}

/**
 * Context the application must hold after a persona preset is applied.
 *
 * @param {string} id - Persona id.
 * @returns {Object} Expected context.
 */
export function personaModel(id) {
  const { name, id: personaId, ...profile } = TARGET_PERSONAS[id];
  return { ...profile, aqiSource: 'manual' };
}

/**
 * Builds the identifying tag the mock model writes into every piece of advice, so a test can
 * prove which inputs produced the text on screen.
 *
 * @param {Object} facts - Facts block taken from the request prompt.
 * @returns {string} Tag.
 */
export function echoTag(facts) {
  return `[city=${facts.city}; air=${facts.aqi}; src=${facts.aqiSource}; ` +
    `vuln=${facts.vulnerabilities.join(' + ') || 'none'}; home=${facts.housingType}; ` +
    `cook=${facts.cookingMethod}; heat=${facts.heatingMethod}; ride=${facts.commuteMode}; km=${facts.commuteKm}]`;
}

/**
 * Tag that advice generated for the given expected context must carry.
 *
 * @param {Object} model - Expected context.
 * @returns {string} Tag.
 */
export function tagFor(model) {
  const vulnerabilities = VULN_LABELS.filter(([bit]) => model.vulnBits & bit).map(([, label]) => label);
  return echoTag({ ...model, vulnerabilities });
}

/**
 * Builds a well formed advice plan that echoes the request facts.
 *
 * @param {Object} call - Recorded Gemini call.
 * @returns {Object} Plan matching the response schema.
 */
export function echoPlan(call) {
  const tag = echoTag(call.facts);
  const slots = ['Morning', 'Midday', 'Afternoon', 'Evening'];
  const actions = ['SEAL_HOME', 'SAFE_VENTILATION', 'SHIFT_INDOORS', 'COMMUTE_SHIELD'];
  return {
    hourlyRoutines: slots.map((slot, index) => ({
      timeSlot: `${slot} window`,
      activity: `${slot} routine`,
      recommendation: `${slot} guidance ${tag}`,
      actionType: actions[index]
    })),
    communityAdvisory: `Neighbourhood note ${tag}`,
    communityAdvisoryHi: `सामुदायिक सलाह ${tag}`
  };
}

/**
 * Wraps text in the Gemini generateContent success envelope.
 *
 * @param {string} text - Model text.
 * @returns {Object} Mock reply.
 */
export function textReply(text) {
  return { status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } };
}

/**
 * Successful reply carrying the given plan object.
 *
 * @param {Object} plan - Plan.
 * @returns {Object} Mock reply.
 */
export function planReply(plan) {
  return textReply(JSON.stringify(plan));
}

/**
 * Successful reply that echoes the request.
 *
 * @param {Object} call - Recorded call.
 * @returns {Object} Mock reply.
 */
export function echoReply(call) {
  return planReply(echoPlan(call));
}

/**
 * Error reply in the Google API error shape.
 *
 * @param {number} status - HTTP status.
 * @param {Object} [error] - Extra error fields.
 * @returns {Object} Mock reply.
 */
export function errorReply(status, error = {}) {
  return { status, json: { error: { code: status, message: 'Mocked failure', ...error } } };
}

/**
 * Quota reply, optionally carrying a RetryInfo delay.
 *
 * @param {string} [retryDelay] - Delay such as "20s".
 * @returns {Object} Mock reply.
 */
export function quotaReply(retryDelay) {
  const details = retryDelay
    ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]
    : [];
  return errorReply(429, { status: 'RESOURCE_EXHAUSTED', details });
}

/**
 * The reply Google sends for a bad key.
 *
 * @returns {Object} Mock reply.
 */
export function invalidKeyReply() {
  return errorReply(400, {
    status: 'INVALID_ARGUMENT',
    message: 'API key not valid.',
    details: [{ reason: 'API_KEY_INVALID' }]
  });
}

/**
 * Open-Meteo success reply.
 *
 * @param {number} pm25 - Concentration.
 * @param {string} [time] - Observation time.
 * @returns {Object} Mock reply.
 */
export function airReply(pm25, time = OBSERVED_AT) {
  return { status: 200, json: { current: { time, pm2_5: pm25, pm10: pm25 * 1.5 } } };
}

/**
 * One controllable third-party host. Every request is logged; replies come from a queue of
 * one-shot responders and otherwise from the persistent fallback responder.
 */
export class HostMock {
  /**
   * @param {Function} fallback - Default responder.
   * @param {Object} health - Shared health record.
   */
  constructor(fallback, health) {
    this.initialFallback = fallback;
    this.fallback = fallback;
    this.health = health;
    this.queue = [];
    this.calls = [];
    this.gates = [];
  }

  /**
   * Queues one-shot responders, consumed in order.
   *
   * @param {...(Function|Object)} responders - Replies or reply factories.
   */
  next(...responders) {
    this.queue.push(...responders);
  }

  /**
   * Replaces the persistent responder.
   *
   * @param {Function|Object} responder - Reply or reply factory.
   */
  always(responder) {
    this.fallback = responder;
  }

  /**
   * Restores the default successful behaviour and drops queued responders.
   */
  reset() {
    this.queue = [];
    this.fallback = this.initialFallback;
  }

  /**
   * Queues a response that is withheld until released.
   *
   * @param {Function|Object} [responder] - Reply sent on release.
   * @returns {{release: Function, call: () => Object}} Gate handle; release resolves once
   *   the reply has been handed to the browser.
   */
  hold(responder = this.initialFallback) {
    let open;
    let delivered;
    let seen = null;
    let replacement = null;
    const opened = new Promise((resolve) => { open = resolve; });
    const done = new Promise((resolve) => { delivered = resolve; });
    this.queue.push({
      isGate: true,
      respond: async (call) => {
        seen = call;
        await opened;
        const chosen = replacement ?? responder;
        return typeof chosen === 'function' ? chosen(call) : chosen;
      },
      delivered: () => delivered()
    });
    return {
      call: () => seen,
      release: async (override = null) => {
        replacement = override;
        open();
        await done;
      }
    };
  }

  /**
   * Serves one intercepted request.
   *
   * @param {import('@playwright/test').Route} route - Intercepted route.
   */
  async handle(route) {
    const request = route.request();
    const call = {
      index: this.calls.length,
      url: request.url(),
      method: request.method(),
      headers: await request.allHeaders().catch(() => request.headers()),
      body: request.postData(),
      facts: null,
      payload: null
    };
    if (call.body) {
      call.payload = JSON.parse(call.body);
      const prompt = call.payload.contents?.[0]?.parts?.[0]?.text ?? '';
      const match = prompt.match(/<facts_json>\n([\s\S]*?)\n<\/facts_json>/);
      call.facts = match ? JSON.parse(match[1]) : null;
    }
    this.calls.push(call);

    const queued = this.queue.length ? this.queue.shift() : this.fallback;
    const gate = queued?.isGate ? queued : null;
    const responder = gate ? gate.respond : queued;
    const reply = typeof responder === 'function' ? await responder(call) : responder;

    if (reply.abort || reply.status >= 400) this.health.servedFailure = true;
    try {
      if (reply.abort) {
        await route.abort(reply.abort);
      } else {
        await route.fulfill({
          status: reply.status,
          headers: { 'access-control-allow-origin': '*' },
          contentType: reply.contentType ?? 'application/json',
          body: reply.body ?? JSON.stringify(reply.json)
        });
      }
    } catch (error) {
      call.deliveryError = error.message;
    } finally {
      gate?.delivered();
    }
  }
}

/**
 * Creates the mock set and installs it on a browser context.
 *
 * @param {import('@playwright/test').BrowserContext} context - Context under test.
 * @param {Object} health - Shared health record.
 * @returns {Promise<Object>} Mocks keyed by role.
 */
async function installMocks(context, health) {
  const airDefault = (call) => {
    const latitude = new URL(call.url).searchParams.get('latitude');
    const city = Object.keys(METRO_BASIN_COORDINATES)
      .find((name) => METRO_BASIN_COORDINATES[name].lat.toFixed(2) === latitude);
    return airReply(pm25ForCity(city));
  };
  const mocks = {
    gemini: new HostMock(echoReply, health),
    air: new HostMock(airDefault, health),
    bigDataCloud: new HostMock({ status: 200, json: { locality: 'Connaught Place', principalSubdivision: 'Delhi' } }, health),
    nominatim: new HostMock({ status: 200, json: { address: { suburb: 'Karol Bagh', city: 'New Delhi' } } }, health)
  };
  await context.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    const url = new URL(route.request().url());
    const role = Object.keys(HOSTS).find((key) => HOSTS[key] === url.hostname);
    if (!role) {
      health.unmocked.push(url.href);
      await route.abort();
      return;
    }
    await mocks[role].handle(route);
  });
  return mocks;
}

/**
 * Page object for the single screen application.
 */
export class CleanAirPage {
  /**
   * @param {import('@playwright/test').Page} page - Page under test.
   */
  constructor(page) {
    this.page = page;
    this.keyInput = page.locator('#input-gemini-key');
    this.saveButton = page.locator('#btn-save-key');
    this.purgeButton = page.locator('#btn-clear-key');
    this.keyStatus = page.locator('#key-status-text');
    this.citySelect = page.locator('#input-city');
    this.detectButton = page.locator('#btn-detect-location');
    this.aqiSlider = page.locator('#input-aqi-slider');
    this.aqiBox = page.locator('#input-aqi-number');
    this.liveButton = page.locator('#btn-live-aqi');
    this.sourceAqi = page.locator('#source-aqi');
    this.sourceAdvice = page.locator('#source-advice');
    this.badge = page.locator('#active-engine-badge');
    this.spinner = page.locator('#plan-spinner');
    this.spinnerText = page.locator('#plan-spinner-text');
    this.banner = page.locator('#status-banner');
    this.schedule = page.locator('#hourly-schedule-container');
    this.cards = page.locator('.schedule-slot-card');
    this.advisory = page.locator('#advisory-preview');
    this.timeSlider = page.locator('#input-time-slider');
    this.timeLabel = page.locator('#label-time-value');
    this.housing = page.locator('#select-housing-type');
    this.kmSlider = page.locator('#input-commute-km');
    this.kmLabel = page.locator('#label-commute-km');
    this.generateButton = page.locator('#btn-generate-plan');
    this.langButton = page.locator('#btn-toggle-lang');
    this.copyLinkButton = page.locator('#btn-copy-link');
    this.copyAdvisoryButton = page.locator('#btn-copy-advisory');
    this.heroAqi = page.locator('#hero-aqi-number');
  }

  /**
   * Loads the application and waits for the first render, and for the live reading when the
   * address asks for live mode.
   *
   * @param {string} [hash] - URL hash including the leading "#".
   * @param {Object} [options] - Waiting options.
   * @param {boolean} [options.awaitLive] - Overrides whether to wait for the live reading.
   */
  async open(hash = '', { awaitLive = !hash || hash.endsWith('&live=1') } = {}) {
    await this.page.goto(`/index.html${hash}`);
    await expect(this.badge).toHaveText(/OFFLINE|GEMINI/);
    await expect(this.cards.first()).toBeVisible();
    if (awaitLive) {
      await expect(this.sourceAqi).toHaveText(/^AQI: Live · Open-Meteo estimate \([^)]*\)$/);
    }
  }

  /**
   * Enters a key and activates it.
   *
   * @param {string} [key] - Fake key.
   */
  async saveKey(key = FAKE_KEY) {
    await this.keyInput.fill(key);
    await this.saveButton.click();
  }

  /**
   * Activates a key and waits until advice for the expected context is on screen.
   *
   * @param {Object} [model] - Expected context.
   */
  async activate(model = defaultModel()) {
    await this.saveKey();
    await this.expectAdvice(model);
  }

  /**
   * Asserts that every piece of model advice on screen belongs to the expected context.
   *
   * @param {Object} model - Expected context.
   * @param {string} [modelName] - Gemini model expected in the source line.
   */
  async expectAdvice(model, modelName = PRIMARY_MODEL) {
    const tag = tagFor(model);
    await expect(this.sourceAdvice).toHaveText(`Advice: Gemini ${modelName}`);
    await expect(this.cards).toHaveCount(4);
    for (let index = 0; index < 4; index++) {
      await expect(this.cards.nth(index)).toContainText(tag);
    }
    await expect(this.advisory).toContainText(tag);
  }

  /**
   * Runs a frozen clock in half second steps until the mock has received a number of calls.
   * Small steps keep the fake clock from expiring a request before its reply can arrive.
   *
   * @param {Object} mock - Host mock.
   * @param {number} count - Expected number of calls.
   */
  async advanceUntilCalls(mock, count) {
    await expect.poll(async () => {
      if (mock.calls.length < count) await this.advance(500);
      return mock.calls.length;
    }, { intervals: [50], timeout: 15000 }).toBe(count);
  }

  /**
   * Runs a frozen clock in small steps until the source line reads as expected, so that
   * pending replies and animation frames are flushed.
   *
   * @param {string} text - Source line.
   */
  async settleSource(text) {
    await expect.poll(async () => {
      await this.advance(50);
      return this.sourceAdvice.textContent();
    }).toBe(text);
  }

  /**
   * Runs a frozen clock until the advice for the expected context is rendered, then asserts it.
   *
   * @param {Object} model - Expected context.
   * @param {string} [modelName] - Gemini model expected in the source line.
   */
  async settleAdvice(model, modelName = PRIMARY_MODEL) {
    const expected = { source: `Advice: Gemini ${modelName}`, tag: tagFor(model) };
    await expect.poll(async () => {
      await this.advance(50);
      return this.page.evaluate(({ source, tag }) => {
        const shown = document.getElementById('source-advice').textContent;
        const cards = [...document.querySelectorAll('.schedule-slot-card')];
        const isBound = shown === source && cards.length > 0 &&
          cards.every((card) => card.textContent.includes(tag)) &&
          document.getElementById('advisory-preview').textContent.includes(tag);
        return isBound ? 'bound' : `${shown} | ${cards[0]?.textContent}`;
      }, expected);
    }).toBe('bound');
    await this.expectAdvice(model, modelName);
  }

  /**
   * Asserts that only on-device advice is shown.
   */
  async expectOffline() {
    await expect(this.sourceAdvice).toHaveText('Advice: Offline (on-device)');
    await expect(this.badge).toHaveText(/^OFFLINE_/);
    await expect(this.schedule).not.toContainText('guidance [city=');
    await expect(this.advisory).not.toContainText('[city=');
    await expect(this.schedule).toContainText('Solar Convective Aeration');
  }

  /**
   * Asserts the refresh indicators are at rest.
   */
  async expectIdle() {
    await expect(this.spinner).toBeHidden();
    await expect(this.schedule).toHaveAttribute('aria-busy', 'false');
    await expect(this.generateButton).toBeEnabled();
    await expect(this.generateButton).toHaveText('Recalculate Clean Air Plan');
  }

  /**
   * Reads every figure and bound input in one snapshot.
   *
   * @returns {Promise<Object>} Displayed values.
   */
  async figures() {
    return this.page.evaluate(() => {
      const text = (id) => document.getElementById(id).textContent.trim();
      return {
        hero: text('hero-aqi-number'),
        slider: document.getElementById('input-aqi-slider').value,
        box: document.getElementById('input-aqi-number').value,
        avoided: text('metric-pm25-avoided'),
        cigarettes: text('metric-cigarettes-avoided'),
        carbon: text('metric-carbon-saved'),
        score: text('metric-protection-score'),
        unshielded: text('text-unshielded-dose'),
        shielded: text('text-protected-dose'),
        delta: text('badge-shield-delta'),
        reduction: text('badge-shield-reduction'),
        barWidth: parseFloat(document.getElementById('bar-protected-dose').style.width)
      };
    });
  }

  /**
   * Asserts that cards, bars, inputs and the advisory frame all show the numbers computed for
   * the expected context.
   *
   * @param {Object} model - Expected context.
   */
  async expectFigures(model) {
    await expect.poll(() => this.figures()).toEqual(expectedFigures(model));
    const impact = computeImpact(model);
    await expect(this.advisory).toContainText(`${model.city} (AQI ${model.aqi}`);
    await expect(this.advisory).toContainText(new RegExp(`(?<![\\d.])${impact.pm25AvoidedUg} µg`));
  }

  /**
   * Selects a radio option.
   *
   * @param {'cooking'|'heating'|'commute'} group - Radio group.
   * @param {string} value - Option value.
   */
  async choose(group, value) {
    await this.page.locator(`input[name="radio-${group}"][value="${value}"]`).check();
  }

  /**
   * Sets one vulnerability checkbox.
   *
   * @param {number} bit - Flag bit.
   * @param {boolean} checked - Desired state.
   */
  async setVulnerability(bit, checked) {
    await this.page.locator(`.input-vuln-checkbox[data-bit="${bit}"]`).setChecked(checked);
  }

  /**
   * Applies a persona preset.
   *
   * @param {string} id - Persona id.
   */
  async persona(id) {
    await this.page.locator(`.btn-persona[data-persona="${id}"]`).click();
  }

  /**
   * Opens a DIY hack tab.
   *
   * @param {string} id - Hack id.
   */
  async hack(id) {
    await this.page.locator(`.hack-tab-btn[data-hack="${id}"]`).click();
  }

  /**
   * Stops the clock so that timers only run when a test advances them.
   */
  async freeze() {
    const now = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(now + 1000);
  }

  /**
   * Runs the frozen clock forward, firing every due timer.
   *
   * @param {number} milliseconds - Duration.
   */
  async advance(milliseconds) {
    await this.page.clock.runFor(milliseconds);
  }

  /**
   * Jumps one minute ahead, which refills the client rate limiter.
   */
  async refill() {
    await this.page.clock.fastForward(60000);
  }
}

/**
 * Figures the screen must show for a context.
 *
 * @param {Object} model - Expected context.
 * @returns {Object} Values in the shape of {@link CleanAirPage#figures}.
 */
export function expectedFigures(model) {
  const impact = computeImpact(model);
  const avoidedCigarettes = impact.cigarettesAvoided.toFixed(1);
  const width = Math.max(4, Math.min(100, (impact.protectedDoseUg / (impact.unshieldedDoseUg || 1)) * 100));
  return {
    hero: String(model.aqi),
    slider: String(model.aqi),
    box: String(model.aqi),
    avoided: `${impact.pm25AvoidedUg} µg`,
    cigarettes: `${avoidedCigarettes} Cigs`,
    carbon: `${impact.carbonSavedKg} kg`,
    score: `${impact.protectionScorePercent}%`,
    unshielded: `${impact.unshieldedDoseUg} µg (${impact.unshieldedCigarettes.toFixed(1)} Cigs)`,
    shielded: `${impact.protectedDoseUg} µg (${impact.protectedCigarettes.toFixed(1)} Cigs)`,
    delta: `Saved: ${impact.pm25AvoidedUg} µg (${avoidedCigarettes} Cigs)`,
    reduction: `-${impact.reductionPct.toFixed(1)}% Inhaled Dose`,
    barWidth: Number(width.toFixed(1))
  };
}

export const test = base.extend({
  launchOptions: [
    { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] },
    { option: true, scope: 'worker' }
  ],

  health: [async ({ context }, use) => {
    const health = {
      consoleErrors: [],
      consoleText: [],
      cspViolations: [],
      unmocked: [],
      ignoredErrors: [],
      servedFailure: false,
      networkDown: false
    };
    context.on('console', (message) => {
      health.consoleText.push(message.text());
      if (message.type() === 'error') health.consoleErrors.push(message.text());
    });
    context.on('weberror', (webError) => {
      health.consoleErrors.push(`pageerror: ${webError.error().message}`);
    });
    await context.exposeBinding('reportCspViolation', (source, detail) => {
      health.cspViolations.push(detail);
    });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        window.reportCspViolation(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await use(health);

    const expectsFailures = health.servedFailure || health.networkDown;
    const unexpected = health.consoleErrors
      .filter((line) => !(expectsFailures && line.startsWith('Failed to load resource')))
      .filter((line) => !health.ignoredErrors.some((pattern) => pattern.test(line)));
    expect.soft(health.unmocked, 'requests to unmocked external hosts').toEqual([]);
    expect.soft(health.cspViolations, 'CSP violations').toEqual([]);
    expect.soft(unexpected, 'console errors').toEqual([]);
  }, { auto: true }],

  mocks: [async ({ context, health }, use) => {
    const mocks = await installMocks(context, health);
    await use(mocks);
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }, { auto: true }],

  app: async ({ page, mocks }, use) => {
    await page.clock.install({ time: START_TIME });
    await use(new CleanAirPage(page));
  }
});
