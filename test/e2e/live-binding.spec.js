/**
 * @fileoverview Live binding: after a live plan, every input must immediately move the local
 * figures and then bring model advice that belongs to exactly the latest inputs.
 * @module test/e2e/live-binding
 */

import {
  test, expect, FAKE_KEY, DEFAULT_HACK, defaultModel, personaModel, liveAqiFor, tagFor, computeImpact
} from './fixtures.js';

/**
 * One user change that must produce exactly one fresh Gemini request.
 */
const CHANGES = [
  {
    name: 'city to Lahore',
    act: (app) => app.citySelect.selectOption('Lahore'),
    patch: { city: 'Lahore', aqi: liveAqiFor('Lahore'), aqiSource: 'live' }
  },
  {
    name: 'AQI slider',
    act: (app) => app.aqiSlider.fill('150'),
    patch: { aqi: 150, aqiSource: 'manual' }
  },
  {
    name: 'AQI number box',
    act: (app) => app.aqiBox.fill('42'),
    patch: { aqi: 42, aqiSource: 'manual' }
  },
  ...['sealed_apartment', 'drafty_home'].map((value) => ({
    name: `housing ${value}`,
    act: (app) => app.housing.selectOption(value),
    patch: { housingType: value }
  })),
  ...['induction', 'png', 'biomass'].map((value) => ({
    name: `cooking ${value}`,
    act: (app) => app.choose('cooking', value),
    patch: { cookingMethod: value }
  })),
  ...['electric_radiator', 'heat_pump', 'open_fire'].map((value) => ({
    name: `heating ${value}`,
    act: (app) => app.choose('heating', value),
    patch: { heatingMethod: value }
  })),
  ...['walk_cycle', 'public_transit', 'private_car'].map((value) => ({
    name: `commute ${value}`,
    act: (app) => app.choose('commute', value),
    patch: { commuteMode: value }
  })),
  {
    name: 'commute distance',
    act: (app) => app.kmSlider.fill('41'),
    patch: { commuteKm: 41 }
  },
  ...['pc_fan_stealth', 'wet_towel_emergency', 'kitchen_vent_scrub'].map((value) => ({
    name: `DIY hack ${value}`,
    act: (app) => app.hack(value),
    patch: { hackId: value }
  })),
  ...[[4, true], [8, true], [16, true], [1, false], [2, false]].map(([bit, checked]) => ({
    name: `vulnerability bit ${bit} ${checked ? 'added' : 'removed'}`,
    act: (app) => app.setVulnerability(bit, checked),
    patch: (model) => ({ vulnBits: checked ? model.vulnBits | bit : model.vulnBits & ~bit })
  })),
  ...['ananya', 'rajesh', 'vikram', 'ramesh'].map((id) => ({
    name: `persona ${id}`,
    act: (app) => app.persona(id),
    patch: personaModel(id)
  }))
];

/**
 * Context expected after a change is applied.
 *
 * @param {Object} model - Context before the change.
 * @param {Object} change - Entry of {@link CHANGES}.
 * @returns {Object} Context after the change.
 */
function applyChange(model, change) {
  return { ...model, ...(typeof change.patch === 'function' ? change.patch(model) : change.patch) };
}

/**
 * Asserts that every control shows the expected context.
 *
 * @param {import('./fixtures.js').CleanAirPage} app - Page object.
 * @param {Object} model - Expected context.
 */
