/**
 * @fileoverview Number consistency: cards, bars, advisory text and the Gemini prompt must all
 * carry the same figures, with and without a model.
 * @module test/e2e/consistency
 */

import { contextToHashToken } from '../../src/js/state-codec.js';
import { getDiurnalInversion, projectDiurnalReading } from '../../src/js/air-quality-engine.js';
import { test, expect, defaultModel, liveAqiFor, OBSERVED_AT } from './fixtures.js';

const CONTEXTS = [
  { label: 'default household', aqi: 395 },
  { label: 'clean air', aqi: 0, vulnBits: 0, commuteMode: 'walk_cycle' },
  { label: 'good boundary', aqi: 50, housingType: 'sealed_apartment', commuteMode: 'public_transit' },
  { label: 'between breakpoints', aqi: 100, city: 'Patna', cookingMethod: 'png' },
  { label: 'solo car long commute', aqi: 201, commuteMode: 'private_car', commuteKm: 50 },
  { label: 'all vulnerabilities', aqi: 460, vulnBits: 31, housingType: 'drafty_home', cookingMethod: 'biomass' },
  { label: 'maximum AQI', aqi: 999, city: 'Ulaanbaatar', heatingMethod: 'open_fire', commuteKm: 1 },
  { label: 'detected place name', aqi: 301, city: 'Karol Bagh, New Delhi' }
];

/**
 * Daily CO2e in kg that moving a motorised commute to the metro saves, from the published
 * well-to-wheel factors in grams per km.
 *
 * @param {Object} model - Household context.
 * @returns {number} Saving rounded to two decimals, zero for walking, cycling and the metro.
 */
function commuteSavingKg({ commuteMode, commuteKm }) {
  const gramsPerKm = { private_car: 240, two_wheeler: 60 }[commuteMode];
  return gramsPerKm ? Math.round((gramsPerKm - 28) * commuteKm / 10) / 100 : 0;
}

/**
 * Daily CO2e in kg that six hours on a heat pump save against the current heater. Space
 * heaters carry no emission factor in the model.
 *
 * @param {Object} model - Household context.
 * @returns {number} Saving rounded to two decimals.
 */
function heatingSavingKg({ heatingMethod }) {
  const gramsPerHour = { open_fire: 930, electric_radiator: 288 }[heatingMethod];
  return gramsPerHour ? Math.round((gramsPerHour - 96) * 6 / 10) / 100 : 0;
}

/**
 * Severity label the screen must show for an AQI.
 *
 * @param {number} aqi - AQI.
 * @returns {string} Severity code.
 */
function severityFor(aqi) {
  const band = [[50, 'GOOD'], [100, 'MODERATE'], [200, 'POOR'], [300, 'VERY_POOR'], [400, 'SEVERE']]
    .find(([limit]) => aqi <= limit);
  return band ? band[1] : 'HAZARDOUS';
}

