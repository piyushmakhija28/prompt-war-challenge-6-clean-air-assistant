/**
 * @fileoverview FastDOM Frame Scheduler, Result Monad, and Zero-XSS UI Controller.
 * Coordinates user input events, micro-reactive signal bindings, URL hash state synchronization,
 * and pure text-node DOM hydration with zero innerHTML usage.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module app
 */

import { VULN_FLAGS, DEFAULT_PRESET, TARGET_PERSONAS, METRO_BASIN_PRESETS, METRO_BASIN_COORDINATES } from './config.js';
import { getDiurnalInversion, DiurnalRingBuffer, generateDiurnalCurve, getVulnerabilityMultiplier } from './air-quality-engine.js';
import { SecureKeyStore, GeminiPlanProvider } from './gemini-service.js';
import { contextToHashToken, hashTokenToContext } from './state-codec.js';
import { globalEventBus } from './event-bus.js';
import { calculateRoomClearance, findNearestBasin, getCadrAdequacyRating, UNIT_CONVERSIONS } from './cadr-calculator.js';
import { aqiToMassConcentration, dosageToCigarettes, getHousingInfiltrationCoefficient } from './impact-calculator.js';
import { IAQ_HACKS_CATALOG, generateOfflineCleanAirPlan } from './offline-advisor.js';
import { createSignal, createComputed, createEffect } from './signals.js';

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
   * Transforms value if Ok.
   * @param {Function} fn
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
   * Chains next Result (bind).
   * @param {Function} fn
   * @returns {Result}
   */
  andThen(fn) {
    if (!this.isSuccess) return this;
    return fn(this.value);
  }

  /**
   * Pattern matches over Ok and Err branches.
   * @param {{ok: Function, err: Function}} branches
   * @returns {*}
   */
  match(branches) {
    return this.isSuccess ? branches.ok(this.value) : branches.err(this.error);
  }
}

/**
 * FastDOM Scheduler: Partitions DOM operations into isolated Read and Write phases inside requestAnimationFrame.
 */
export class FastDOMScheduler {
  constructor() {
    this.reads = [];
    this.writes = [];
    this.scheduled = false;
  }

  measure(task) {
    this.reads.push(task);
    this.scheduleFlush();
  }

  mutate(task) {
    this.writes.push(task);
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (this.scheduled) return;
    this.scheduled = true;

    const flush = () => {
      const currentReads = this.reads.slice();
      this.reads.length = 0;
      for (let i = 0; i < currentReads.length; i++) {
        currentReads[i]();
      }

      const currentWrites = this.writes.slice();
      this.writes.length = 0;
      for (let i = 0; i < currentWrites.length; i++) {
        currentWrites[i]();
      }

      this.scheduled = false;
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 0);
    }
  }
}

export const fastDom = new FastDOMScheduler();
export const keyStore = new SecureKeyStore();
export const planProvider = new GeminiPlanProvider(keyStore);

if (typeof window !== 'undefined') {
  window.planProvider = planProvider;
  window.keyStore = keyStore;
  window.__cleanAirTestUtils = {
    get triggerPlanGeneration() { return triggerPlanGeneration; },
    get showStatusBanner() { return showStatusBanner; },
    get hideStatusBanner() { return hideStatusBanner; }
  };
}

/**
 * Initial canonical application state (Immutable).
 * Conforms to LLD 05 §1.
 */
export const INITIAL_STATE = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  simulatedHour: null,
  vulnerabilities: 0,
  cookingMethod: 'lpg',
  heatingMethod: 'space_heater',
  commuteMode: 'two_wheeler',
  commuteKm: 14,
  planStatus: 'IDLE',
  activePlan: null,
  activeStrategy: 'OFFLINE_DETERMINISTIC',
  lastError: null
});

/**
 * Pure state reducer function for unidirectional data flow.
 * Free of side effects; returns a new frozen state object.
 * Conforms to LLD 05 §1.
 *
 * @param {Object} currentState - Current immutable state.
 * @param {{type: string, payload: any}} action - Action descriptor.
 * @returns {Readonly<Object>} New immutable state.
 */
export function appReducer(currentState, action) {
  if (!action || !action.type) return currentState;
  switch (action.type) {
    case 'SET_AQI':
      return Object.freeze({
        ...currentState,
        aqi: Math.max(0, Math.min(999, Math.round(Number(action.payload) || 0)))
      });
    case 'SET_SIMULATED_HOUR':
      return Object.freeze({
        ...currentState,
        simulatedHour: action.payload === null ? null : Math.max(0, Math.min(23.99, Number(action.payload)))
      });
    case 'TOGGLE_VULNERABILITY': {
      const flag = Number(action.payload);
      return Object.freeze({
        ...currentState,
        vulnerabilities: (currentState.vulnerabilities || 0) ^ flag
      });
    }
    case 'SET_LIFESTYLE_FIELD':
      return Object.freeze({
        ...currentState,
        [action.payload.field]: action.payload.value
      });
    case 'PLAN_REQUEST_INITIATED':
      return Object.freeze({
        ...currentState,
        planStatus: 'FETCHING',
        lastError: null
      });
    case 'PLAN_REQUEST_SUCCEEDED':
      return Object.freeze({
        ...currentState,
        planStatus: 'SUCCESS',
        activePlan: action.payload.plan,
        activeStrategy: action.payload.strategy,
        lastError: null
      });
    case 'PLAN_REQUEST_FAILED':
      return Object.freeze({
        ...currentState,
        planStatus: 'ERROR',
        lastError: action.payload.error
      });
    default:
      return currentState;
  }
}

/**
 * Application State Container.
 */
export const state = {
  city: DEFAULT_PRESET.city,
  aqi: DEFAULT_PRESET.aqi,
  vulnBits: DEFAULT_PRESET.vulnBits,
  housingType: DEFAULT_PRESET.housingType || 'standard_flat',
  cookingMethod: DEFAULT_PRESET.cookingMethod,
  heatingMethod: DEFAULT_PRESET.heatingMethod,
  commuteMode: DEFAULT_PRESET.commuteMode,
  commuteKm: DEFAULT_PRESET.commuteKm,
  simulatedHour: null,
  activePlan: null,
  activeStrategy: 'INITIALIZING',
  activeHackId: 'corsi_rosenthal',
  advisoryLang: 'en'
};

/**
 * 24-Hour Diurnal Telemetry Ring Buffer pre-allocated in Float64Array.
 */
export const diurnalHistory = new DiurnalRingBuffer(24);

/**
 * Micro-reactive state signals for fine-grained dependency tracking.
 */
