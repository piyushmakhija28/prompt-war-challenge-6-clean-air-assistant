/**
 * @fileoverview User interface health: console and CSP cleanliness, keyboard operation, ARIA
 * status reporting and mobile layout.
 * @module test/e2e/ui-accessibility
 */

import { test, expect, FAKE_KEY, defaultModel, tagFor, errorReply, quotaReply } from './fixtures.js';

/**
 * Lists visible controls and panels that stick out of the viewport, and the document width.
 *
 * @param {import('@playwright/test').Page} page - Page.
 * @returns {Promise<{documentWidth: number, viewport: number, outside: string[]}>} Layout report.
 */
async function layoutReport(page) {
  const viewport = page.viewportSize().width;
  const report = await page.evaluate((width) => {
    const selector = 'button, input, select, a:not(.skip-link), .metric-card, .schedule-slot-card, ' +
      '.advisory-preview, .source-line, .status-banner:not(.hidden), .alt-card, .glass-panel, .iaq-box';
    const outside = [...document.querySelectorAll(selector)]
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -0.5 || box.right > width + 0.5 || element.scrollWidth > element.clientWidth + 1 &&
          element.matches('.metric-card, .schedule-slot-card, .advisory-preview, .alt-card, .iaq-box, .glass-panel');
      })
      .map((element) => `${element.tagName}#${element.id}.${element.className}`);
    return { documentWidth: document.documentElement.scrollWidth, outside };
  }, viewport);
  return { ...report, viewport };
}

/**
 * Asserts there is no horizontal scrolling and nothing sticks out.
 *
 * @param {import('@playwright/test').Page} page - Page.
 */
async function expectFits(page) {
  const report = await layoutReport(page);
  expect(report.documentWidth).toBeLessThanOrEqual(report.viewport);
  expect(report.outside).toEqual([]);
}

/**
 * Identifies the focused element.
 *
 * @param {import('@playwright/test').Page} page - Page.
 * @returns {Promise<string>} Stable identifier.
 */
function focusedKey(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element.id || element.dataset.persona || element.dataset.hack ||
      (element.name ? `${element.name}` : '') ||
      (element.dataset.bit ? `bit-${element.dataset.bit}` : '') || element.className || element.tagName;
  });
}

/**
 * Presses Tab until the wanted element has focus.
 *
 * @param {import('@playwright/test').Page} page - Page.
 * @param {import('@playwright/test').Locator} target - Element to reach.
 */