test.describe('on-device consistency', () => {
  test('the default household shows hand calculated figures', async ({ app }) => {
    const token = contextToHashToken(defaultModel({ aqi: 395, simulatedHour: null }));
    await app.open(`#${token}`);

    await expect.poll(() => app.figures()).toMatchObject({
      hero: '395',
      avoided: '818 µg',
      cigarettes: '12.3 Cigs',
      carbon: '0.45 kg',
      score: '59%',
      unshielded: '1394 µg (21.0 Cigs)',
      shielded: '576 µg (8.7 Cigs)',
      delta: 'Saved: 818 µg (12.3 Cigs)',
      reduction: '-58.7% Inhaled Dose',
      barWidth: 41.3,
      contributions: 'Avoided today: indoor air 655 µg · window timing 112 µg · travel 51 µg'
    });
    await expect(app.advisory).toContainText('818 µg');
    await expect(app.alternatives).toContainText('save about 0.45 kg CO2e a day');
  });

  for (const { label, ...overrides } of CONTEXTS) {
    test(`${label}: cards, bars, inputs and advisory agree`, async ({ app, page }) => {
      const model = defaultModel({ aqiSource: 'manual', ...overrides });
      await app.open(`#${contextToHashToken({ ...model, simulatedHour: null })}`);

      await app.expectFigures(model);
      await expect(page.locator('#hero-severity-badge')).toHaveText(severityFor(model.aqi));
      await expect(page.locator('#badge-cleaning-status'))
        .toHaveText(model.aqi > 200 ? 'DRY SWEEPING PROHIBITED' : 'STANDARD DAMP DUSTING');
      const commuteKg = commuteSavingKg(model);
      if (commuteKg > 0) {
        await expect(app.alternatives).toContainText(`save about ${commuteKg} kg CO2e a day`);
      } else {
        await expect(app.alternatives).toContainText('already low-carbon');
      }
      const totalKg = Math.round((commuteKg + heatingSavingKg(model)) * 100) / 100;
      await expect(page.locator('#metric-carbon-saved')).toHaveText(`${totalKg} kg`);
      await expect(app.breakdownItems).toHaveCount(5);
      const visible = await page.locator('main').innerText();
      expect(visible).not.toMatch(/NaN|undefined|Infinity|\[object/);
    });
  }

  test('moving the AQI across its whole range keeps every figure in step', async ({ app }) => {
    await app.open();
    for (const aqi of [0, 1, 50, 51, 100, 101, 200, 201, 300, 301, 400, 401, 500, 501, 999]) {
      await app.aqiSlider.fill(String(aqi));
      await app.expectFigures(defaultModel({ aqi, aqiSource: 'manual' }));
    }
  });

  test('a live reading is scaled from its own hour and a manual value from the daily baseline', async ({ app, page }) => {
    await app.open();
    const badge = page.locator('#label-scrubber-telemetry');
    const live = liveAqiFor('Delhi NCR');
    const projected = projectDiurnalReading(7.5, live, OBSERVED_AT);
    await expect(badge).toHaveText(
      `AQI ${projected.effectiveAQI} (${projected.ratio.toFixed(2)}x vs 10:00, Trap)`
    );

    await app.timeSlider.fill('10');
    await expect(badge).toHaveText(`AQI ${live} (1.00x vs 10:00, Trap)`);

    await app.aqiSlider.fill('200');
    const manual = getDiurnalInversion(10, 200);
    await expect(badge).toHaveText(`AQI ${manual.effectiveAQI} (${manual.multiplier.toFixed(2)}x Trap)`);
  });

  test('the severity badge, scrubber telemetry and curve follow the AQI', async ({ app, page }) => {
    await app.open();
    const marker = page.locator('#svg-spline-marker');
    for (const aqi of [40, 150, 420, 999]) {
      await app.aqiSlider.fill(String(aqi));
      await expect(page.locator('#hero-severity-badge')).toHaveText(severityFor(aqi));
      const { effectiveAQI, multiplier } = getDiurnalInversion(7.5, aqi);
      await expect(page.locator('#label-scrubber-telemetry'))
        .toHaveText(`AQI ${effectiveAQI} (${multiplier.toFixed(2)}x Trap)`);
    }
    await expect(marker).toHaveAttribute('cx', '75');
  });
});

test.describe('model mode consistency', () => {
  const steps = [
    ['baseline', async () => {}, {}],
    ['solo car', (app) => app.choose('commute', 'private_car'), { commuteMode: 'private_car' }],
    ['longer commute', (app) => app.kmSlider.fill('37'), { commuteKm: 37 }],
    ['sealed home', (app) => app.housing.selectOption('sealed_apartment'), { housingType: 'sealed_apartment' }],
    ['PC fan hack', (app) => app.hack('pc_fan_stealth'), { hackId: 'pc_fan_stealth' }],
    ['pregnant resident', (app) => app.setVulnerability(8, true), { vulnBits: 11 }],
    ['manual low AQI', (app) => app.aqiSlider.fill('73'), { aqi: 73, aqiSource: 'manual' }]
  ];

  test('prompt facts equal the figures on screen at every step', async ({ app, mocks }) => {
    let model = defaultModel();
    await app.open();
    await app.activate(model);
    for (const [label, act, patch] of steps) {
      await test.step(label, async () => {
        await app.refill();
        await act(app);
        model = { ...model, ...patch };
        await app.expectAdvice(model);
        await app.expectFigures(model);

        const { facts } = mocks.gemini.calls.at(-1);
        const shown = await app.figures();
        expect(String(facts.aqi)).toBe(shown.hero);
        expect(facts.city).toBe(model.city);
        expect(`${facts.computed.pm25AvoidedUg} µg`).toBe(shown.avoided);
        expect(`${facts.computed.cigarettesAvoided.toFixed(1)} Cigs`).toBe(shown.cigarettes);
        expect(`${facts.computed.carbonSavedKg} kg`).toBe(shown.carbon);
        expect(`${facts.computed.protectionScore}%`).toBe(shown.score);
        expect(shown.unshielded.startsWith(`${facts.computed.unshieldedDoseUg} µg`)).toBe(true);
        expect(shown.shielded.startsWith(`${facts.computed.protectedDoseUg} µg`)).toBe(true);
      });
    }
  });

  test('the same inputs give the same figures with and without the model', async ({ app }) => {
    await app.open();
    await app.expectFigures(defaultModel());
    const offline = await app.figures();

    await app.activate();
    expect(await app.figures()).toEqual(offline);

    await app.purgeButton.click();
    await app.expectOffline();
    expect(await app.figures()).toEqual(offline);
  });

  test('cached advice shown during a refresh is re-framed with the current figures', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    const gate = mocks.gemini.hold();
    await app.aqiSlider.fill('88');
    const model = defaultModel({ aqi: 88, aqiSource: 'manual' });

    await app.expectFigures(model);
    await expect(app.advisory).not.toContainText(`(AQI ${defaultModel().aqi})`);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await gate.release();
    await app.expectAdvice(model);
  });

  test('the prompt carries only whitelisted household fields', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    const { facts } = mocks.gemini.calls[0];
    expect(Object.keys(facts).sort()).toEqual([
      'aqi', 'aqiBand', 'aqiSource', 'choices', 'city', 'commuteKm', 'commuteMode', 'computed',
      'cookingMethod', 'heatingMethod', 'housingType', 'vulnerabilities'
    ]);
    expect(facts.aqiBand).toBe(severityFor(facts.aqi).toLowerCase().replace('_', ' '));
    expect(facts.choices.map((item) => item.choice))
      .toEqual(['iaq_hack', 'cooking', 'heating', 'commute', 'housing']);
    for (const item of facts.choices) {
      expect(Object.keys(item).sort()).toEqual(['choice', 'co2e', 'current', 'inhaledPm25']);
      for (const finding of [item.inhaledPm25, item.co2e]) {
        expect(['can_improve', 'already_best', 'not_modelled']).toContain(finding);
      }
    }
  });
});
