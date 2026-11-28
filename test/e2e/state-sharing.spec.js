/**
 * @fileoverview State in the URL: round trip of every option, reload, shared and malformed
 * links.
 * @module test/e2e/state-sharing
 */

import { METRO_BASIN_PRESETS } from '../../src/js/config.js';
import { contextToHashToken, encodeBase64URL } from '../../src/js/state-codec.js';
import { test, expect, CleanAirPage, defaultModel, liveAqiFor, personaModel } from './fixtures.js';

/**
 * Reads every state bearing control and the headline figures.
 *
 * @param {import('@playwright/test').Page} page - Page.
 * @returns {Promise<Object>} Snapshot.
 */
function readScreen(page) {
  return page.evaluate(() => {
    const value = (id) => document.getElementById(id).value;
    const text = (id) => document.getElementById(id).textContent.trim();
    const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
    return {
      city: value('input-city'),
      slider: value('input-aqi-slider'),
      box: value('input-aqi-number'),
      time: value('input-time-slider'),
      timeLabel: text('label-time-value'),
      housing: value('select-housing-type'),
      cooking: radio('radio-cooking'),
      heating: radio('radio-heating'),
      commute: radio('radio-commute'),
      km: value('input-commute-km'),
      kmLabel: text('label-commute-km'),
      vulnerabilities: [...document.querySelectorAll('.input-vuln-checkbox')]
        .reduce((bits, box) => bits | (box.checked ? Number(box.dataset.bit) : 0), 0),
      hero: text('hero-aqi-number'),
      avoided: text('metric-pm25-avoided'),
      carbon: text('metric-carbon-saved'),
      notice: text('hero-inversion-notice'),
      telemetry: text('label-scrubber-telemetry')
    };
  });
}

/**
 * Opens the current address in a second tab and asserts it reproduces the screen.
 *
 * @param {import('./fixtures.js').CleanAirPage} app - Source page object.
 * @param {import('./fixtures.js').CleanAirPage} copy - Receiving page object.
 */
async function expectRoundTrip(app, copy) {
  await app.page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }));
  const original = await readScreen(app.page);
  const url = new URL(app.page.url());
  await copy.page.goto('about:blank');
  await copy.open(url.hash);
  await expect.poll(() => readScreen(copy.page)).toEqual(original);
}

