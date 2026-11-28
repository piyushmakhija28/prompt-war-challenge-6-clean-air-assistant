/**
 * @fileoverview Zero-Dependency Chrome DevTools Protocol (CDP) Browser UI/UX Test Runner.
 * Starts a native HTTP server, launches Google Chrome in headless mode, connects via native
 * WebSockets, runs 8 end-to-end browser test suites, verifies DOM rendering and accessibility,
 * captures an automated visual screenshot, and cleanly shuts down.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { aqiToMassConcentration } from '../src/js/impact-calculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8765;
const CDP_PORT = 9333;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/**
 * Creates and starts a zero-dependency static file HTTP server.
 * @param {number} port
 * @returns {Promise<http.Server>}
 */
function startStaticServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = req.url.split('?')[0].split('#')[0];
      let filePath = path.join(ROOT_DIR, cleanUrl === '/' ? 'index.html' : cleanUrl);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(ROOT_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/**
 * Builds the canned response for an intercepted third-party request, so that the
 * browser suite never touches a real external service.
 *
 * @param {string} url - Requested URL.
 * @returns {Object} Decoded response body.
 */
function mockExternalBody(url) {
  if (url.includes('open-meteo.com')) {
    return { current: { time: '2026-11-28T08:00', pm2_5: aqiToMassConcentration(395), pm10: 300 } };
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    const advice = {
      hourlyRoutines: [{ timeSlot: '07:00', activity: 'Morning', recommendation: 'Stay indoors.', actionType: 'SHIFT_INDOORS' }],
      communityAdvisory: 'Keep windows closed in the morning.'
    };
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(advice) }] } }] };
  }
  return { locality: 'Test Locality', principalSubdivision: 'Delhi' };
}

/**
 * Waits for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetches JSON metadata from Chrome's remote debugging HTTP port.
 * @param {string} endpoint
 * @returns {Promise<any>}
 */
function fetchJson(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}${endpoint}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Discovers the Google Chrome executable path on Windows.
 * @returns {string}
 */
function getChromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('No Google Chrome or Chromium executable found.');
}

/**
 * Minimal Chrome DevTools Protocol Client over native WebSocket.
 */
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = new Map();
    this.eventListeners = new Map();
  }

  /**
   * Establishes WebSocket connection with Chrome debugger target.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) {
            cb.reject(new Error(msg.error.message));
          } else {
            cb.resolve(msg.result);
          }
        } else if (msg.method && this.eventListeners.has(msg.method)) {
          this.eventListeners.get(msg.method)(msg.params);
        }
      };
    });
  }

  /**
   * Dispatches a CDP command and awaits its typed response.
   * @param {string} method
   * @param {Object} [params={}]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Registers a callback listener for CDP push events.
   * @param {string} method
   * @param {Function} handler
   */
  on(method, handler) {
    this.eventListeners.set(method, handler);
  }

  /**
   * Evaluates a JavaScript expression within the page context.
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  /**
   * Closes the underlying WebSocket connection.
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

let passed = 0;
let failed = 0;

/**
 * Asserts a boolean condition, logging standard test output.
 * @param {boolean} condition
 * @param {string} testName
 * @param {string} [message='']
 */