export const [aqiSignal, setAqiSignal] = createSignal(DEFAULT_PRESET.aqi);
export const [timeSignal, setTimeSignal] = createSignal(7.5);
export const activeInversionSignal = createComputed(() => getDiurnalInversion(timeSignal(), aqiSignal()));

/**
 * Renders the analytical continuous 24-hour diurnal spline curve.
 */
export function renderDiurnalSplineCurve() {
  const curve = generateDiurnalCurve(state.aqi);
  const pathEl = document.getElementById('svg-spline-path');
  if (pathEl) {
    pathEl.setAttribute('d', curve.pathD);
  }
  updateSplineMarker(state.simulatedHour !== null && state.simulatedHour !== undefined ? state.simulatedHour : 7.5);
}

/**
 * Updates marker dot position on the diurnal spline curve.
 * @param {number} hour - Hour decimal.
 */
export function updateSplineMarker(hour) {
  const marker = document.getElementById('svg-spline-marker');
  if (!marker) return;
  const h = ((Number(hour) % 24) + 24) % 24;
  const x = Math.round((h / 24) * 240 * 10) / 10;
  const inv = getDiurnalInversion(h, state.aqi);
  const normalized = (inv.multiplier - 0.85) / (2.20 - 0.85);
  const clamped = Math.max(0, Math.min(1, normalized));
  const y = Math.round((36 - clamped * 30) * 10) / 10;
  marker.setAttribute('cx', String(x));
  marker.setAttribute('cy', String(y));
}

/**
 * Screen Reader announcement throttle timestamp.
 */
let lastAnnounceTime = 0;

/**
 * Announces message to assistive technology live regions with 1,000ms rate throttling.
 * @param {string} msg - Announcement text.
 */
export function announceA11y(msg) {
  const now = Date.now();
  if (now - lastAnnounceTime < 1000) return;
  lastAnnounceTime = now;

  const announcer = document.getElementById('a11y-announcer');
  if (announcer) {
    announcer.textContent = msg;
  }
}

/**
 * Safely renders text inside a target DOM node without innerHTML.
 * @param {string} id - Target DOM element ID.
 * @param {string} text - Clean string.
 */
function setSafeText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = String(text);
  }
}

/**
 * Displays an ephemeral status or alert banner above the main application grid.
 * Configures text content, ARIA alert role visibility, error styling, and handles auto-dismiss timers.
 * @param {string} message - Feedback message text to render.
 * @param {boolean} [isError=false] - Whether the notification signifies an error or degradation alert.
 * @param {number} [timeoutMs=0] - Milliseconds before auto-dismissal; 0 persists until dismissed.
 */
export function showStatusBanner(message, isError = false, timeoutMs = 0) {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('status-banner');
  if (!banner) return;

  banner.textContent = String(message);
  banner.classList.remove('hidden');

  if (isError) {
    banner.classList.add('status-banner-error');
  } else {
    banner.classList.remove('status-banner-error');
  }

  if (typeof window !== 'undefined') {
    if (window._bannerTimer) {
      clearTimeout(window._bannerTimer);
      window._bannerTimer = null;
    }
    if (timeoutMs > 0) {
      window._bannerTimer = setTimeout(() => {
        hideStatusBanner();
      }, timeoutMs);
    }
  }
}

/**
 * Hides the active status banner immediately and cancels any pending auto-dismiss timer.
 */
export function hideStatusBanner() {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById('status-banner');
  if (banner) {
    banner.classList.add('hidden');
    banner.classList.remove('status-banner-error');
  }
  if (typeof window !== 'undefined' && window._bannerTimer) {
    clearTimeout(window._bannerTimer);
    window._bannerTimer = null;
  }
}

/**
 * Updates live scrubber telemetry badge with effective AQI and trap/dispersal status.
 * @param {number|null} [hour] - Hour decimal.
 */
export function updateScrubberTelemetry(hour) {
  const h = hour !== null && hour !== undefined ? Number(hour) : 7.5;
  const inv = getDiurnalInversion(h, state.aqi);
  const phaseText = inv.phase === 'SOLAR_DISPERSAL' ? 'Safe' : 'Trap';
  setSafeText('label-scrubber-telemetry', `AQI ${inv.effectiveAQI} (${inv.multiplier.toFixed(2)}x ${phaseText})`);
}

/**
 * Clears and replaces child nodes using safe DOM APIs.
 * @param {HTMLElement} parent - Container element.
 * @param {HTMLElement[]} children - Array of new element nodes.
 */
function replaceChildrenSafe(parent, children) {
  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }
  for (let i = 0; i < children.length; i++) {
    parent.appendChild(children[i]);
  }
}

/**
 * Updates UI view based on current state and active CleanAir plan.
 * Conforms to Zero-XSS policy using textContent and createElement exclusively.
 */