async function tabTo(page, target) {
  for (let press = 0; press < 80; press++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test.describe('health of normal use', () => {
  test('a complete journey produces no console error, CSP violation or stray request', async ({ app, health }) => {
    await app.open();
    await app.activate();
    await app.persona('ananya');
    await app.timeSlider.fill('13');
    await app.hack('kitchen_vent_scrub');
    await app.langButton.click();
    await app.citySelect.selectOption('Patna');
    await expect(app.sourceAqi).toContainText('AQI: Live');
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await app.purgeButton.click();
    await app.expectOffline();

    expect(health.consoleErrors).toEqual([]);
    expect(health.cspViolations).toEqual([]);
    expect(health.unmocked).toEqual([]);
  });

  test('the violation monitor detects a blocked connection', async ({ app, page, health }) => {
    await app.open();
    await page.evaluate(() => fetch('https://blocked.example.invalid/ping').catch(() => 'blocked'));

    await expect.poll(() => health.cspViolations.length).toBe(1);
    expect(health.cspViolations[0]).toContain('connect-src');
    health.cspViolations.length = 0;
    health.consoleErrors.length = 0;
  });

  test('printing the protocol calls the browser print dialog', async ({ app, page, context }) => {
    await context.addInitScript(() => {
      window.printCalls = 0;
      window.print = () => { window.printCalls++; };
    });
    await app.open();
    await page.locator('#btn-print-protocol').click();
    expect(await page.evaluate(() => window.printCalls)).toBe(1);
  });
});

test.describe('ARIA status', () => {
  test('source lines, key status, spinner and banner are live regions', async ({ app, page }) => {
    await app.open();
    for (const id of ['source-aqi', 'source-advice', 'key-status-text', 'plan-spinner', 'a11y-announcer']) {
      await expect(page.locator(`#${id}`)).toHaveAttribute('role', 'status');
    }
    await expect(app.banner).toHaveAttribute('role', 'alert');
    await expect(page.locator('#a11y-announcer')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('busy and queued phases are exposed to assistive technology', async ({ app, mocks }) => {
    await app.open();
    const gate = mocks.gemini.hold();
    mocks.gemini.always(quotaReply('20s'));
    await app.saveKey();
    await expect(app.schedule).toHaveAttribute('aria-busy', 'true');
    await expect(app.spinner).toBeVisible();

    await gate.release(quotaReply('20s'));
    await expect(app.sourceAdvice).toHaveText('Advice: Refresh queued');
    await expect(app.schedule).toHaveAttribute('aria-busy', 'true');
    await expect(app.spinnerText).toHaveText('Refresh queued');
    await app.purgeButton.click();
    await expect(app.schedule).toHaveAttribute('aria-busy', 'false');
  });

  test('every visible control has an accessible name', async ({ app, page }) => {
    await app.open();
    const controls = page.locator('button:visible, input:visible, select:visible, a:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(30);
    for (let index = 0; index < count; index++) {
      await expect(controls.nth(index)).toHaveAccessibleName(/\S/);
    }
  });

  test('the key field is named by a label, not only a placeholder', async ({ app }) => {
    await app.open();
    await expect(app.keyInput).toHaveAttribute('aria-label', 'Gemini API key');
  });

  test('tabs and unit toggles expose their selected state', async ({ app, page }) => {
    await app.open();
    await expect(page.getByRole('tab')).toHaveCount(4);
    await page.getByRole('tab', { name: /PC Fan/ }).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveText(/PC Fan/);
    await page.getByRole('button', { name: 'm', exact: true }).click();
    await expect(page.locator('#btn-unit-m')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-unit-ft')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the announcer reports a plan update with current numbers', async ({ app, page }) => {
    await app.open();
    await app.freeze();
    await app.advance(1500);
    await app.aqiSlider.fill('120');
    await app.advance(5000);

    await expect(page.locator('#a11y-announcer')).toHaveText(/Current AQI 120,/, { timeout: 2000 });
  });

  test('the announcer does not stay on an outdated AQI after quick successive changes', async ({ app, page }) => {
    await app.open();
    await app.freeze();
    await app.advance(1500);
    await app.aqiSlider.fill('120');
    await app.advance(100);
    await app.aqiSlider.fill('430');
    await app.advance(10000);

    await expect(app.heroAqi).toHaveText('430');
    await expect(page.locator('#a11y-announcer')).toContainText('430', { timeout: 2000 });
  });
});

test.describe('keyboard operation', () => {
  test('the skip link is first and leads to the main content', async ({ app, page }) => {
    await app.open();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');

    expect(await page.evaluate(() => Boolean(document.activeElement.closest('main')))).toBe(true);
  });

  test('every control is reachable with the Tab key', async ({ app, page }) => {
    await app.open();
    const reached = new Set();
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press('Tab');
      reached.add(await focusedKey(page));
    }
    for (const key of [
      'ananya', 'rajesh', 'vikram', 'ramesh', 'input-city', 'btn-detect-location', 'input-aqi-number',
      'input-aqi-slider', 'btn-live-aqi', 'input-time-slider', 'select-housing-type', 'radio-cooking',
      'radio-heating', 'radio-commute', 'input-commute-km', 'btn-generate-plan', 'btn-copy-advisory',
      'btn-toggle-lang', 'btn-copy-link', 'btn-print-protocol', 'input-gemini-key', 'btn-save-key',
      'btn-clear-key', 'corsi_rosenthal',
      'btn-unit-ft', 'btn-unit-m', 'input-room-l', 'input-room-w', 'input-room-h', 'select-cadr-device'
    ]) {
      expect([...reached], key).toContain(key);
    }
  });

  test('the hack tabs follow the arrow, Home and End keys with one tab stop', async ({ app, page }) => {
    await app.open();
    const tab = (id) => page.locator(`.hack-tab-btn[data-hack="${id}"]`);
    await tab('corsi_rosenthal').focus();

    for (const [key, id] of [
      ['ArrowRight', 'pc_fan_stealth'], ['End', 'kitchen_vent_scrub'], ['ArrowRight', 'corsi_rosenthal'],
      ['ArrowLeft', 'kitchen_vent_scrub'], ['Home', 'corsi_rosenthal'], ['ArrowRight', 'pc_fan_stealth']
    ]) {
      await page.keyboard.press(key);
      await expect(tab(id), key).toBeFocused();
      await expect(tab(id), key).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.hack-tab-btn[tabindex="-1"]'), key).toHaveCount(3);
    }
    await expect(page.locator('#iaq-hack-title')).toContainText('PC-Fan');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.classList.contains('hack-tab-btn'))).toBe(false);
  });

  test('a whole session works without a pointer', async ({ app, page }) => {
    await app.open();
    await tabTo(page, app.keyInput);
    await page.keyboard.type(FAKE_KEY);
    await page.keyboard.press('Enter');
    await app.expectAdvice(defaultModel());

    await page.locator('.btn-persona[data-persona="vikram"]').focus();
    await page.keyboard.press('Enter');
    await expect(app.heroAqi).toHaveText('410');
    await tabTo(page, app.aqiSlider);
    await page.keyboard.press('ArrowRight');
    await expect(app.heroAqi).toHaveText('411');
    await tabTo(page, app.housing);
    await page.keyboard.press('ArrowDown');
    await expect(app.housing).toHaveValue('drafty_home');
    await tabTo(page, page.locator('input[name="radio-cooking"]:checked'));
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="radio-cooking"][value="png"]')).toBeChecked();
    await tabTo(page, app.kmSlider);
    await page.keyboard.press('End');
    await expect(app.kmLabel).toHaveText('50 km');
    await tabTo(page, page.locator('.input-vuln-checkbox[data-bit="4"]'));
    await page.keyboard.press('Space');
    await expect(page.locator('.input-vuln-checkbox[data-bit="4"]')).toBeChecked();

    const model = {
      city: 'Delhi NCR', aqi: 411, aqiSource: 'manual', vulnBits: 4, housingType: 'drafty_home',
      cookingMethod: 'png', heatingMethod: 'heat_pump', commuteMode: 'two_wheeler', commuteKm: 50
    };
    await app.refill();
    await tabTo(page, app.generateButton);
    await page.keyboard.press('Enter');
    await app.expectAdvice(model);
    await tabTo(page, app.langButton);
    await page.keyboard.press('Space');
    await expect(app.advisory).toContainText(`सामुदायिक सलाह ${tagFor(model)}`);
    await tabTo(page, page.locator('.hack-tab-btn[data-hack="corsi_rosenthal"]'));
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#iaq-hack-title')).toContainText('PC-Fan');
    await page.locator('#btn-clear-key').focus();
    await page.keyboard.press('Enter');
    await app.expectOffline();
  });
});

test.describe('mobile layout', () => {
  test('@mobile the first screen has no horizontal scroll and keeps controls in view', async ({ app, page }) => {
    await app.open();
    await expectFits(page);
  });

  test('@mobile model advice, Hindi text and the warning banner fit the screen', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await expectFits(page);
    await app.langButton.click();
    await expect(app.advisory).toHaveAttribute('lang', 'hi');
    await expectFits(page);
    mocks.gemini.always(errorReply(500));
    await app.choose('commute', 'private_car');
    await expect(app.banner).toBeVisible();
    await expectFits(page);
  });

  test('@mobile a 320 pixel wide screen has no horizontal scroll', async ({ app, page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await app.open();
    await app.activate();
    await app.persona('rajesh');
    await app.expectOffline().catch(() => {});
    await expectFits(page);
  });

  test('@mobile key controls are large enough to touch', async ({ app, page }) => {
    await app.open();
    for (const selector of [
      '#input-city', '#btn-detect-location', '#input-aqi-slider', '#btn-live-aqi', '#input-time-slider',
      '#select-housing-type', '#input-commute-km', '#btn-generate-plan', '#btn-toggle-lang',
      '#btn-copy-link', '#input-gemini-key', '.radio-chip-label', '.checkbox-label', '.btn-persona',
      '.hack-tab-btn'
    ]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box.height, selector).toBeGreaterThanOrEqual(44);
      expect(box.width, selector).toBeGreaterThanOrEqual(44);
    }
  });

  test('@mobile the main flow works by touch or pointer', async ({ app, page, hasTouch }) => {
    const press = (locator) => (hasTouch ? locator.tap() : locator.click());
    await app.open();
    await app.keyInput.fill(FAKE_KEY);
    await press(app.saveButton);
    await app.expectAdvice(defaultModel());
    await press(page.locator('.radio-chip-label', { hasText: 'Solo Car' }));
    const model = defaultModel({ commuteMode: 'private_car' });
    await app.expectFigures(model);
    await app.expectAdvice(model);
    await press(page.locator('.checkbox-label', { hasText: 'Senior Citizen' }));
    await app.expectAdvice({ ...model, vulnBits: 7 });
    await press(app.purgeButton);
    await app.expectOffline();
  });
});
