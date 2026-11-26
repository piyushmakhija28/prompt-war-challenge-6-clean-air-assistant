/**
 * @fileoverview FastDOM Frame Scheduler, Result Monad, and Zero-XSS UI Controller.
 * Coordinates user input events, micro-reactive signal bindings, URL hash state synchronization,
 * and pure text-node DOM hydration with zero innerHTML usage.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module app
 */

import { VULN_FLAGS, DEFAULT_PRESET, METRO_BASIN_PRESETS, METRO_BASIN_COORDINATES } from './config.js';
import { getDiurnalInversion, DiurnalRingBuffer, generateDiurnalCurve } from './air-quality-engine.js';
import { SecureKeyStore, GeminiPlanProvider } from './gemini-service.js';
import { contextToHashToken, hashTokenToContext } from './state-codec.js';
import { globalEventBus } from './event-bus.js';
import { calculateRoomClearance, findNearestBasin } from './cadr-calculator.js';
import { aqiToMassConcentration } from './impact-calculator.js';
import { IAQ_HACKS_CATALOG } from './offline-advisor.js';
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

    // 2b. Comparative Inhaled Dose Exposure Gauge
    const unshieldedCp = aqiToMassConcentration(state.aqi);
    const unshieldedDose = Math.max(10, unshieldedCp * 12.0 * 1.4 * (0.85 * 0.7 + 1.0 * 0.3));
    const avoidedUg = plan.quantifiedImpact ? plan.quantifiedImpact.pm25InhalationAvoidedMicrograms : 0;
    const protectedDose = Math.max(5, unshieldedDose - avoidedUg);
    const reductionPct = Math.min(99.9, Math.max(0, ((unshieldedDose - protectedDose) / unshieldedDose) * 100));

    setSafeText('badge-shield-reduction', `-${reductionPct.toFixed(1)}% Inhaled Dose`);
    setSafeText('text-unshielded-dose', `${Math.round(unshieldedDose)} µg (${(unshieldedDose / 22).toFixed(1)} Cigs)`);
    setSafeText('text-protected-dose', `${Math.round(protectedDose)} µg (${(protectedDose / 22).toFixed(1)} Cigs)`);

    const barProtected = document.getElementById('bar-protected-dose');
    if (barProtected) {
      const protectedWidth = Math.max(4, Math.min(100, (protectedDose / unshieldedDose) * 100));
      barProtected.style.width = `${protectedWidth.toFixed(1)}%`;
    }

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

  state.hackId = state.activeHackId;
  state.lang = state.advisoryLang;

  const currentCp = aqiToMassConcentration(state.aqi);
  diurnalHistory.push(currentCp);
  globalEventBus.emit('CONTEXT_CHANGED', state);

  try {
    const result = await planProvider.getPlan(state);
    state.activePlan = result.plan;
    state.activeStrategy = result.strategy;

    if (state.activePlan && state.activePlan.bilingualAdvisory && state.activePlan.bilingualAdvisory[state.advisoryLang]) {
      state.activePlan.communityAdvisory = state.activePlan.bilingualAdvisory[state.advisoryLang];
    }

    renderActivePlan();
    globalEventBus.emit('PLAN_GENERATED', state.activePlan);

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
  } catch (err) {
    globalEventBus.emit('PLAN_ERROR', err);
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

  // 3. AQI Controls (Slider & Direct Number Input)
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
    });

    aqiSlider.addEventListener('change', () => {
      triggerPlanGeneration();
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
    });

    aqiNumberInput.addEventListener('change', () => {
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
            // User cancelled or share error; fall through to clipboard
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

  // 6a. Language Toggle (English <-> Hindi)
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

  // 6b. Emergency 1-Page Family Protocol Print
  const btnPrintProtocol = document.getElementById('btn-print-protocol');
  if (btnPrintProtocol) {
    btnPrintProtocol.addEventListener('click', () => {
      window.print();
    });
  }

  // 6c. Selectable 4-Hack IAQ Catalog Switcher
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

      triggerPlanGeneration();
    });
  });

  // 6b. Geolocation Nearest-Basin Detector
  const btnDetectLocation = document.getElementById('btn-detect-location');
  if (btnDetectLocation) {
    btnDetectLocation.addEventListener('click', () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        showStatusBanner('Geolocation API not supported in this browser.', true);
        return;
      }

      btnDetectLocation.disabled = true;
      showStatusBanner('Detecting nearest urban air basin...', false);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btnDetectLocation.disabled = false;
          const userLat = pos.coords.latitude;
          const userLon = pos.coords.longitude;
          const nearest = findNearestBasin(userLat, userLon, METRO_BASIN_COORDINATES);

          if (nearest && citySelect) {
            citySelect.value = nearest.name;
            state.city = nearest.name;
            syncUrlHash();
            triggerPlanGeneration();
            showStatusBanner(`Auto-detected nearest basin: ${nearest.name} (${nearest.distanceKm} km away)`, false);
            setTimeout(() => {
              const banner = document.getElementById('status-banner');
              if (banner) banner.classList.add('hidden');
            }, 3500);
          }
        },
        () => {
          btnDetectLocation.disabled = false;
          showStatusBanner('Geolocation access denied. Keeping current city preset.', true);
          setTimeout(() => {
            const banner = document.getElementById('status-banner');
            if (banner) banner.classList.add('hidden');
          }, 3500);
        },
        { timeout: 8000 }
      );
    });
  }

  // 6c. Dynamic Room CADR Calculator Controller
  function updateRoomCadr() {
    const lengthInput = document.getElementById('input-room-l');
    const widthInput = document.getElementById('input-room-w');
    const heightInput = document.getElementById('input-room-h');
    const cadrSelect = document.getElementById('select-cadr-device');

    if (!lengthInput || !widthInput || !heightInput || !cadrSelect) return;

    const length = Number(lengthInput.value) || 14;
    const width = Number(widthInput.value) || 12;
    const height = Number(heightInput.value) || 9;
    const cadrCfm = Number(cadrSelect.value) || 273;

    const result = calculateRoomClearance({ length, width, height, unit: 'ft', cadrCfm });

    setSafeText('badge-cadr-ach', `${result.achClean} ACH`);
    setSafeText('cadr-t50', `${result.t50Min} min`);
    setSafeText('cadr-t90', `${result.t90Min} min`);
    setSafeText('cadr-t99', `${result.t99Min} min`);
  }

  const cadrInputs = ['input-room-l', 'input-room-w', 'input-room-h', 'select-cadr-device'];
  cadrInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateRoomCadr);
      el.addEventListener('change', updateRoomCadr);
    }
  });
  updateRoomCadr();

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

  // 8. Progressive Web App Service Worker Registration
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Gracefully silent for offline / local sandbox environments
    });
  }

  // Initial render of diurnal spline curve
  renderDiurnalSplineCurve();

  // Initial generation
  triggerPlanGeneration();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
}