export function renderActivePlan() {
  if (typeof document === 'undefined') return;
  const plan = state.activePlan;
  if (!plan) return;

  fastDom.mutate(() => {
    // 1. Severity & Notice
    setSafeText('hero-severity-badge', plan.severityLevel);
    setSafeText('hero-aqi-number', String(state.aqi));
    setSafeText('hero-inversion-notice', plan.diurnalWindowNotice);

    const unshieldedCp = aqiToMassConcentration(state.aqi);
    const alphaInf = getHousingInfiltrationCoefficient(state.housingType);
    const dailyVolumeM3 = 10.8;
    const alveolarDeposition = 0.28;
    const vulnMult = getVulnerabilityMultiplier(state.vulnBits);
    const unshieldedDose = Math.max(10, Math.round(unshieldedCp * (alphaInf * 0.75 + 1.0 * 0.25) * dailyVolumeM3 * 1.3 * alveolarDeposition * vulnMult));

    const shieldEfficiency = 0.8041;
    const protectedDose = Math.max(5, Math.round(unshieldedDose * (1 - shieldEfficiency)));
    const avoidedUg = unshieldedDose - protectedDose;
    const reductionPct = Math.min(99.9, Math.max(0, ((unshieldedDose - protectedDose) / unshieldedDose) * 100));

    const unshieldedCigs = dosageToCigarettes(unshieldedDose);
    const protectedCigs = dosageToCigarettes(protectedDose);
    const avoidedCigs = Math.max(0, unshieldedCigs - protectedCigs);

    setSafeText('metric-pm25-avoided', `${Math.round(avoidedUg)} µg`);
    setSafeText('metric-cigarettes-avoided', `${avoidedCigs.toFixed(1)} Cigs`);
    setSafeText('metric-carbon-saved', `${plan.quantifiedImpact.co2eSavedKg} kg`);
    setSafeText('metric-protection-score', `${plan.quantifiedImpact.protectionScorePercent}%`);

    setSafeText('badge-shield-reduction', `-${reductionPct.toFixed(1)}% Inhaled Dose`);
    setSafeText('badge-shield-delta', `Saved: ${avoidedUg} µg (${avoidedCigs.toFixed(1)} Cigs)`);
    setSafeText('text-unshielded-dose', `${Math.round(unshieldedDose)} µg (${unshieldedCigs.toFixed(1)} Cigs)`);
    setSafeText('text-protected-dose', `${Math.round(protectedDose)} µg (${protectedCigs.toFixed(1)} Cigs)`);

    const barProtected = document.getElementById('bar-protected-dose');
    if (barProtected) {
      const protectedWidth = Math.max(4, Math.min(100, (protectedDose / unshieldedDose) * 100));
      barProtected.style.width = `${protectedWidth.toFixed(1)}%`;
    }

    const housingLabel = (state.housingType || 'standard_flat').replace(/_/g, ' ');
    const commuteLabel = (state.commuteMode || 'two_wheeler').replace(/_/g, ' ');
    setSafeText('label-unshielded-desc', `🔴 Unshielded Exposure (${housingLabel} / ${commuteLabel})`);

    // 3. Hourly Schedule List
    const scheduleContainer = document.getElementById('hourly-schedule-container');
    if (scheduleContainer && plan.hourlyRoutines) {
      const routineNodes = plan.hourlyRoutines.map((routine) => {
        const card = document.createElement('div');
        card.className = 'schedule-slot-card';

        const timeHeader = document.createElement('div');
        timeHeader.className = 'schedule-slot-header';

        const timeBadge = document.createElement('span');
        timeBadge.className = 'time-badge';
        timeBadge.textContent = routine.timeSlot;

        const actionTag = document.createElement('span');
        actionTag.className = `action-tag tag-${routine.actionType.toLowerCase()}`;
        actionTag.textContent = routine.actionType.replace('_', ' ');

        timeHeader.appendChild(timeBadge);
        timeHeader.appendChild(actionTag);

        const activityTitle = document.createElement('h4');
        activityTitle.className = 'schedule-activity-title';
        activityTitle.textContent = routine.activity;

        const recBody = document.createElement('p');
        recBody.className = 'schedule-rec-text';
        recBody.textContent = routine.recommendation;

        card.appendChild(timeHeader);
        card.appendChild(activityTitle);
        card.appendChild(recBody);
        return card;
      });
      replaceChildrenSafe(scheduleContainer, routineNodes);
    }

    // 4. IAQ DIY Hack
    if (plan.iaqHack) {
      setSafeText('iaq-hack-title', plan.iaqHack.title);
      setSafeText('iaq-hack-cadr', `CADR: ${plan.iaqHack.cadrEstimate}`);
      setSafeText('iaq-hack-cost', `Cost: ${plan.iaqHack.costEstimate}`);

      const materialsContainer = document.getElementById('iaq-hack-materials');
      if (materialsContainer && plan.iaqHack.materials) {
        const matItems = plan.iaqHack.materials.map((m) => {
          const li = document.createElement('li');
          li.textContent = m;
          return li;
        });
        replaceChildrenSafe(materialsContainer, matItems);
      }

      const stepsContainer = document.getElementById('iaq-hack-steps');
      if (stepsContainer && plan.iaqHack.steps) {
        const stepItems = plan.iaqHack.steps.map((step, idx) => {
          const li = document.createElement('li');
          li.textContent = `${idx + 1}. ${step}`;
          return li;
        });
        replaceChildrenSafe(stepsContainer, stepItems);
      }
    }

    if (plan.cleaningProtocol) {
      const badgeCleaning = document.getElementById('badge-cleaning-status');
      if (badgeCleaning) {
        badgeCleaning.textContent = plan.cleaningProtocol.statusBadge;
        if (plan.cleaningProtocol.isTriggered) {
          badgeCleaning.style.background = '#ef4444';
          badgeCleaning.style.color = '#ffffff';
        } else {
          badgeCleaning.style.background = '#10b981';
          badgeCleaning.style.color = '#ffffff';
        }
      }
      setSafeText('cleaning-warning-text', plan.cleaningProtocol.warning);
      setSafeText('cleaning-rec-text', plan.cleaningProtocol.recommendation);
      setSafeText('cleaning-formula-text', plan.cleaningProtocol.surfactantRatio);
    }

    // 5. Sustainable Alternatives
    const altContainer = document.getElementById('alternatives-container');
    if (altContainer && plan.sustainableAlternatives) {
      const altNodes = plan.sustainableAlternatives.map((alt) => {
        const altCard = document.createElement('div');
        altCard.className = 'alt-card';

        const category = document.createElement('div');
        category.className = 'alt-category';
        category.textContent = alt.category;

        const compareRow = document.createElement('div');
        compareRow.className = 'alt-compare-row';

        const currentSpan = document.createElement('span');
        currentSpan.className = 'alt-current';
        currentSpan.textContent = `Current: ${alt.currentChoice}`;

        const cleanSpan = document.createElement('span');
        cleanSpan.className = 'alt-clean';
        cleanSpan.textContent = `Shift: ${alt.cleanAlternative}`;

        compareRow.appendChild(currentSpan);
        compareRow.appendChild(cleanSpan);

        const benefit = document.createElement('p');
        benefit.className = 'alt-benefit-text';
        benefit.textContent = alt.benefit;

        altCard.appendChild(category);
        altCard.appendChild(compareRow);
        altCard.appendChild(benefit);
        return altCard;
      });
      replaceChildrenSafe(altContainer, altNodes);
    }

    // 6. Strategy Badge
    setSafeText('active-engine-badge', state.activeStrategy);

    // Announce to screen reader
    announceA11y(`Clean air plan updated. Current AQI ${state.aqi}, ${plan.severityLevel}. ${plan.quantifiedImpact.pm25InhalationAvoidedMicrograms} micrograms avoided today.`);
  });
}

let debounceTimer = null;
let activeAbortController = null;
let pendingGenerationContext = null;
let generationSequenceId = 0;
let optimisticRafId = null;

/**
 * Safely retrieves an item from sessionStorage with fallback for restricted environments.
 * @param {string} key - Cache storage key.
 * @returns {string|null}
 */