async function expectControls(app, model) {
  await expect(app.citySelect).toHaveValue(model.city);
  await expect(app.aqiSlider).toHaveValue(String(model.aqi));
  await expect(app.aqiBox).toHaveValue(String(model.aqi));
  await expect(app.housing).toHaveValue(model.housingType);
  await expect(app.kmSlider).toHaveValue(String(model.commuteKm));
  await expect(app.kmLabel).toHaveText(`${model.commuteKm} km`);
  for (const [group, value] of [
    ['cooking', model.cookingMethod], ['heating', model.heatingMethod], ['commute', model.commuteMode]
  ]) {
    await expect(app.page.locator(`input[name="radio-${group}"][value="${value}"]`)).toBeChecked();
  }
  for (const bit of [1, 2, 4, 8, 16]) {
    await expect(app.page.locator(`.input-vuln-checkbox[data-bit="${bit}"]`))
      .toBeChecked({ checked: Boolean(model.vulnBits & bit) });
  }
  await expect(app.page.locator('.hack-tab-btn[aria-selected="true"]'))
    .toHaveAttribute('data-hack', model.hackId ?? DEFAULT_HACK);
  await expect(app.page.locator('#label-unshielded-desc')).toHaveText(
    `🔴 Unshielded Exposure (${model.housingType.replace(/_/g, ' ')} / ${model.commuteMode.replace(/_/g, ' ')})`
  );
}

test.describe('each input after a live plan', () => {
  for (const change of CHANGES) {
    test(`${change.name}: figures move at once, advice follows the new inputs`, async ({ app, mocks }) => {
      const before = defaultModel();
      const after = applyChange(before, change);
      await app.open();
      await app.activate(before);

      const gate = mocks.gemini.hold();
      await change.act(app);

      await app.expectFigures(after);
      await expectControls(app, after);
      await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
      await expect(app.cards.first()).toContainText(tagFor(before));
      await expect.poll(() => mocks.gemini.calls.length).toBe(2);
      expect(tagFor(after)).not.toBe(tagFor(before));

      await gate.release();

      await app.expectAdvice(after);
      await app.expectFigures(after);
      await app.expectIdle();
      await expect(app.schedule).not.toContainText(tagFor(before));
      expect(mocks.gemini.calls).toHaveLength(2);
    });
  }

  test('one long session walking every input keeps advice bound after each step', async ({ app, mocks }) => {
    test.slow();
    let model = defaultModel();
    await app.open();
    await app.activate(model);
    for (const change of CHANGES) {
      await test.step(change.name, async () => {
        await app.refill();
        const next = applyChange(model, change);
        const isDifferent = tagFor(next) !== tagFor(model);
        const callsBefore = mocks.gemini.calls.length;
        await change.act(app);
        model = next;
        await app.expectAdvice(model);
        await app.expectFigures(model);
        await expectControls(app, model);
        if (isDifferent) expect(mocks.gemini.calls.length).toBeGreaterThan(callsBefore);
      });
    }
  });
});