test.describe('round trip of every option', () => {
  const groups = {
    city: METRO_BASIN_PRESETS.map((city) => [city, (app) => app.citySelect.selectOption(city)]),
    aqi: ['0', '1', '256', '500', '998', '999'].map((aqi) => [aqi, (app) => app.aqiSlider.fill(aqi)]),
    time: ['0', '0.25', '1', '6', '7.5', '12.75', '23', '23.75'].map((hour) => [hour, (app) => app.timeSlider.fill(hour)]),
    housing: ['sealed_apartment', 'drafty_home', 'standard_flat'].map((v) => [v, (app) => app.housing.selectOption(v)]),
    cooking: ['induction', 'png', 'biomass', 'lpg'].map((v) => [v, (app) => app.choose('cooking', v)]),
    heating: ['electric_radiator', 'heat_pump', 'open_fire', 'space_heater'].map((v) => [v, (app) => app.choose('heating', v)]),
    commute: ['walk_cycle', 'public_transit', 'private_car', 'two_wheeler'].map((v) => [v, (app) => app.choose('commute', v)]),
    distance: ['1', '7', '14', '33', '50'].map((v) => [v, (app) => app.kmSlider.fill(v)]),
    persona: ['ananya', 'rajesh', 'vikram', 'ramesh'].map((v) => [v, (app) => app.persona(v)]),
    vulnerability: [1, 2, 4, 8, 16].map((bit) => [`bit ${bit}`, async (app) => {
      for (const other of [1, 2, 4, 8, 16]) {
        await app.setVulnerability(other, other === bit);
      }
    }])
  };

  for (const [group, values] of Object.entries(groups)) {
    test(`${group}: each value survives opening the link`, async ({ app, context }) => {
      test.slow();
      await app.open();
      const copy = new CleanAirPage(await context.newPage());
      for (const [label, act] of values) {
        await test.step(String(label), async () => {
          await act(app);
          await expect(app.page).toHaveURL(/#(b|v1)=/);
          if (group === 'city') {
            await expect(app.heroAqi).toHaveText(String(liveAqiFor(label)));
            await expect(app.sourceAqi).toContainText('AQI: Live');
          }
          await expectRoundTrip(app, copy);
        });
      }
    });
  }

  test('no vulnerabilities and all vulnerabilities both survive', async ({ app, context }) => {
    await app.open();
    const copy = new CleanAirPage(await context.newPage());
    for (const checked of [false, true]) {
      for (const bit of [1, 2, 4, 8, 16]) await app.setVulnerability(bit, checked);
      await expectRoundTrip(app, copy);
    }
  });

  test('a fully customised household survives a reload', async ({ app, page }) => {
    await app.open();
    await app.persona('ramesh');
    await app.aqiSlider.fill('0');
    await app.timeSlider.fill('0');
    await app.kmSlider.fill('49');
    await app.setVulnerability(8, true);
    await expect(app.kmLabel).toHaveText('49 km');
    await expect(page.locator('#hero-inversion-notice'))
      .toContainText('Mornings and evenings are usually a little hazier than midday.');
    await expect(page.locator('#hero-inversion-notice')).not.toContainText('nocturnal');
    await expect(app.heroAqi).toHaveText('0');
    const before = await readScreen(page);
    await page.reload();

    await expect.poll(() => readScreen(page)).toEqual(before);
    await expect(app.sourceAqi).toHaveText('AQI: Manual');
  });
});

test.describe('link format and mode', () => {
  test('compact links are used when lossless and the long form otherwise', async ({ app, page }) => {
    await app.open();
    await app.persona('vikram');
    await expect(page).toHaveURL(/#b=[\w-]{7}$/);
    await app.housing.selectOption('drafty_home');
    await expect(page).toHaveURL(/#v1=[\w-]+$/);
    await app.housing.selectOption('standard_flat');
    await expect(page).toHaveURL(/#b=[\w-]{7}$/);
    await app.timeSlider.fill('13.5');
    await expect(page).toHaveURL(/#v1=[\w-]+$/);
  });

  test('a live link fetches the current value instead of the stored one', async ({ app, mocks }) => {
    const stored = defaultModel({ city: 'Lahore', aqi: 11 });
    await app.open(`#${contextToHashToken(stored)}&live=1`);

    await app.expectFigures(defaultModel({ city: 'Lahore', aqi: liveAqiFor('Lahore') }));
    expect(mocks.air.calls).toHaveLength(1);
  });

  test('a shared link gives the recipient the same advice inputs for the model', async ({ app, mocks }) => {
    const model = personaModel('rajesh');
    await app.open(`#${contextToHashToken(model)}`);
    await app.activate(model);

    await app.expectFigures(model);
    expect(mocks.gemini.calls[0].facts.city).toBe('Lahore');
  });

  test('a non Latin place name survives a link', async ({ app }) => {
    const model = defaultModel({ city: 'करोल बाग, दिल्ली', aqi: 210, aqiSource: 'manual' });
    await app.open(`#${contextToHashToken(model)}`);
    await expect(app.citySelect).toHaveValue(model.city);
    await app.expectFigures(model);
  });

  test('language and hack choice reset on reload while the household stays', async ({ app, page }) => {
    await app.open();
    await app.persona('ananya');
    await app.langButton.click();
    await app.hack('pc_fan_stealth');
    await page.reload();

    await expect(app.advisory).toHaveAttribute('lang', 'en');
    await expect(page.locator('.hack-tab-btn[aria-selected="true"]')).toHaveAttribute('data-hack', 'corsi_rosenthal');
    await expect(app.heroAqi).toHaveText('425');
  });

  test('pasting another shared link into the open tab applies it', async ({ app, page }) => {
    await app.open();
    const target = personaModel('rajesh');
    await page.evaluate((hash) => { window.location.hash = hash; }, contextToHashToken(target));

    await expect(app.citySelect).toHaveValue('Lahore', { timeout: 2000 });
    await app.expectFigures(target);
  });

  test('a pasted link restores its simulated time', async ({ app, page }) => {
    await app.open();
    const hash = contextToHashToken({ ...personaModel('rajesh'), simulatedHour: 20 });
    await page.evaluate((value) => { window.location.hash = value; }, hash);

    await expect(app.timeSlider).toHaveValue('20', { timeout: 2000 });
    await expect(page.locator('#label-time-value')).toHaveText('20:00');
  });

  test('a place from a link is not labelled as the device position', async ({ app }) => {
    const model = defaultModel({ city: 'Karol Bagh, New Delhi', aqi: 210, aqiSource: 'manual' });
    await app.open(`#${contextToHashToken(model)}`);

    await expect(app.citySelect.locator('option:checked')).toHaveText(model.city);
  });
});

test.describe('malformed and hostile links', () => {
  const v1 = (fields) => `#v1=${encodeBase64URL(fields.join('|'))}`;

  for (const [label, hash] of [
    ['random text', '#garbage-value'],
    ['broken base64', '#b=!!!!!!!'],
    ['short compact token', '#b=AA'],
    ['empty long token', '#v1=aaaa'],
    ['non base64 long token', '#v1=%%%%%'],
    ['too few fields', v1(['Delhi NCR', '10'])]
  ]) {
    test(`${label} still gives a working, self consistent screen`, async ({ app, page }) => {
      await app.open(hash);
      const screen = await readScreen(page);
      expect(screen.hero).toBe(screen.slider);
      expect(screen.hero).toBe(screen.box);
      expect(screen.avoided).toMatch(/^\d+ µg$/);
      expect(screen.cooking).not.toBeNull();
      await app.aqiSlider.fill('100');
      await expect(app.heroAqi).toHaveText('100');
    });
  }

  test('script in the city name is neutralised', async ({ app, page }) => {
    await app.open(v1(['<script>window.injected=1</script>', 100, 0, 0, 0, 0, '', 5, 0]));

    expect(await app.citySelect.inputValue()).not.toMatch(/[<>/=]/);
    await expect(page.locator('main script')).toHaveCount(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  });

  test('out of range numbers in a long link are clamped', async ({ app }) => {
    await app.open(v1(['Lahore', 99999, 999, 9, 9, 9, 99, 14, 9]));

    await app.expectFigures(defaultModel({
      city: 'Lahore', aqi: 999, vulnBits: 31, aqiSource: 'manual'
    }));
    await expect(app.timeSlider).toHaveValue('23.75');
  });

  test('negative numbers in a long link are clamped to zero', async ({ app }) => {
    await app.open(v1(['Lahore', -50, -3, 0, 0, 0, -5, 14, 0]));
    await expect(app.heroAqi).toHaveText('0');
    await expect(app.aqiBox).toHaveValue('0');
    await expect(app.timeSlider).toHaveValue('0');
  });

  test('a compact link with an AQI above 999 shows one agreed value', async ({ app, page }) => {
    await app.open(`#${contextToHashToken(defaultModel({ aqi: 1023 }))}`);
    const screen = await readScreen(page);

    expect(screen.slider).toBe('999');
    expect(screen.box).toBe('999');
    expect(screen.hero).toBe('999');
  });

  test('a link with a distance beyond the slider shows one agreed distance', async ({ app, page }) => {
    await app.open(`#${contextToHashToken(defaultModel({ commuteKm: 120 }))}`);
    const screen = await readScreen(page);

    expect(screen.kmLabel).toBe(`${screen.km} km`);
  });

  test('a link with a fractional AQI shows one agreed value', async ({ app, page }) => {
    await app.open(v1(['Lahore', 100.6, 0, 0, 0, 0, '', 5, 0]));
    const screen = await readScreen(page);

    expect(screen.hero).toBe(screen.box);
    expect(screen.hero).toBe(screen.slider);
  });
});