export function safeSessionGet(key) {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Safely writes an item to sessionStorage with fallback for quota or security exceptions.
 * @param {string} key - Cache storage key.
 * @param {string} value - String value to persist.
 * @returns {boolean}
 */
export function safeSessionSet(key, value) {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Checks W3C Geolocation permission state without prompting the user.
 * @returns {Promise<'granted'|'prompt'|'denied'|'unsupported'>}
 */
export async function checkGeolocationPermission() {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

/**
 * Formats OpenStreetMap Nominatim reverse geocode payload into a clean micro-location string.
 * @param {Object} data - Nominatim reverse geocode response object.
 * @returns {string|null}
 */
export function extractAreaNameFromNominatim(data) {
  if (!data || !data.address) return null;
  const addr = data.address;
  const primary = addr.suburb || addr.neighbourhood || addr.city_district || addr.subdistrict || addr.residential || addr.locality || addr.village || addr.town || addr.city;
  const secondary = addr.city || addr.town || addr.state_district || addr.county || addr.state;
  if (primary && secondary && primary !== secondary) {
    return `${primary}, ${secondary}`;
  }
  return primary || secondary || (data.display_name ? data.display_name.split(',')[0] : null);
}

/**
 * Reverse geocodes geographic coordinates with dual-provider cascade and strict timeout.
 * @param {number} lat - Latitude in decimal degrees.
 * @param {number} lon - Longitude in decimal degrees.
 * @param {number} [timeoutMs=2000] - Network timeout limit in milliseconds.
 * @returns {Promise<string|null>}
 */
export async function reverseGeocodeNominatim(lat, lon, timeoutMs = 2000) {
  const safeLat = Math.round(lat * 1000) / 1000;
  const safeLon = Math.round(lon * 1000) / 1000;
  const cacheKey = `geo_${safeLat}_${safeLon}`;
  const cached = safeSessionGet(cacheKey);
  if (cached) return cached;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${safeLat}&longitude=${safeLon}&localityLanguage=en`;
    const resp = await fetch(bdcUrl, {
      signal: controller ? controller.signal : undefined,
      headers: { 'Accept': 'application/json' }
    });
    if (resp.ok) {
      const data = await resp.json();
      const area = data.locality || data.city || data.principalSubdivision;
      const sub = data.principalSubdivision;
      let formatted = null;
      if (area && sub && area !== sub) {
        formatted = `${area}, ${sub}`;
      } else {
        formatted = area || sub || null;
      }
      if (formatted) {
        safeSessionSet(cacheKey, formatted);
        if (timer) clearTimeout(timer);
        return formatted;
      }
    }
  } catch {
  }

  try {
    const osmUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${safeLat}&lon=${safeLon}&zoom=14&addressdetails=1`;
    const resp = await fetch(osmUrl, {
      signal: controller ? controller.signal : undefined,
      headers: { 'Accept': 'application/json' }
    });
    if (resp.ok) {
      const data = await resp.json();
      const extracted = extractAreaNameFromNominatim(data);
      if (extracted) {
        safeSessionSet(cacheKey, extracted);
        if (timer) clearTimeout(timer);
        return extracted;
      }
    }
  } catch {
  } finally {
    if (timer) clearTimeout(timer);
  }

  return null;
}

/**
 * Injects or updates dynamic location option in city select dropdown and commits to state.
 * @param {string} areaName - Formatted localized area name.
 * @param {number} lat - Latitude in decimal degrees.
 * @param {number} lon - Longitude in decimal degrees.
 * @param {Object} nearestBasin - Meteorological air basin reference.
 */
export function setDynamicLocation(areaName, lat, lon, nearestBasin) {
  state.city = areaName;
  state.nearestBasin = nearestBasin;
  state.userCoordinates = { latitude: lat, longitude: lon };

  if (typeof document === 'undefined') return;
  const citySelect = document.getElementById('input-city');
  if (!citySelect) return;

  let optgroup = document.getElementById('optgroup-detected');
  if (!optgroup) {
    optgroup = document.createElement('optgroup');
    optgroup.id = 'optgroup-detected';
    optgroup.label = 'Detected Location';
    citySelect.insertBefore(optgroup, citySelect.firstChild);
  }

  let opt = document.getElementById('opt-dynamic-city');
  if (!opt) {
    opt = document.createElement('option');
    opt.id = 'opt-dynamic-city';
    optgroup.appendChild(opt);
  }

  opt.value = areaName;
  opt.textContent = `${areaName} (Live GPS)`;
  opt.selected = true;
  citySelect.value = areaName;

  syncUrlHash();
  schedulePlanGeneration(0);
}

/**
 * Detects user coordinates, executes reverse geocoding, and updates application location state.
 * @param {{isSilent?: boolean, timeoutMs?: number, reverseGeocodeTimeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export async function detectUserLocation(options = {}) {
  const isSilent = options.isSilent || false;
  const timeoutMs = options.timeoutMs || 8000;
  const reverseGeocodeTimeoutMs = options.reverseGeocodeTimeoutMs || 2000;

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    if (!isSilent) showStatusBanner('Geolocation API is not supported in this browser.', true, 4000);
    return false;
  }

  const btnDetect = typeof document !== 'undefined' ? document.getElementById('btn-detect-location') : null;
  if (btnDetect) btnDetect.disabled = true;
  if (!isSilent) showStatusBanner('Acquiring high-precision GPS coordinates...', false, 0);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (btnDetect) btnDetect.disabled = false;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const nearest = findNearestBasin(lat, lon, METRO_BASIN_COORDINATES);

        let areaName = null;
        try {
          areaName = await reverseGeocodeNominatim(lat, lon, reverseGeocodeTimeoutMs);
        } catch {
          areaName = null;
        }

        const resolvedName = areaName || (nearest ? nearest.name : 'Custom Location');
        setDynamicLocation(resolvedName, lat, lon, nearest);

        if (!isSilent) {
          const distanceStr = nearest ? ` (Airshed: ${nearest.name}, ${nearest.distanceKm} km)` : '';
          showStatusBanner(`Auto-detected: ${resolvedName}${distanceStr}`, false, 3500);
        }
        resolve(true);
      },
      () => {
        if (btnDetect) btnDetect.disabled = false;
        if (!isSilent) {
          showStatusBanner('Location access denied or timed out. Keeping preset.', true, 3500);
        }
        resolve(false);
      },
      { timeout: timeoutMs, enableHighAccuracy: true, maximumAge: 60000 }
    );
  });
}

/**
 * Coalesces synchronous local preview calculations using requestAnimationFrame.
 */
export function scheduleOptimisticPlanRender() {
  if (typeof window === 'undefined') {
    executeOptimisticRecalculation();
    return;
  }
  if (optimisticRafId) {
    cancelAnimationFrame(optimisticRafId);
  }
  optimisticRafId = requestAnimationFrame(() => {
    optimisticRafId = null;
    executeOptimisticRecalculation();
  });
}

/**
 * Executes immediate deterministic mathematical recalculation and updates active plan.
 */
export function executeOptimisticRecalculation() {
  state.hackId = state.activeHackId;
  state.lang = state.advisoryLang;

  const currentCp = aqiToMassConcentration(state.aqi);
  diurnalHistory.push(currentCp);

  const localPlan = generateOfflineCleanAirPlan(state);
  if (state.activeStrategy !== 'GEMINI_2_5_FLASH_LIVE') {
    state.activePlan = localPlan;
    state.activeStrategy = 'OFFLINE_DETERMINISTIC';
  } else if (!state.activePlan) {
    state.activePlan = localPlan;
  }

  renderActivePlan();
}

/**
 * Schedules debounced plan generation with immediate local recalculation.
 * @param {number} [delayMs=250] - Debounce interval in milliseconds.
 */
export function schedulePlanGeneration(delayMs = 250) {
  scheduleOptimisticPlanRender();

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (delayMs <= 0) {
    triggerPlanGeneration();
    return;
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    triggerPlanGeneration();
  }, delayMs);
}

/**
 * Dispatches plan generation and triggers UI reconciliation with concurrency preemption.
 * @param {Object} [overrideContext=null] - Optional context override.
 * @returns {Promise<void>}
 */
export async function triggerPlanGeneration(overrideContext = null) {
  const currentSeq = ++generationSequenceId;
  const ctx = overrideContext ? { ...overrideContext } : { ...state };
  ctx.hackId = state.activeHackId;
  ctx.lang = state.advisoryLang;

  if (activeAbortController) {
    activeAbortController.abort('SUPERSEDED');
    activeAbortController = null;
  }

  const hasApiKey = keyStore.hasKey();
  if (!hasApiKey) {
    executeOptimisticRecalculation();
    globalEventBus.emit('CONTEXT_CHANGED', state);
    globalEventBus.emit('PLAN_GENERATED', state.activePlan);
    return;
  }

  const isCircuitOpen = planProvider.circuitBreaker && (
    typeof planProvider.circuitBreaker.getState === 'function'
      ? planProvider.circuitBreaker.getState() === 'OPEN'
      : planProvider.circuitBreaker.state === 'OPEN'
  );
  if (isCircuitOpen) {
    executeOptimisticRecalculation();
    showStatusBanner('Gemini API rate limit paused. Serving deterministic offline plan.', true, 4000);
    return;
  }

  const controller = new AbortController();
  activeAbortController = controller;

  const btnGenerate = typeof document !== 'undefined' ? document.getElementById('btn-generate-plan') : null;
  const spinner = typeof document !== 'undefined' ? document.getElementById('plan-spinner') : null;
  const scheduleContainer = typeof document !== 'undefined' ? document.getElementById('hourly-schedule-container') : null;

  if (btnGenerate) {
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Refining AI Plan... ✨';
  }
  if (spinner) {
    spinner.classList.remove('hidden');
    spinner.classList.add('plan-spinner-active');
  }
  if (scheduleContainer) {
    scheduleContainer.classList.add('plan-loading-shimmer');
  }

  const currentCp = aqiToMassConcentration(ctx.aqi);
  diurnalHistory.push(currentCp);
  globalEventBus.emit('CONTEXT_CHANGED', ctx);

  try {
    const result = await planProvider.getPlan(ctx, { signal: controller.signal });
    if (currentSeq !== generationSequenceId) return;

    state.activePlan = result.plan;
    state.activeStrategy = result.strategy;

    if (state.activePlan && state.activePlan.bilingualAdvisory && state.activePlan.bilingualAdvisory[state.advisoryLang]) {
      state.activePlan.communityAdvisory = state.activePlan.bilingualAdvisory[state.advisoryLang];
    }

    renderActivePlan();
    globalEventBus.emit('PLAN_GENERATED', state.activePlan);

    if (result.warning) {
      showStatusBanner(result.warning, true, 6000);
    } else {
      hideStatusBanner();
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.message === 'SUPERSEDED' || controller.signal.aborted)) {
      return;
    }
    executeOptimisticRecalculation();
    globalEventBus.emit('PLAN_ERROR', err);
  } finally {
    if (currentSeq === generationSequenceId) {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
      if (spinner) {
        spinner.classList.add('hidden');
        spinner.classList.remove('plan-spinner-active');
      }
      if (scheduleContainer) {
        scheduleContainer.classList.remove('plan-loading-shimmer');
      }
      if (btnGenerate) {
        btnGenerate.disabled = false;
        btnGenerate.textContent = 'Generate Clean Air Plan';
      }
      if (pendingGenerationContext) {
        const nextCtx = pendingGenerationContext;
        pendingGenerationContext = null;
        triggerPlanGeneration(nextCtx);
      }
    }
  }
}