test.describe('hack tabs', () => {
  test('each tab swaps the DIY hack, clearance times and figures, and asks for advice on it', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    const clearanceTimes = new Set();
    const hacks = [
      ['pc_fan_stealth', 'PC-Fan', '85 CFM', '85'],
      ['wet_towel_emergency', 'Wet-Towel', 'Stopgap', '30'],
      ['kitchen_vent_scrub', 'Kitchen Exhaust', '180 CFM', '180'],
      ['corsi_rosenthal', 'Corsi-Rosenthal', '273 CFM', '273']
    ];
    for (const [index, [id, title, rating, cadr]] of hacks.entries()) {
      await app.refill();
      await app.hack(id);
      const model = defaultModel({ hackId: id });

      await expect(page.locator('#iaq-hack-title')).toContainText(title);
      await expect(page.locator('#iaq-hack-cadr')).toContainText(rating);
      await expect(page.locator('#select-cadr-device')).toHaveValue(cadr);
      await expect(page.locator(`.hack-tab-btn[data-hack="${id}"]`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.hack-tab-btn[aria-selected="true"]')).toHaveCount(1);
      await app.expectFigures(model);
      await app.expectAdvice(model);
      clearanceTimes.add(await page.locator('#cadr-t90').textContent());
      expect(mocks.gemini.calls).toHaveLength(index + 2);
    }
    expect(clearanceTimes.size).toBe(4);
  });
});

test.describe('inputs that must not call Gemini', () => {
  test('time scrubbing updates notice, clock and telemetry locally', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    const expectations = [
      ['7.5', '07:30', /radiation inversion trap/, 'Trap'],
      ['13', '13:00', /Peak planetary boundary layer/, 'Safe'],
      ['19.25', '19:15', /Secondary evening inversion/, 'Trap'],
      ['0', '00:00', /Stable nocturnal/, 'Trap'],
      ['23.75', '23:45', /Stable nocturnal/, 'Trap']
    ];
    for (const [value, label, notice, phase] of expectations) {
      await app.timeSlider.fill(value);
      await expect(app.timeLabel).toHaveText(label);
      await expect(page.locator('#hero-inversion-notice')).toHaveText(notice);
      await expect(page.locator('#label-scrubber-telemetry')).toContainText(phase);
      await app.expectAdvice(defaultModel());
      await app.expectFigures(defaultModel());
    }
    await app.refill();
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('language toggle switches the advisory both ways without a new call', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await app.langButton.click();

    await expect(page.locator('#label-current-lang')).toHaveText('हिन्दी');
    await expect(app.advisory).toHaveAttribute('lang', 'hi');
    await expect(app.advisory).toContainText(`सामुदायिक सलाह ${tagFor(defaultModel())}`);
    await expect(app.advisory).toContainText(`${computeImpact(defaultModel()).pm25AvoidedUg} µg`);

    await app.langButton.click();
    await expect(app.advisory).toHaveAttribute('lang', 'en');
    await expect(app.advisory).toContainText(`Neighbourhood note ${tagFor(defaultModel())}`);
    await app.refill();
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('Hindi stays selected when new advice arrives', async ({ app }) => {
    await app.open();
    await app.activate();
    await app.langButton.click();
    await app.choose('commute', 'private_car');

    const next = defaultModel({ commuteMode: 'private_car' });
    await app.expectAdvice(next);
    await expect(app.advisory).toContainText(`सामुदायिक सलाह ${tagFor(next)}`);
    await expect(app.advisory).toHaveAttribute('lang', 'hi');
  });

  test('room size, unit and device inputs recompute clearance only', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    const t50 = page.locator('#cadr-t50');
    const initial = await t50.textContent();

    await page.locator('#input-room-l').fill('30');
    await expect(t50).not.toHaveText(initial);
    await expect(page.locator('#cadr-room-volume')).toContainText('3,240');
    await page.locator('#btn-unit-m').click();
    await expect(page.locator('#input-room-l')).toHaveValue('9.14');
    await page.locator('#input-room-w').fill('5');
    await page.locator('#input-room-h').fill('3');
    await page.locator('#select-cadr-device').selectOption('custom');
    await page.locator('#input-cadr-custom').fill('500');
    await expect(page.locator('#container-cadr-custom')).toBeVisible();

    await app.refill();
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('changes that end on the advised inputs reuse the cached advice', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    await app.setVulnerability(4, true);
    await app.setVulnerability(4, false);
    await app.choose('commute', 'private_car');
    await app.choose('commute', 'two_wheeler');
    await app.kmSlider.fill('30');
    await app.kmSlider.fill('14');
    await app.advance(5000);

    await app.expectAdvice(defaultModel());
    await app.expectFigures(defaultModel());
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(1);
  });
});

test.describe('dispatch timing and busy state', () => {
  test('a change dispatches after exactly the 800 ms quiet period', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    await app.choose('cooking', 'induction');
    await app.advance(500);
    await app.choose('heating', 'heat_pump');
    await app.advance(799);
    expect(mocks.gemini.calls).toHaveLength(1);
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await expect(app.schedule).toHaveAttribute('aria-busy', 'true');
    await expect(app.generateButton).toBeEnabled();

    await app.advance(2);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(defaultModel({ cookingMethod: 'induction', heatingMethod: 'heat_pump' }));
  });

  test('save, recalculate and purge act without waiting for the quiet period', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();

    await app.saveKey(FAKE_KEY);
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.settleAdvice(defaultModel());

    await app.generateButton.click();
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(defaultModel());

    await app.purgeButton.click();
    await app.advance(100);
    await app.expectOffline();
  });

  test('recalculate during the quiet period sends one request, not two', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    await app.choose('commute', 'public_transit');
    await app.generateButton.click();
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.advance(3000);

    await app.settleAdvice(defaultModel({ commuteMode: 'public_transit' }));
    expect(mocks.gemini.calls).toHaveLength(2);
  });

  test('recalculate forces a new request for unchanged inputs', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.generateButton.click();

    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls[1].facts).toEqual(mocks.gemini.calls[0].facts);
  });

  test('busy indicators are on while fetching and off afterwards', async ({ app, mocks }) => {
    await app.open();
    const gate = mocks.gemini.hold();
    await app.saveKey();

    await expect(app.generateButton).toBeDisabled();
    await expect(app.generateButton).toHaveText('Refining AI Plan... ✨');
    await expect(app.spinner).toBeVisible();
    await expect(app.spinnerText).toHaveText('Refreshing advice');
    await expect(app.schedule).toHaveAttribute('aria-busy', 'true');

    await gate.release();
    await app.expectAdvice(defaultModel());
    await app.expectIdle();
  });
});

