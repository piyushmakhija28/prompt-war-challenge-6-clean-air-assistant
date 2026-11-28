/**
 * @fileoverview Offline PWA behaviour with the service worker enabled. Each test runs its own
 * local server and stops it, so that "offline" is real for the service worker as well.
 * @module test/e2e/offline-pwa
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, FAKE_KEY, CleanAirPage, defaultModel, personaModel } from './fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_PORT = 8810;
const UPDATE_REJECTION = /Failed to update a ServiceWorker/;

test.use({ serviceWorkers: 'allow' });

/**
 * Starts a private copy of the application server.
 *
 * @param {number} port - Listening port.
 * @returns {Promise<{origin: string, stop: () => Promise<void>}>} Server handle.
 */
async function startServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited with ${code}`)));
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running locally')) resolve();
    });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      child.kill();
    })
  };
}

/**
 * Waits until the service worker controls the page and has filled its cache.
 *
 * @param {import('@playwright/test').Page} page - Page.
 */
async function awaitServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

let server;

test.beforeEach(async ({}, testInfo) => {
  server = await startServer(BASE_PORT + testInfo.parallelIndex);
});

test.afterEach(async () => {
  await server.stop();
});

/**
 * Takes the application fully offline: stops its server and marks the browser offline.
 * The rejected service worker update check is tolerated here because one dedicated test
 * reports it, so the remaining offline tests keep reporting their own behaviour.
 *
 * @param {import('@playwright/test').BrowserContext} context - Context.
 * @param {Object} health - Health record.
 * @param {Object} mocks - Host mocks.
 */
async function goOffline(context, health, mocks) {
  health.networkDown = true;
  health.ignoredErrors.push(UPDATE_REJECTION);
  for (const mock of Object.values(mocks)) mock.always({ abort: 'internetdisconnected' });
  await server.stop();
  await context.setOffline(true);
}

test('the service worker caches the shell and nothing sensitive', async ({ app, page, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await app.saveKey(FAKE_KEY);
  await app.expectAdvice(defaultModel());
  await page.reload();
  await expect(app.sourceAqi).toContainText('AQI: Live');

  const cached = await page.evaluate(async () => {
    const entries = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        entries.push({ name, url: request.url, body: await (await cache.match(request)).text() });
      }
    }
    return entries;
  });

  expect([...new Set(cached.map((entry) => entry.name))]).toEqual(['cleanair-guardian-v1.4']);
  for (const file of [
    'index.html', 'manifest.webmanifest', 'src/css/style.css', 'src/js/app.js', 'src/js/live-aqi.js',
    'src/js/gemini-service.js', 'src/js/impact-calculator.js', 'src/js/offline-advisor.js'
  ]) {
    expect(cached.some((entry) => new URL(entry.url).pathname === `/${file}`), file).toBe(true);
  }
  expect(cached.every((entry) => new URL(entry.url).origin === server.origin)).toBe(true);
  expect(cached.map((entry) => entry.body).join('')).not.toContain(FAKE_KEY);
});

test('offline reload right after the first visit still starts the application', async ({ app, page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await expect(app.sourceAqi).toContainText('AQI: Live');
  await awaitServiceWorker(page);
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match('./src/js/live-aqi.js')))).toBe(true);

  await goOffline(context, health, mocks);
  await page.reload();

  await expect(app.badge).toHaveText('OFFLINE_DETERMINISTIC', { timeout: 5000 });
  await expect(app.cards).toHaveCount(4);
});

test('offline reload after a repeat visit keeps state and stays interactive', async ({ app, page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await page.reload();
  await expect(app.sourceAqi).toContainText('AQI: Live');
  await app.persona('rajesh');
  await app.expectFigures(personaModel('rajesh'));
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(
    document.querySelector('script[type="module"]').src
  )))).toBe(true);

  await goOffline(context, health, mocks);
  await page.reload();

  await expect(app.badge).toHaveText('OFFLINE_DETERMINISTIC');
  await app.expectFigures(personaModel('rajesh'));
  await expect(app.sourceAqi).toHaveText('AQI: Manual');
  await app.choose('commute', 'private_car');
  await app.expectFigures({ ...personaModel('rajesh'), commuteMode: 'private_car' });
  await app.langButton.click();
  await expect(app.advisory).toHaveAttribute('lang', 'hi');
  await app.hack('pc_fan_stealth');
  await expect(page.locator('#iaq-hack-title')).toContainText('PC-Fan');
});

test('offline use of a live link says the value is not live', async ({ app, page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await page.reload();
  await expect(app.sourceAqi).toContainText('AQI: Live');
  await expect(page).toHaveURL(/&live=1$/);
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(
    document.querySelector('script[type="module"]').src
  )))).toBe(true);

  await goOffline(context, health, mocks);
  await page.reload();

  await expect(app.sourceAqi).toContainText('Not live');
  await expect(app.heroAqi).toHaveText(String(defaultModel().aqi));
  await app.saveKey(FAKE_KEY);
  await expect(app.banner).toContainText('You are offline');
  await app.expectOffline();
});

test('an offline reload raises no uncaught error', async ({ app, page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await page.reload();
  await expect(app.sourceAqi).toContainText('AQI: Live');
  await goOffline(context, health, mocks);
  await page.reload();
  await expect(app.badge).toHaveText('OFFLINE_DETERMINISTIC');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update().catch(() => 'expected offline');
  });
  health.ignoredErrors.length = 0;

  expect(health.consoleErrors.filter((line) => UPDATE_REJECTION.test(line))).toEqual([]);
});

test('an uncached resource answers 503 offline', async ({ page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await goOffline(context, health, mocks);

  const status = await page.evaluate(async () => (await fetch('./never-cached.json')).status);
  expect(status).toBe(503);
});

test('a second tab opened offline shows the application', async ({ app, page, context, health, mocks }) => {
  await page.goto(`${server.origin}/index.html`);
  await awaitServiceWorker(page);
  await page.reload();
  await expect(app.sourceAqi).toContainText('AQI: Live');
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(
    document.querySelector('script[type="module"]').src
  )))).toBe(true);
  await goOffline(context, health, mocks);

  const second = new CleanAirPage(await context.newPage());
  await second.page.goto(`${server.origin}/index.html`);

  await expect(second.badge).toHaveText('OFFLINE_DETERMINISTIC');
  await expect(second.cards).toHaveCount(4);
});