/**
 * Synchronizes browser URL hash with current 5-byte encoded state.
 */
export function syncUrlHash() {
  const hash = contextToHashToken(state);
  if (window.location.hash !== '#' + hash) {
    window.history.replaceState(null, '', '#' + hash);
  }
}

/**
 * Applies a ground-truth quantitative target persona from docs/00 §5.
 *
 * @param {string} personaId - Ananya | Rajesh | Vikram | Ramesh.
 */
export function applyPersona(personaId) {
  const p = TARGET_PERSONAS[personaId];
  if (!p) return;

  state.city = p.city;
  state.aqi = p.aqi;
  state.vulnBits = p.vulnBits;
  state.housingType = p.housingType;
  state.cookingMethod = p.cookingMethod;
  state.heatingMethod = p.heatingMethod;
  state.commuteMode = p.commuteMode;
  state.commuteKm = p.commuteKm;

  const citySelect = document.getElementById('input-city');
  if (citySelect) citySelect.value = p.city;

  const aqiSlider = document.getElementById('input-aqi-slider');
  const aqiNumberInput = document.getElementById('input-aqi-number');
  if (aqiSlider) aqiSlider.value = String(p.aqi);
  if (aqiNumberInput) aqiNumberInput.value = String(p.aqi);

  const housingSelect = document.getElementById('select-housing-type');
  if (housingSelect) housingSelect.value = p.housingType;

  const cookRadio = document.querySelector(`input[name="radio-cooking"][value="${p.cookingMethod}"]`);
  if (cookRadio) cookRadio.checked = true;

  const heatRadio = document.querySelector(`input[name="radio-heating"][value="${p.heatingMethod}"]`);
  if (heatRadio) heatRadio.checked = true;

  const commuteRadio = document.querySelector(`input[name="radio-commute"][value="${p.commuteMode}"]`);
  if (commuteRadio) commuteRadio.checked = true;

  const commuteKmSlider = document.getElementById('input-commute-km');
  const commuteKmLabel = document.getElementById('label-commute-km');
  if (commuteKmSlider) commuteKmSlider.value = String(p.commuteKm);
  if (commuteKmLabel) commuteKmLabel.textContent = `${p.commuteKm} km`;

  const vulnCheckboxes = document.querySelectorAll('.input-vuln-checkbox');
  vulnCheckboxes.forEach((cb) => {
    const bit = Number(cb.getAttribute('data-bit'));
    cb.checked = (p.vulnBits & bit) !== 0;
  });

  syncUrlHash();
  renderDiurnalSplineCurve();
  updateScrubberTelemetry(state.simulatedHour);
  schedulePlanGeneration(0);
  announceA11y(`Loaded target persona ${p.name}. City ${p.city}, AQI ${p.aqi}.`);
}