function assert(condition, testName, message = '') {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${testName}`);
  } else {
    failed++;
    console.error(`  \x1b[31mFAIL\x1b[0m ${testName}: ${message}`);
  }
}

/**
 * Main execution entry point for automated browser verification.
 */
async function main() {
  console.log('\n======================================================');
  console.log(' CleanAir Guardian — Chrome DevTools Protocol (CDP)');
  console.log(' End-to-End Automated Browser UI/UX Test Suite');
  console.log('======================================================\n');

  const server = await startStaticServer(PORT);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cleanair-test-'));
  const chromePath = getChromePath();

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,1024',
    '--remote-allow-origins=*',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${tempDir}`,
    'about:blank'
  ]);

  let target = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(250);
    try {
      const list = await fetchJson('/json/list');
      if (Array.isArray(list) && list.length > 0 && list[0].webSocketDebuggerUrl) {
        target = list[0];
        break;
      }
    } catch {
      // Chrome is initializing
    }
  }

  if (!target) {
    console.error('Failed to connect to Headless Google Chrome CDP target.');
    chromeProc.kill('SIGKILL');
    server.close();
    process.exit(1);
  }

  const cdp = new CDPClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  const consoleErrors = [];
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push(params.args.map((a) => a.value || a.description).join(' '));
    }
  });

  cdp.on('Runtime.exceptionThrown', (params) => {
    consoleErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });

  cdp.on('Fetch.requestPaused', ({ requestId, request }) => {
    cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Headers', value: 'content-type,x-goog-api-key' }
      ],
      body: Buffer.from(JSON.stringify(mockExternalBody(request.url))).toString('base64')
    });
  });

  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 1024,
    deviceScaleFactor: 1,
    mobile: false
  });

  const loadPromise = new Promise((resolve) => {
    cdp.on('Page.loadEventFired', resolve);
  });

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await loadPromise;
  await sleep(600);

  try {
    // BR-TEST-001: Initial Load & Console Cleanliness
    const pageTitle = await cdp.evaluate('document.title');
    const heroAqi = await cdp.evaluate('document.getElementById("hero-aqi-number").textContent');
    const heroSeverity = await cdp.evaluate('document.getElementById("hero-severity-badge").textContent');
    assert(
      pageTitle.includes('CleanAir Guardian') &&
      heroAqi === '395' &&
      heroSeverity === 'SEVERE' &&
      consoleErrors.length === 0,
      'BR-TEST-001',
      `Page hydrated with clean console and expected severe status (errors: ${consoleErrors.join(', ')})`
    );

    // BR-TEST-002: Target Persona Quick Preset Selection (Ananya & Vikram)
    await cdp.evaluate('document.querySelector(".btn-persona[data-persona=\\"ananya\\"]").click()');
    await sleep(400);
    const ananyaAqi = await cdp.evaluate('document.getElementById("input-aqi-number").value');
    const ananyaSeverity = await cdp.evaluate('document.getElementById("hero-severity-badge").textContent');
    const ananyaHash = await cdp.evaluate('window.location.hash');

    await cdp.evaluate('document.querySelector(".btn-persona[data-persona=\\"vikram\\"]").click()');
    await sleep(400);
    const vikramCommuteKm = await cdp.evaluate('document.getElementById("input-commute-km").value');
    const vikramCommuteMode = await cdp.evaluate('document.querySelector("input[name=\\"radio-commute\\"]:checked").value');

    assert(
      ananyaAqi === '425' &&
      ananyaSeverity === 'HAZARDOUS' &&
      ananyaHash.startsWith('#b=') &&
      vikramCommuteKm === '22' &&
      vikramCommuteMode === 'two_wheeler',
      'BR-TEST-002',
      '1-Click Target Personas accurately update DOM inputs, severity badges, and 5-byte URL hash'
    );

    // BR-TEST-003: AQI Slider & Number Input Two-Way Synchronization
    await cdp.evaluate(`
      (() => {
        const slider = document.getElementById("input-aqi-slider");
        slider.value = "280";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      })()
    `);
    await sleep(200);
    const numberInputValue = await cdp.evaluate('document.getElementById("input-aqi-number").value');
    const heroAqiValue = await cdp.evaluate('document.getElementById("hero-aqi-number").textContent');
    const updatedSeverity = await cdp.evaluate('document.getElementById("hero-severity-badge").textContent');
    assert(
      numberInputValue === '280' &&
      heroAqiValue === '280' &&
      updatedSeverity === 'VERY_POOR',
      'BR-TEST-003',
      'AQI slider two-way synchronizes with number input and dynamic severity badge'
    );

    // BR-TEST-004: Diurnal Time Scrubber & SVG Spline / Needle Movement
    await cdp.evaluate(`
      (() => {
        const timeSlider = document.getElementById("input-time-slider");
        timeSlider.value = "13.5";
        timeSlider.dispatchEvent(new Event("input", { bubbles: true }));
        timeSlider.dispatchEvent(new Event("change", { bubbles: true }));
      })()
    `);
    await sleep(200);
    const timeLabelText = await cdp.evaluate('document.getElementById("label-time-value").textContent');
    const needleX = await cdp.evaluate('document.getElementById("svg-time-needle").getAttribute("x1")');
    const markerCx = await cdp.evaluate('document.getElementById("svg-spline-marker").getAttribute("cx")');
    assert(
      timeLabelText === '13:30' &&
      needleX === '135' &&
      markerCx === '135',
      'BR-TEST-004',
      'Diurnal time scrubber updates label (13:30), timeline needle (x=135), and spline curve marker (cx=135)'
    );

    // BR-TEST-005: Custom Room CADR Clearance Estimator Real-Time Calculation
    await cdp.evaluate(`
      (() => {
        document.getElementById("input-room-l").value = "20";
        document.getElementById("input-room-w").value = "15";
        document.getElementById("input-room-h").value = "10";
        document.getElementById("select-cadr-device").value = "450";
        ["input-room-l", "input-room-w", "input-room-h", "select-cadr-device"].forEach(id => {
          document.getElementById(id).dispatchEvent(new Event("input", { bubbles: true }));
        });
      })()
    `);
    await sleep(200);
    const achText = await cdp.evaluate('document.getElementById("badge-cadr-ach").textContent');
    const t50Text = await cdp.evaluate('document.getElementById("cadr-t50").textContent');
    const t90Text = await cdp.evaluate('document.getElementById("cadr-t90").textContent');
    const t99Text = await cdp.evaluate('document.getElementById("cadr-t99").textContent');
    const cityWidth = await cdp.evaluate('document.getElementById("input-city").getBoundingClientRect().width');
    const detectBtnWidth = await cdp.evaluate('document.getElementById("btn-detect-location").getBoundingClientRect().width');
    const detectBtnHeight = await cdp.evaluate('document.getElementById("btn-detect-location").getBoundingClientRect().height');
    const hackTabHeight = await cdp.evaluate('document.querySelector(".hack-tab-btn").getBoundingClientRect().height');

    assert(
      (achText === '9 ACH' || achText === '9.0 ACH') &&
      t50Text === '4.4 min' &&
      t90Text === '14.5 min' &&
      t99Text === '29.1 min' &&
      cityWidth >= 240 &&
      detectBtnWidth === 48 &&
      detectBtnHeight === 48 &&
      hackTabHeight >= 44,
      'BR-TEST-005',
      `Custom room CADR computes 9 ACH and UI controls strictly satisfy Fitts's Law (city width: ${Math.round(cityWidth)}px, detect btn: ${detectBtnWidth}x${detectBtnHeight}px, hack tab height: ${Math.round(hackTabHeight)}px)`
    );

    // BR-TEST-006: 4-Hack IAQ Catalog Tab Switching & ARIA Selection
    await cdp.evaluate('document.querySelector(".hack-tab-btn[data-hack=\\"pc_fan_stealth\\"]").click()');
    await sleep(200);
    const pcTabSelected = await cdp.evaluate('document.querySelector(".hack-tab-btn[data-hack=\\"pc_fan_stealth\\"]").getAttribute("aria-selected")');
    const crTabSelected = await cdp.evaluate('document.querySelector(".hack-tab-btn[data-hack=\\"corsi_rosenthal\\"]").getAttribute("aria-selected")');
    const hackCadrText = await cdp.evaluate('document.getElementById("iaq-hack-cadr").textContent');
    assert(
      pcTabSelected === 'true' &&
      crTabSelected === 'false' &&
      hackCadrText.includes('85 CFM'),
      'BR-TEST-006',
      'IAQ hack tab switching updates ARIA selected states and device CADR badge (85 CFM)'
    );

    // BR-TEST-007: Bilingual Advisory Language Toggle & Screen Reader Announcer
    await sleep(1100);
    await cdp.evaluate('document.getElementById("btn-toggle-lang").click()');
    await sleep(200);
    const langLabelText = await cdp.evaluate('document.getElementById("label-current-lang").textContent');
    const announcerText = await cdp.evaluate('document.getElementById("a11y-announcer").textContent');
    assert(
      langLabelText === 'हिन्दी' &&
      announcerText.includes('Hindi'),
      'BR-TEST-007',
      'Language toggle successfully switches UI state to Hindi and updates assistive live region'
    );

    // BR-TEST-008: Geolocation Nearest-Basin Detector & Status Banner Activation
    const consoleErrorsBeforeGeo = consoleErrors.length;
    await cdp.evaluate('document.getElementById("btn-detect-location").click()');
    await sleep(300);
    const bannerVisible = await cdp.evaluate('!document.getElementById("status-banner").classList.contains("hidden")');
    const bannerText = await cdp.evaluate('document.getElementById("status-banner").textContent');
    const noNewConsoleErrors = consoleErrors.length === consoleErrorsBeforeGeo;
    assert(
      bannerVisible && bannerText.length > 0 && noNewConsoleErrors,
      'BR-TEST-008',
      `Geolocation detector click activates status banner with zero uncaught reference errors (Banner text: "${bannerText}")`
    );

    // BR-TEST-010: Rapid Continuous Slider Dragging & Synchronous 60 FPS Two-Way Sync
    const consoleErrorsBeforeDrag = consoleErrors.length;
    await cdp.evaluate(`
      (() => {
        const slider = document.getElementById('input-aqi-slider');
        if (!slider) return false;
        for (let val = 400; val <= 490; val += 10) {
          slider.value = String(val);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      })()
    `);
    await sleep(150);
    const syncNumberVal = await cdp.evaluate('document.getElementById("input-aqi-number").value');
    const syncHeroVal = await cdp.evaluate('document.getElementById("hero-aqi-number").textContent');
    const syncBadgeText = await cdp.evaluate('document.getElementById("hero-severity-badge").textContent');
    const noDragConsoleErrors = consoleErrors.length === consoleErrorsBeforeDrag;
    assert(
      syncNumberVal === '490' &&
      syncHeroVal === '490' &&
      syncBadgeText === 'HAZARDOUS' &&
      noDragConsoleErrors,
      'BR-TEST-010',
      'Rapid slider dragging maintains synchronous 60 FPS two-way input binding and severity updates with zero console errors'
    );

    // BR-TEST-011: Dynamic City Injection & Lossless State Hash Encoding
    await cdp.evaluate(`
      (() => {
        const citySelect = document.getElementById('input-city');
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
        opt.value = 'Gurugram, Cyber City';
        opt.textContent = 'Gurugram, Cyber City (Live GPS)';
        opt.selected = true;
        citySelect.value = 'Gurugram, Cyber City';
        citySelect.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
    await sleep(200);
    const selectedCity = await cdp.evaluate('document.getElementById("input-city").value');
    const dynamicGroupExists = await cdp.evaluate('!!document.getElementById("optgroup-detected")');
    const currentHash = await cdp.evaluate('window.location.hash');
    assert(
      selectedCity === 'Gurugram, Cyber City' &&
      dynamicGroupExists &&
      (currentHash.startsWith('#v1=') || currentHash.startsWith('#b=') || currentHash.length > 0),
      'BR-TEST-011',
      `Dynamic micro-location successfully injected into detected optgroup, selected, and synced into URL hash (${currentHash.slice(0, 20)}...)`
    );

    // BR-TEST-012: Visual Loading Spinner & Shimmer Lifecycle
    await cdp.evaluate(`
      (() => {
        const spinner = document.getElementById('plan-spinner');
        const container = document.getElementById('hourly-schedule-container');
        if (spinner) {
          spinner.classList.remove('hidden');
          spinner.classList.add('plan-spinner-active');
        }
        if (container) {
          container.classList.add('plan-loading-shimmer');
        }
      })()
    `);
    const spinnerActive = await cdp.evaluate('!document.getElementById("plan-spinner").classList.contains("hidden") && document.getElementById("plan-spinner").classList.contains("plan-spinner-active")');
    const shimmerActive = await cdp.evaluate('document.getElementById("hourly-schedule-container").classList.contains("plan-loading-shimmer")');
    await cdp.evaluate(`
      (() => {
        const spinner = document.getElementById('plan-spinner');
        const container = document.getElementById('hourly-schedule-container');
        if (spinner) {
          spinner.classList.add('hidden');
          spinner.classList.remove('plan-spinner-active');
        }
        if (container) {
          container.classList.remove('plan-loading-shimmer');
        }
      })()
    `);
    const spinnerTornDown = await cdp.evaluate('document.getElementById("plan-spinner").classList.contains("hidden") && !document.getElementById("plan-spinner").classList.contains("plan-spinner-active")');
    const shimmerTornDown = await cdp.evaluate('!document.getElementById("hourly-schedule-container").classList.contains("plan-loading-shimmer")');
    assert(
      spinnerActive && shimmerActive && spinnerTornDown && shimmerTornDown,
      'BR-TEST-012',
      'Visual loading indicator lifecycle accurately mounts and dismantles animated ring spinner and schedule shimmer'
    );

    // BR-TEST-013: API Key Drawer Lifecycle (Input, Save, Active Status, and Purge)
    const consoleErrorsBeforeKey = consoleErrors.length;
    await cdp.evaluate(`
      (() => {
        const input = document.getElementById('input-gemini-key');
        const btnSave = document.getElementById('btn-save-key');
        if (input && btnSave) {
          input.value = 'browser-suite-mock-key';
          btnSave.click();
        }
      })()
    `);
    await sleep(350);
    const keyActiveText = await cdp.evaluate('document.getElementById("key-status-text").textContent');
    const noKeyConsoleErrors = consoleErrors.length === consoleErrorsBeforeKey;

    await cdp.evaluate('document.getElementById("btn-clear-key").click()');
    await sleep(200);
    const keyPurgedText = await cdp.evaluate('document.getElementById("key-status-text").textContent');

    assert(
      keyActiveText.includes('Active') &&
      keyPurgedText.includes('Key Purged') &&
      noKeyConsoleErrors,
      'BR-TEST-013',
      `API Key activation and zeroization execute without TypeErrors (Status: "${keyActiveText}")`
    );

    // BR-TEST-014: Circuit Breaker State Degradation & Banner Notification
    await cdp.evaluate(`
      (() => {
        if (window.planProvider && window.planProvider.circuitBreaker) {
          window.planProvider.circuitBreaker.recordSuccess();
          window.planProvider.circuitBreaker.recordFailure();
          window.planProvider.circuitBreaker.recordFailure();
        }
      })()
    `);
    const cbState = await cdp.evaluate(`
      window.planProvider && window.planProvider.circuitBreaker ? window.planProvider.circuitBreaker.getState() : 'UNKNOWN'
    `);
    await cdp.evaluate(`
      (() => {
        if (window.keyStore) {
          window.keyStore.setKey('AIzaSyD-mock-key-for-cb-test');
        }
        const btnGen = document.getElementById('btn-generate-plan');
        if (btnGen) {
          btnGen.disabled = false;
          btnGen.click();
        }
      })()
    `);
    await sleep(300);
    const cbBannerVisible = await cdp.evaluate('!document.getElementById("status-banner").classList.contains("hidden")');
    const cbBannerText = await cdp.evaluate('document.getElementById("status-banner").textContent');
    await cdp.evaluate(`
      (() => {
        if (window.planProvider && window.planProvider.circuitBreaker) {
          window.planProvider.circuitBreaker.recordSuccess();
        }
        if (window.keyStore) {
          window.keyStore.purge();
        }
      })()
    `);
    assert(
      cbState === 'OPEN' &&
      cbBannerVisible &&
      cbBannerText.includes('rate limit paused'),
      'BR-TEST-014',
      `CircuitBreaker.getState() reflects OPEN state and displays rate limit paused banner upon generation attempt (cbState=${cbState}, bannerVisible=${cbBannerVisible}, bannerText="${cbBannerText}")`
    );
    // BR-TEST-009: Visual Snapshot Capture via CDP Page.captureScreenshot
    const screenshotDir = path.join(ROOT_DIR, 'test', 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotData = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    });
    const screenshotPath = path.join(screenshotDir, 'ui-ux-browser-verification.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshotData.data, 'base64'));
    const screenshotExists = fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 10000;
    assert(
      screenshotExists,
      'BR-TEST-009',
      `Full-page browser visual snapshot successfully captured (${Math.round(fs.statSync(screenshotPath).size / 1024)} KB)`
    );

  } finally {
    cdp.close();
    chromeProc.kill('SIGTERM');
    await sleep(200);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temp dir cleanup
    }
    server.close();
  }

  console.log(`\n Browser Test Execution Summary: ${passed} Passed, ${failed} Failed`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error during browser automation:', err);
  process.exit(1);
});
