/**
 * @fileoverview FastDOM Frame Scheduler, Result Monad, and Zero-XSS UI Controller.
 * Coordinates user input events, micro-reactive signal bindings, URL hash state synchronization,
 * and pure text-node DOM hydration with zero innerHTML usage.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module app
 */

import { VULN_FLAGS, DEFAULT_PRESET, METRO_BASIN_PRESETS } from './config.js';
import { getDiurnalInversion } from './air-quality-engine.js';
import { SecureKeyStore, GeminiPlanProvider } from './gemini-service.js';
import { contextToHashToken, hashTokenToContext } from './state-codec.js';
import { globalEventBus } from './event-bus.js';

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

    requestAnimationFrame(() => {
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
    });
  }
}

export const fastDom = new FastDOMScheduler();
export const keyStore = new SecureKeyStore();
export const planProvider = new GeminiPlanProvider(keyStore);

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
  activeStrategy: 'INITIALIZING'
};

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
  const plan = state.activePlan;
  if (!plan) return;

  fastDom.mutate(() => {
    // 1. Severity & Notice
    setSafeText('hero-severity-badge', plan.severityLevel);
    setSafeText('hero-aqi-number', String(state.aqi));
    setSafeText('hero-inversion-notice', plan.diurnalWindowNotice);

    // 2. Telemetry Metrics
    setSafeText('metric-pm25-avoided', `${plan.quantifiedImpact.pm25InhalationAvoidedMicrograms} µg`);
    setSafeText('metric-cigarettes-avoided', `${plan.quantifiedImpact.cigaretteEquivalentsAvoided} Cigs`);
    setSafeText('metric-carbon-saved', `${plan.quantifiedImpact.co2eSavedKg} kg CO₂e`);
    setSafeText('metric-protection-score', `${plan.quantifiedImpact.protectionScorePercent}%`);

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

/**
 * Dispatches plan generation and triggers UI reconciliation.
 */
export async function triggerPlanGeneration() {
  const spinner = document.getElementById('plan-spinner');
  if (spinner) spinner.classList.remove('hidden');

  try {
    const result = await planProvider.getPlan(state);
    state.activePlan = result.plan;
    state.activeStrategy = result.strategy;
    renderActivePlan();

    if (result.warning) {
      const banner = document.getElementById('status-banner');
      if (banner) {
        banner.textContent = result.warning;
        banner.classList.remove('hidden');
      }
    } else {
      const banner = document.getElementById('status-banner');
      if (banner) banner.classList.add('hidden');
    }
  } finally {
    if (spinner) spinner.classList.add('hidden');
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
 * Initializes DOM listeners and hydrates state from initial URL hash.
 */
export function initApp() {
  // 1. Hydrate from URL hash if present
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

  // 2. Populate Basin Presets in Dropdown
  const citySelect = document.getElementById('input-city');
  if (citySelect) {
    while (citySelect.firstChild) {
      citySelect.removeChild(citySelect.firstChild);
    }
    for (let i = 0; i < METRO_BASIN_PRESETS.length; i++) {
      const opt = document.createElement('option');
      opt.value = METRO_BASIN_PRESETS[i];
      opt.textContent = METRO_BASIN_PRESETS[i];
      if (METRO_BASIN_PRESETS[i] === state.city) opt.selected = true;
      citySelect.appendChild(opt);
    }
    citySelect.addEventListener('change', (e) => {
      state.city = e.target.value;
      syncUrlHash();
      triggerPlanGeneration();
    });
  }

  // 3. AQI Slider
  const aqiSlider = document.getElementById('input-aqi-slider');
  const aqiLabel = document.getElementById('label-aqi-value');
  if (aqiSlider) {
    aqiSlider.value = String(state.aqi);
    if (aqiLabel) aqiLabel.textContent = String(state.aqi);

    aqiSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.aqi = val;
      if (aqiLabel) aqiLabel.textContent = String(val);
      syncUrlHash();
    });

    aqiSlider.addEventListener('change', () => {
      triggerPlanGeneration();
    });
  }

  // 4. Time Scrubber Slider
  const timeSlider = document.getElementById('input-time-slider');
  const timeLabel = document.getElementById('label-time-value');
  if (timeSlider) {
    timeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      state.simulatedHour = val;
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
      syncUrlHash();
    });

    timeSlider.addEventListener('change', () => {
      triggerPlanGeneration();
    });
  }

  // 4b. Housing Type Dropdown
  const housingSelect = document.getElementById('select-housing-type');
  if (housingSelect) {
    housingSelect.value = state.housingType;
    housingSelect.addEventListener('change', (e) => {
      state.housingType = e.target.value;
      globalEventBus.emit('CONTEXT_UPDATED', state);
      syncUrlHash();
      triggerPlanGeneration();
    });
  }

  // 4c. Cooking Method Radios
  const cookingRadios = document.querySelectorAll('input[name="radio-cooking"]');
  cookingRadios.forEach((r) => {
    r.checked = r.value === state.cookingMethod;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.cookingMethod = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        triggerPlanGeneration();
      }
    });
  });

  // 4d. Heating Method Radios
  const heatingRadios = document.querySelectorAll('input[name="radio-heating"]');
  heatingRadios.forEach((r) => {
    r.checked = r.value === state.heatingMethod;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.heatingMethod = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        triggerPlanGeneration();
      }
    });
  });

  // 4e. Commute Mode Radios & Distance Slider
  const commuteRadios = document.querySelectorAll('input[name="radio-commute"]');
  commuteRadios.forEach((r) => {
    r.checked = r.value === state.commuteMode;
    r.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.commuteMode = e.target.value;
        globalEventBus.emit('CONTEXT_UPDATED', state);
        syncUrlHash();
        triggerPlanGeneration();
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
    });

    commuteKmSlider.addEventListener('change', () => {
      triggerPlanGeneration();
    });
  }

  // 5. Vulnerability Checkboxes
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
      triggerPlanGeneration();
    });
  });

  // 6. Primary Action Buttons
  const btnGenerate = document.getElementById('btn-generate-plan');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => triggerPlanGeneration());
  }

  const btnCopyWhatsApp = document.getElementById('btn-copy-advisory');
  if (btnCopyWhatsApp) {
    btnCopyWhatsApp.addEventListener('click', async () => {
      if (state.activePlan && state.activePlan.communityAdvisory) {
        await navigator.clipboard.writeText(state.activePlan.communityAdvisory);
        btnCopyWhatsApp.textContent = 'Copied to Clipboard! ✓';
        setTimeout(() => {
          btnCopyWhatsApp.textContent = 'Copy WhatsApp Advisory';
        }, 2000);
      }
    });
  }

  // 7. API Key Drawer
  const inputKey = document.getElementById('input-gemini-key');
  const btnSaveKey = document.getElementById('btn-save-key');
  const btnClearKey = document.getElementById('btn-clear-key');

  if (btnSaveKey && inputKey) {
    btnSaveKey.addEventListener('click', () => {
      keyStore.setKey(inputKey.value);
      inputKey.value = '';
      setSafeText('key-status-text', 'API Key Active (In-Memory)');
      triggerPlanGeneration();
    });
  }

  if (btnClearKey) {
    btnClearKey.addEventListener('click', () => {
      keyStore.purge();
      setSafeText('key-status-text', 'No Key (Using Deterministic Offline Engine)');
      triggerPlanGeneration();
    });
  }

  // Initial generation
  triggerPlanGeneration();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
}