/**
 * Initializes DOM listeners and hydrates state from initial URL hash.
 */
export function initApp() {
  if (window.location.hash && window.location.hash.length > 3) {
    const hydrated = hashTokenToContext(window.location.hash);
    state.city = hydrated.city;
    state.aqi = hydrated.aqi;
    state.vulnBits = hydrated.vulnBits;
    state.cookingMethod = hydrated.cookingMethod;
    state.heatingMethod = hydrated.heatingMethod;
    state.commuteMode = hydrated.commuteMode;
    state.commuteKm = hydrated.commuteKm;
    state.simulatedHour = hydrated.simulatedHour;
  }

  const citySelect = document.getElementById('input-city');
  if (citySelect) {
    while (citySelect.firstChild) {
      citySelect.removeChild(citySelect.firstChild);
    }

    if (state.city && !METRO_BASIN_PRESETS.includes(state.city)) {
      const optgroupDetected = document.createElement('optgroup');
      optgroupDetected.id = 'optgroup-detected';
      optgroupDetected.label = 'Detected Location';
      const optDynamic = document.createElement('option');
      optDynamic.id = 'opt-dynamic-city';
      optDynamic.value = state.city;
      optDynamic.textContent = `${state.city} (Live GPS)`;
      optDynamic.selected = true;
      optgroupDetected.appendChild(optDynamic);
      citySelect.appendChild(optgroupDetected);
    }

    const optgroupPresets = document.createElement('optgroup');
    optgroupPresets.id = 'optgroup-presets';
    optgroupPresets.label = 'Metro Basin Presets';

    for (let i = 0; i < METRO_BASIN_PRESETS.length; i++) {
      const opt = document.createElement('option');
      opt.value = METRO_BASIN_PRESETS[i];
      opt.textContent = METRO_BASIN_PRESETS[i];
      if (METRO_BASIN_PRESETS[i] === state.city) opt.selected = true;
      optgroupPresets.appendChild(opt);
    }
    citySelect.appendChild(optgroupPresets);

    citySelect.addEventListener('change', (e) => {
      state.city = e.target.value;
      syncUrlHash();
      schedulePlanGeneration(0);
    });
  }

  const aqiSlider = document.getElementById('input-aqi-slider');
  const aqiNumberInput = document.getElementById('input-aqi-number');
  if (aqiSlider) {
    aqiSlider.value = String(state.aqi);
    if (aqiNumberInput) aqiNumberInput.value = String(state.aqi);

    aqiSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.aqi = val;
      setAqiSignal(val);
      if (aqiNumberInput) aqiNumberInput.value = String(val);
      syncUrlHash();
      renderDiurnalSplineCurve();
      updateScrubberTelemetry(state.simulatedHour);
      schedulePlanGeneration(250);
    });

    aqiSlider.addEventListener('change', () => {
      announceA11y(`AQI adjusted to ${state.aqi}`);
    });
  }

  if (aqiNumberInput) {
    aqiNumberInput.addEventListener('input', (e) => {
      const val = Math.max(10, Math.min(800, Number(e.target.value) || 10));
      state.aqi = val;
      setAqiSignal(val);
      if (aqiSlider) aqiSlider.value = String(val);
      syncUrlHash();
      renderDiurnalSplineCurve();
      updateScrubberTelemetry(state.simulatedHour);
      schedulePlanGeneration(250);
    });

    aqiNumberInput.addEventListener('change', () => {
      announceA11y(`AQI adjusted to ${state.aqi}`);
    });
  }

  const timeSlider = document.getElementById('input-time-slider');
  const timeLabel = document.getElementById('label-time-value');
  if (timeSlider) {
    timeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.simulatedHour = val;
      setTimeSignal(val);
      const hours = Math.floor(val);
      const mins = Math.floor((val - hours) * 60);
      const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      if (timeLabel) timeLabel.textContent = timeStr;
      
      const needle = document.getElementById('svg-time-needle');
      if (needle) {
        const x = (val / 24) * 240;
        needle.setAttribute('x1', String(x));
        needle.setAttribute('x2', String(x));
      }
      updateSplineMarker(val);
      updateScrubberTelemetry(val);
      syncUrlHash();
      schedulePlanGeneration(250);
    });

    timeSlider.addEventListener('change', () => {
      announceA11y(`Simulated time set to ${timeLabel?.textContent || ''}`);
    });
  }

  const housingSelect = document.getElementById('select-housing-type');
  if (housingSelect) {
    housingSelect.value = state.housingType;
    housingSelect.addEventListener('change', (e) => {
      state.housingType = e.target.value;
      globalEventBus.emit('CONTEXT_UPDATED', state);
      syncUrlHash();
      schedulePlanGeneration(250);
    });
  }

  const cookingRadios = document.querySelectorAll('input[name="radio-cooking"]');
  cookingRadios.forEach((r) => {
    r.checked = r.value === state.cookingMethod;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.cookingMethod = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        schedulePlanGeneration(250);
      }
    });
  });

  const heatingRadios = document.querySelectorAll('input[name="radio-heating"]');
  heatingRadios.forEach((r) => {
    r.checked = r.value === state.heatingMethod;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.heatingMethod = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        schedulePlanGeneration(250);
      }
    });
  });

  const commuteRadios = document.querySelectorAll('input[name="radio-commute"]');
  commuteRadios.forEach((r) => {
    r.checked = r.value === state.commuteMode;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.commuteMode = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        schedulePlanGeneration(250);
      }
    });
  });

  const commuteKmSlider = document.getElementById('input-commute-km');
  const commuteKmLabel = document.getElementById('label-commute-km');
  if (commuteKmSlider) {
    commuteKmSlider.value = String(state.commuteKm);
    if (commuteKmLabel) commuteKmLabel.textContent = `${state.commuteKm} km`;

    commuteKmSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.commuteKm = val;
      if (commuteKmLabel) commuteKmLabel.textContent = `${val} km`;
      syncUrlHash();
      schedulePlanGeneration(250);
    });

    commuteKmSlider.addEventListener('change', () => {
      announceA11y(`Commute distance set to ${state.commuteKm} km`);
    });
  }

  const vulnCheckboxes = document.querySelectorAll('.input-vuln-checkbox');
  vulnCheckboxes.forEach((cb) => {
    const bit = Number(cb.getAttribute('data-bit'));
    cb.checked = (state.vulnBits & bit) !== 0;

    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.vulnBits |= bit;
      } else {
        state.vulnBits &= ~bit;
      }
      syncUrlHash();
      schedulePlanGeneration(250);
    });
  });

  const btnGenerate = document.getElementById('btn-generate-plan');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => schedulePlanGeneration(0));
  }

  const btnCopyWhatsApp = document.getElementById('btn-copy-advisory');
  if (btnCopyWhatsApp) {
    btnCopyWhatsApp.addEventListener('click', async () => {
      if (state.activePlan && state.activePlan.communityAdvisory) {
        const advisoryText = state.activePlan.communityAdvisory;
        const currentUrl = window.location.href;
        if (typeof navigator !== 'undefined' && navigator.share) {
          try {
            await navigator.share({
              title: 'CleanAir Guardian (VayuRakshak) Advisory',
              text: advisoryText,
              url: currentUrl
            });
            btnCopyWhatsApp.textContent = 'Shared Successfully! ✓';
            setTimeout(() => {
              btnCopyWhatsApp.textContent = 'Share / Copy WhatsApp Advisory';
            }, 2500);
            return;
          } catch (e) {
          }
        }
        await navigator.clipboard.writeText(`${advisoryText}\n\nLive Plan: ${currentUrl}`);
        btnCopyWhatsApp.textContent = 'Copied to Clipboard! ✓';
        setTimeout(() => {
          btnCopyWhatsApp.textContent = 'Share / Copy WhatsApp Advisory';
        }, 2000);
      }
    });
  }

  const btnToggleLang = document.getElementById('btn-toggle-lang');
  const labelCurrentLang = document.getElementById('label-current-lang');
  if (btnToggleLang) {
    btnToggleLang.addEventListener('click', () => {
      state.advisoryLang = state.advisoryLang === 'en' ? 'hi' : 'en';
      if (labelCurrentLang) {
        labelCurrentLang.textContent = state.advisoryLang === 'en' ? 'English' : 'हिन्दी';
      }
      if (state.activePlan && state.activePlan.bilingualAdvisory) {
        state.activePlan.communityAdvisory = state.activePlan.bilingualAdvisory[state.advisoryLang];
      }
      announceA11y(`Advisory language set to ${state.advisoryLang === 'en' ? 'English' : 'Hindi'}`);
    });
  }

  const btnPrintProtocol = document.getElementById('btn-print-protocol');
  if (btnPrintProtocol) {
    btnPrintProtocol.addEventListener('click', () => {
      window.print();
    });
  }

  const btnCopyLink = document.getElementById('btn-copy-link');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
      const currentUrl = window.location.href;
      try {
        await navigator.clipboard.writeText(currentUrl);
        btnCopyLink.textContent = 'Copied! ✓';
        setTimeout(() => {
          btnCopyLink.textContent = 'Link 🔗';
        }, 2000);
        announceA11y('Shareable clean air link copied to clipboard.');
      } catch (e) {
      }
    });
  }

  const personaButtons = document.querySelectorAll('.btn-persona');
  personaButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const personaId = btn.getAttribute('data-persona');
      applyPersona(personaId);
    });
  });

  const hackTabs = document.querySelectorAll('.hack-tab-btn');
  hackTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const hackId = tab.getAttribute('data-hack');
      if (!hackId || !IAQ_HACKS_CATALOG[hackId]) return;

      state.activeHackId = hackId;
      hackTabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle('active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });

      const cadrSelect = document.getElementById('select-cadr-device');
      const hackDef = IAQ_HACKS_CATALOG[hackId];
      if (cadrSelect && hackDef) {
        cadrSelect.value = String(hackDef.cadrCfm);
        updateRoomCadr();
      }

      schedulePlanGeneration(250);
    });
  });

  const btnDetectLocation = document.getElementById('btn-detect-location');
  if (btnDetectLocation) {
    btnDetectLocation.addEventListener('click', () => {
      detectUserLocation({ isSilent: false });
    });
  }

  let cadrUnit = 'ft';

  function updateRoomCadr() {
    const lengthInput = document.getElementById('input-room-l');
    const widthInput = document.getElementById('input-room-w');
    const heightInput = document.getElementById('input-room-h');
    const cadrSelect = document.getElementById('select-cadr-device');
    const customContainer = document.getElementById('container-cadr-custom');
    const customInput = document.getElementById('input-cadr-custom');

    if (!lengthInput || !widthInput || !heightInput || !cadrSelect) return;

    let cadrCfm = 273;
    if (cadrSelect.value === 'custom') {
      if (customContainer) customContainer.style.display = 'flex';
      cadrCfm = Math.max(5, Number(customInput?.value) || 200);
    } else {
      if (customContainer) customContainer.style.display = 'none';
      cadrCfm = Number(cadrSelect.value) || 273;
    }

    const length = Number(lengthInput.value) || (cadrUnit === 'ft' ? 14 : 4.27);
    const width = Number(widthInput.value) || (cadrUnit === 'ft' ? 12 : 3.66);
    const height = Number(heightInput.value) || (cadrUnit === 'ft' ? 9 : 2.74);

    let volumeFt3, volumeM3;
    if (cadrUnit === 'ft') {
      volumeFt3 = length * width * height;
      volumeM3 = volumeFt3 * UNIT_CONVERSIONS.FT3_TO_M3;
    } else {
      volumeM3 = length * width * height;
      volumeFt3 = volumeM3 * UNIT_CONVERSIONS.M3_TO_FT3;
    }

    setSafeText('cadr-room-volume', `Volume: ${Math.round(volumeFt3).toLocaleString()} ft³ (${volumeM3.toFixed(1)} m³)`);

    const result = calculateRoomClearance({ length, width, height, unit: cadrUnit, cadrCfm });

    setSafeText('badge-cadr-ach', `${result.achClean} ACH`);
    setSafeText('cadr-t50', `${result.t50Min} min`);
    setSafeText('cadr-t90', `${result.t90Min} min`);
    setSafeText('cadr-t99', `${result.t99Min} min`);

    const adequacy = getCadrAdequacyRating(result.achTotal);
    const badgeGuideline = document.getElementById('badge-cadr-guideline');
    if (badgeGuideline) {
      badgeGuideline.textContent = adequacy.label;
      badgeGuideline.style.background = adequacy.color;
    }
  }

  const btnUnitFt = document.getElementById('btn-unit-ft');
  const btnUnitM = document.getElementById('btn-unit-m');
  const labelRoomL = document.getElementById('label-room-l');
  const labelRoomW = document.getElementById('label-room-w');
  const labelRoomH = document.getElementById('label-room-h');
  const inputRoomL = document.getElementById('input-room-l');
  const inputRoomW = document.getElementById('input-room-w');
  const inputRoomH = document.getElementById('input-room-h');

  if (btnUnitFt && btnUnitM) {
    btnUnitFt.addEventListener('click', () => {
      if (cadrUnit === 'ft') return;
      cadrUnit = 'ft';
      btnUnitFt.classList.add('active');
      btnUnitFt.setAttribute('aria-pressed', 'true');
      btnUnitM.classList.remove('active');
      btnUnitM.setAttribute('aria-pressed', 'false');

      if (labelRoomL) labelRoomL.textContent = 'Length (ft)';
      if (labelRoomW) labelRoomW.textContent = 'Width (ft)';
      if (labelRoomH) labelRoomH.textContent = 'Height (ft)';

      if (inputRoomL) inputRoomL.value = String(Math.round(Number(inputRoomL.value) * UNIT_CONVERSIONS.M_TO_FT * 10) / 10);
      if (inputRoomW) inputRoomW.value = String(Math.round(Number(inputRoomW.value) * UNIT_CONVERSIONS.M_TO_FT * 10) / 10);
      if (inputRoomH) inputRoomH.value = String(Math.round(Number(inputRoomH.value) * UNIT_CONVERSIONS.M_TO_FT * 10) / 10);

      updateRoomCadr();
      schedulePlanGeneration(250);
      announceA11y('CADR calculator switched to feet.');
    });

    btnUnitM.addEventListener('click', () => {
      if (cadrUnit === 'm') return;
      cadrUnit = 'm';
      btnUnitM.classList.add('active');
      btnUnitM.setAttribute('aria-pressed', 'true');
      btnUnitFt.classList.remove('active');
      btnUnitFt.setAttribute('aria-pressed', 'false');

      if (labelRoomL) labelRoomL.textContent = 'Length (m)';
      if (labelRoomW) labelRoomW.textContent = 'Width (m)';
      if (labelRoomH) labelRoomH.textContent = 'Height (m)';

      if (inputRoomL) inputRoomL.value = String(Math.round(Number(inputRoomL.value) * UNIT_CONVERSIONS.FT_TO_M * 100) / 100);
      if (inputRoomW) inputRoomW.value = String(Math.round(Number(inputRoomW.value) * UNIT_CONVERSIONS.FT_TO_M * 100) / 100);
      if (inputRoomH) inputRoomH.value = String(Math.round(Number(inputRoomH.value) * UNIT_CONVERSIONS.FT_TO_M * 100) / 100);

      updateRoomCadr();
      schedulePlanGeneration(250);
      announceA11y('CADR calculator switched to meters.');
    });
  }

  const cadrInputs = ['input-room-l', 'input-room-w', 'input-room-h', 'select-cadr-device', 'input-cadr-custom'];
  cadrInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        updateRoomCadr();
        schedulePlanGeneration(250);
      });
      el.addEventListener('change', () => {
        updateRoomCadr();
        schedulePlanGeneration(250);
      });
    }
  });
  updateRoomCadr();

  const inputKey = document.getElementById('input-gemini-key');
  const btnSaveKey = document.getElementById('btn-save-key');
  const btnClearKey = document.getElementById('btn-clear-key');
  const formKey = document.getElementById('form-gemini-key');

  if (formKey && btnSaveKey) {
    formKey.addEventListener('submit', (e) => {
      e.preventDefault();
      btnSaveKey.click();
    });
  }

  if (btnSaveKey && inputKey) {
    btnSaveKey.addEventListener('click', () => {
      keyStore.setKey(inputKey.value);
      inputKey.value = '';
      setSafeText('key-status-text', '🔒 Active (In-Memory Only — Zero Disk Persistence)');
      schedulePlanGeneration(0);
    });
  }

  if (btnClearKey) {
    btnClearKey.addEventListener('click', () => {
      keyStore.purge();
      setSafeText('key-status-text', 'Key Purged (Zeroed in RAM) — Operating in Offline Mode');
      schedulePlanGeneration(0);
    });
  }

  registerServiceWorker('sw.js');
  updateScrubberTelemetry(state.simulatedHour);
  renderDiurnalSplineCurve();
  schedulePlanGeneration(0);

  checkGeolocationPermission().then((status) => {
    if (status === 'granted') {
      detectUserLocation({ isSilent: true });
    }
  });
}