test.describe('AQI number box stays bound to the applied value', () => {
  for (const [label, typed, applied] of [
    ['above the maximum', '1500', '999'],
    ['below zero', '-25', '0'],
    ['with decimals', '12.6', '13']
  ]) {
    test(`a value ${label} is shown as the applied value after leaving the box`, async ({ app }) => {
      await app.open();
      await app.aqiBox.fill(typed);
      await app.aqiBox.press('Tab');

      await expect(app.heroAqi).toHaveText(applied);
      await expect(app.aqiSlider).toHaveValue(applied);
      await expect(app.aqiBox).toHaveValue(applied);
    });
  }

  test('an emptied box shows the AQI still in use after leaving it', async ({ app }) => {
    await app.open();
    await app.aqiBox.fill('');
    await app.aqiBox.press('Tab');

    await expect(app.heroAqi).toHaveText(String(liveAqiFor('Delhi NCR')));
    await expect(app.aqiBox).toHaveValue(String(liveAqiFor('Delhi NCR')));
  });

  test('digit by digit typing ends bound to the full number', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();
    await app.aqiBox.fill('');
    await app.aqiBox.pressSequentially('287');
    await app.advance(900);

    const model = defaultModel({ aqi: 287, aqiSource: 'manual' });
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(model);
    await app.expectFigures(model);
  });
});

test.describe('sharing carries the latest inputs', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      window.copied = [];
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text) => { window.copied.push(text); } },
        configurable: true
      });
    });
  });

  test('copied advisory and link reflect the advice and inputs on screen', async ({ app, page }) => {
    await app.open();
    await app.activate();
    await app.choose('commute', 'private_car');
    const model = defaultModel({ commuteMode: 'private_car' });
    await app.expectAdvice(model);

    await app.copyAdvisoryButton.click();
    await expect(app.copyAdvisoryButton).toContainText('Copied');
    await app.copyLinkButton.click();
    await expect(app.copyLinkButton).toContainText('Copied');

    const [advisory, link] = await page.evaluate(() => window.copied);
    expect(advisory).toContain(tagFor(model));
    expect(advisory).not.toContain(tagFor(defaultModel()));
    expect(advisory).toContain(page.url());
    expect(link).toBe(page.url());
    expect(link).not.toContain(FAKE_KEY);
  });

  test('copied Hindi advisory is the Hindi text on screen', async ({ app, page }) => {
    await app.open();
    await app.activate();
    await app.langButton.click();
    await expect(app.advisory).toHaveAttribute('lang', 'hi');
    await app.copyAdvisoryButton.click();

    const [advisory] = await page.evaluate(() => window.copied);
    expect(advisory).toContain(`सामुदायिक सलाह ${tagFor(defaultModel())}`);
  });
});