/**
 * Registers Progressive Web App service worker with offline status telemetry.
 * Conforms to LLD 03 §6.2 and W3C Service Worker API standards.
 *
 * @param {string} [swPath='sw.js'] - Path to service worker script.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerServiceWorker(swPath = 'sw.js') {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register(swPath);
      if (reg && typeof reg.update === 'function') {
        reg.update();
      }
      return reg;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Master UI Controller coordinating EventBus, PlanProvider, and DOM reconciliation.
 * Conforms to HLD 02 §2.4 C4 Class Model.
 */
export class AppController {
  /**
   * Initializes AppController with injected dependencies.
   * @param {EventBus} bus - Event bus instance.
   * @param {IPlanProvider} provider - Plan provider instance.
   */
  constructor(bus, provider) {
    this.eventBus = bus;
    this.planProvider = provider;
    this.state = state;
  }

  /**
   * Initializes DOM bindings, event listeners, and default state hydration.
   */
  init() {
    initApp();
  }

  /**
   * Handles user context change events.
   * @param {Event} [e] - DOM event.
   */
  onContextChange(e) {
    syncUrlHash();
    triggerPlanGeneration();
  }

  /**
   * Triggers active plan view reconciliation.
   * @param {Object} [plan] - Action plan to render.
   */
  renderView(plan) {
    if (plan) state.activePlan = plan;
    renderActivePlan();
  }
}

export const appController = new AppController(globalEventBus, planProvider);

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      initApp();
    });
  } else {
    initApp();
  }
}
