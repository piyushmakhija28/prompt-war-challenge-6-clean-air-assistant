/**
 * @fileoverview Live air quality: success, bad payloads, outage, manual override, return to
 * live, timed refresh and geolocation.
 * @module test/e2e/live-aqi
 */

import { METRO_BASIN_PRESETS } from '../../src/js/config.js';
import { contextToHashToken } from '../../src/js/state-codec.js';
import {
  test, expect, defaultModel, liveAqiFor, pm25ForCity, airReply, massConcentrationToAqi,
  METRO_BASIN_COORDINATES, DEFAULT_PM25
} from './fixtures.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const KOLKATA_FIX = Object.freeze({ latitude: 22.6512, longitude: 88.4487 });
const UNREACHABLE = 'Live air quality is unreachable. Showing the last known value.';

test.describe('live feed', () => {
  test('startup fetches once and labels the value as a live estimate', async ({ app, page, mocks }) => {
    await app.open();

    await app.expectFigures(defaultModel());
    await expect(app.sourceAqi).toHaveText('AQI: Live · Open-Meteo estimate (2026-11-28 10:00)');
    await expect(app.liveButton).toHaveText('Refresh live AQI');
    await expect(page).toHaveURL(/#b=[\w-]+&live=1$/);
    await expect(page.getByRole('link', { name: /Open-Meteo/ })).toBeVisible();
    expect(mocks.air.calls).toHaveLength(1);
    const query = new URL(mocks.air.calls[0].url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      latitude: '28.61', longitude: '77.21', current: 'pm2_5,pm10', timezone: 'auto'
    });
    expect(mocks.bigDataCloud.calls).toHaveLength(0);
    expect(mocks.nominatim.calls).toHaveLength(0);
  });

  test('every listed city queries its own coordinate and shows its own value', async ({ app, mocks }) => {
    await app.open();
    for (const city of [...METRO_BASIN_PRESETS.slice(1), METRO_BASIN_PRESETS[0]]) {
      await app.citySelect.selectOption(city);
      await app.expectFigures(defaultModel({ city, aqi: liveAqiFor(city) }));
      await expect(app.sourceAqi).toContainText('AQI: Live');
      const query = new URL(mocks.air.calls.at(-1).url).searchParams;
      expect(query.get('latitude')).toBe(METRO_BASIN_COORDINATES[city].lat.toFixed(2));
      expect(query.get('longitude')).toBe(METRO_BASIN_COORDINATES[city].lon.toFixed(2));
    }
  });

  test('a new city is never labelled live while it still shows the previous value', async ({ app, mocks }) => {
    await app.open();
    const pending = mocks.air.hold(airReply(pm25ForCity('Lahore')));
    await app.citySelect.selectOption('Lahore');

    await expect(app.sourceAqi).toHaveText('AQI: Not live · fetching live value…');
    await pending.release();
    await app.expectFigures(defaultModel({ city: 'Lahore', aqi: liveAqiFor('Lahore') }));
    await expect(app.sourceAqi).toContainText('AQI: Live');
  });

  for (const pm25 of [0, 30, 30.05, 60, 250, 380, 700, 5000]) {
    test(`a concentration of ${pm25} is converted onto the app scale`, async ({ app, mocks }) => {
      mocks.air.always(airReply(pm25));
      await app.open();
      await app.expectFigures(defaultModel({ aqi: massConcentrationToAqi(pm25) }));
    });
  }
});

test.describe('bad replies and outage', () => {
  const replies = [
    ['no current block', { status: 200, json: {} }],
    ['no PM2.5 field', { status: 200, json: { current: { time: 'x' } } }],
    ['null PM2.5', airReply(null)],
    ['text PM2.5', { status: 200, json: { current: { pm2_5: '55' } } }],
    ['negative PM2.5', airReply(-4)],
    ['null body', { status: 200, body: 'null' }],
    ['non JSON body', { status: 200, body: '<html></html>' }],
    ['HTTP 400', { status: 400, json: { error: true } }],
    ['HTTP 500', { status: 500, json: {} }],
    ['HTTP 429', { status: 429, json: {} }],
    ['dropped connection', { abort: 'failed' }]
  ];

  for (const [label, reply] of replies) {
    test(`${label} on startup keeps the current value, says so and can recover`, async ({ app, mocks }) => {
      mocks.air.always(reply);
      await app.open('', { awaitLive: false });

      await expect(app.sourceAqi).toHaveText(`AQI: Not live · ${UNREACHABLE}`);
      await app.expectFigures(defaultModel({ aqi: 395, aqiSource: 'manual' }));

      mocks.air.reset();
      await app.liveButton.click();
      await app.expectFigures(defaultModel());
      await expect(app.sourceAqi).toContainText('AQI: Live');
      await expect(app.sourceAqi).not.toContainText('unreachable');
    });
  }

  test('an outage after a good reading keeps it with a notice, then clears the notice', async ({ app, mocks }) => {
    await app.open();
    mocks.air.next(airReply(0), { status: 503, json: {} });
    await app.liveButton.click();
    await app.expectFigures(defaultModel({ aqi: 0 }));
    await app.liveButton.click();

    await expect(app.sourceAqi).toContainText('AQI: Live');
    await expect(app.sourceAqi).toContainText(UNREACHABLE);
    await app.expectFigures(defaultModel({ aqi: 0 }));

    await app.liveButton.click();
    await expect(app.sourceAqi).not.toContainText('unreachable');
    await app.expectFigures(defaultModel());
  });

  test('a failed reading for a new city is not presented as that city\'s live value', async ({ app, mocks }) => {
    await app.open();
    mocks.air.next({ status: 500, json: {} });
    await app.citySelect.selectOption('Lahore');

    await expect(app.sourceAqi).toHaveText(`AQI: Not live · ${UNREACHABLE}`);
    await app.expectFigures(defaultModel({ city: 'Lahore', aqiSource: 'manual' }));
  });

  test('a silent feed is abandoned after eight seconds', async ({ app, mocks, health }) => {
    health.networkDown = true;
    mocks.air.always(() => new Promise(() => {}));
    await app.open('', { awaitLive: false });
    await app.freeze();
    await expect(app.sourceAqi).toContainText('fetching live value');
    await app.advance(8100);

    await expect(app.sourceAqi).toHaveText(`AQI: Not live · ${UNREACHABLE}`);
  });

  test('model requests label a value that is not live as manual', async ({ app, mocks }) => {
    mocks.air.always({ status: 500, json: {} });
    await app.open('', { awaitLive: false });
    await expect(app.sourceAqi).toContainText('Not live');
    await app.saveKey();

    await app.expectAdvice(defaultModel({ aqi: 395, aqiSource: 'manual' }));
    expect(mocks.gemini.calls[0].facts.aqiSource).toBe('manual');
  });
});

test.describe('manual mode and timed refresh', () => {
  for (const [label, act, aqi] of [
    ['slider', (app) => app.aqiSlider.fill('77'), 77],
    ['number box', (app) => app.aqiBox.fill('88'), 88],
    ['persona', (app) => app.persona('ramesh'), 460]
  ]) {
    test(`the ${label} leaves live mode and the timer no longer overwrites it`, async ({ app, page, mocks }) => {
      await app.open();
      await app.freeze();
      await act(app);
      await app.advance(100);

      await expect(app.sourceAqi).toHaveText('AQI: Manual');
      await expect(app.liveButton).toHaveText('Use live AQI');
      await expect(page).not.toHaveURL(/live=1/);
      await page.clock.fastForward(FIFTEEN_MINUTES * 3);
      await app.advance(100);
      await expect(app.heroAqi).toHaveText(String(aqi));
      expect(mocks.air.calls).toHaveLength(1);
    });
  }

  test('the live button returns to the feed', async ({ app, page }) => {
    await app.open();
    await app.aqiSlider.fill('12');
    await expect(app.sourceAqi).toHaveText('AQI: Manual');
    await app.liveButton.click();

    await app.expectFigures(defaultModel());
    await expect(app.sourceAqi).toContainText('AQI: Live');
    await expect(page).toHaveURL(/&live=1$/);
  });

  test('returning to live during an outage does not call the manual value a live one', async ({ app, mocks }) => {
    await app.open();
    await app.aqiSlider.fill('12');
    mocks.air.always({ status: 500, json: {} });
    await app.liveButton.click();

    await expect(app.sourceAqi).toContainText('Not live');
    await expect(app.heroAqi).toHaveText('12');
  });

  test('a city change in manual mode switches back to live', async ({ app }) => {
    await app.open();
    await app.aqiSlider.fill('12');
    await app.citySelect.selectOption('Patna');

    await app.expectFigures(defaultModel({ city: 'Patna', aqi: liveAqiFor('Patna') }));
    await expect(app.sourceAqi).toContainText('AQI: Live');
  });

  test('live mode refreshes every fifteen minutes and binds the new value everywhere', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();
    expect(mocks.air.calls).toHaveLength(1);

    await app.advance(FIFTEEN_MINUTES - 5000);
    expect(mocks.air.calls).toHaveLength(1);
    mocks.air.next(airReply(20, '2026-11-28T10:15'));
    await app.advance(5000);
    await expect.poll(() => mocks.air.calls.length).toBe(2);
    await expect.poll(async () => {
      await app.advance(100);
      return app.sourceAqi.textContent();
    }).toBe('AQI: Live · Open-Meteo estimate (2026-11-28 10:15)');
    await app.advance(900);

    const model = defaultModel({ aqi: massConcentrationToAqi(20) });
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(model);
    await app.expectFigures(model);
  });

  test('a timed refresh with an unchanged value makes no model request', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();
    for (let cycle = 1; cycle <= 3; cycle++) {
      await app.advance(FIFTEEN_MINUTES);
      await expect.poll(() => mocks.air.calls.length).toBe(1 + cycle);
      await app.advance(2000);
    }
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('a failed timed refresh keeps the value with a notice', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.air.always({ abort: 'failed' });
    await app.advance(FIFTEEN_MINUTES);

    await expect.poll(async () => {
      await app.advance(50);
      return app.sourceAqi.textContent();
    }).toContain(UNREACHABLE);
    await expect(app.sourceAqi).toContainText('AQI: Live');
    await app.advance(100);
    await app.expectFigures(defaultModel());
  });

  test('coming back online refreshes the reading', async ({ app, page, mocks }) => {
    await app.open();
    mocks.air.next(airReply(20));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await app.expectFigures(defaultModel({ aqi: massConcentrationToAqi(20) }));
    expect(mocks.air.calls).toHaveLength(2);
  });

  test('a manual shared link does not fetch the feed', async ({ app, mocks }) => {
    const model = defaultModel({ city: 'Lahore', aqi: 222, aqiSource: 'manual' });
    await app.open(`#${contextToHashToken(model)}`);
    await expect(app.sourceAqi).toHaveText('AQI: Manual');
    await app.expectFigures(model);
    expect(mocks.air.calls).toHaveLength(0);
  });
});

test.describe('geolocation granted', () => {
  test.use({ geolocation: KOLKATA_FIX, permissions: ['geolocation'] });

  const detectedCity = 'Connaught Place, Delhi';
  const detectedModel = () => defaultModel({ city: detectedCity, aqi: massConcentrationToAqi(DEFAULT_PM25) });

  test('on load the position is detected and only rounded coordinates leave the browser', async ({ app, mocks }) => {
    mocks.air.always(airReply(DEFAULT_PM25));
    await app.open('', { awaitLive: false });

    await expect(app.citySelect).toHaveValue(detectedCity);
    await expect(app.citySelect.locator('option:checked')).toHaveText(`${detectedCity} (Live GPS)`);
    await app.expectFigures(detectedModel());
    await expect(app.sourceAqi).toContainText('AQI: Live');
    const air = new URL(mocks.air.calls.at(-1).url).searchParams;
    expect([air.get('latitude'), air.get('longitude')]).toEqual(['22.65', '88.45']);
    const geocode = new URL(mocks.bigDataCloud.calls[0].url).searchParams;
    expect([geocode.get('latitude'), geocode.get('longitude')]).toEqual(['22.65', '88.45']);
    await expect(app.banner).toBeHidden();
  });

  test('the detect button announces the result and goes live from manual mode', async ({ app, mocks }) => {
    await app.open(`#${contextToHashToken(defaultModel({ aqi: 222 }))}`);
    expect(mocks.bigDataCloud.calls).toHaveLength(0);
    await app.detectButton.click();

    await expect(app.banner).toContainText(`Auto-detected: ${detectedCity} (Airshed: Kolkata`);
    await app.expectFigures(detectedModel());
    await expect(app.sourceAqi).toContainText('AQI: Live');
    await expect(app.detectButton).toBeEnabled();
  });

  test('model advice follows the detected location', async ({ app }) => {
    await app.open(`#${contextToHashToken(defaultModel({ aqi: 222 }))}`);
    await app.activate(defaultModel({ aqi: 222, aqiSource: 'manual' }));
    await app.detectButton.click();

    await app.expectAdvice(detectedModel());
    await app.expectFigures(detectedModel());
  });

  test('a failing first geocoder falls back to the second', async ({ app, mocks }) => {
    mocks.bigDataCloud.always({ status: 500, json: {} });
    await app.open('', { awaitLive: false });

    await expect(app.citySelect).toHaveValue('Karol Bagh, New Delhi');
    const query = new URL(mocks.nominatim.calls[0].url).searchParams;
    expect([query.get('lat'), query.get('lon')]).toEqual(['22.65', '88.45']);
  });

  test('both geocoders failing names the nearest listed basin', async ({ app, mocks }) => {
    mocks.bigDataCloud.always({ abort: 'failed' });
    mocks.nominatim.always({ status: 503, json: {} });
    await app.open('', { awaitLive: false });

    await expect.poll(() => mocks.nominatim.calls.length).toBe(1);
    await expect(app.citySelect).toHaveValue('Kolkata');
    await expect(app.sourceAqi).toContainText('AQI: Live');
    const air = new URL(mocks.air.calls.at(-1).url).searchParams;
    expect([air.get('latitude'), air.get('longitude')]).toEqual(['22.65', '88.45']);
  });

  test('a hostile place name from a geocoder is sanitized', async ({ app, page, mocks }) => {
    mocks.bigDataCloud.always({
      status: 200,
      json: { locality: '<img src=x onerror="window.injected=1">Park', principalSubdivision: 'Delhi' }
    });
    await app.open('', { awaitLive: false });

    await expect(app.citySelect).toHaveValue(/Park, Delhi$/);
    expect(await app.citySelect.inputValue()).not.toMatch(/[<>="]/);
    await expect(app.advisory).not.toContainText('<img');
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  });

  test('switching to a listed city and back reuses the detected coordinate', async ({ app, mocks }) => {
    await app.open('', { awaitLive: false });
    await expect(app.citySelect).toHaveValue(detectedCity);
    await app.citySelect.selectOption('Lahore');
    await app.expectFigures(defaultModel({ city: 'Lahore', aqi: liveAqiFor('Lahore') }));
    await app.citySelect.selectOption(detectedCity);

    await app.expectFigures(detectedModel());
    const air = new URL(mocks.air.calls.at(-1).url).searchParams;
    expect(air.get('latitude')).toBe('22.65');
  });

  test('a manual shared link is not overridden by the device position', async ({ app, mocks }) => {
    const model = defaultModel({ city: 'Lahore', aqi: 222, aqiSource: 'manual' });
    await app.open(`#${contextToHashToken(model)}`);
    await app.refill();

    await expect(app.citySelect).toHaveValue('Lahore');
    await app.expectFigures(model);
    expect(mocks.bigDataCloud.calls).toHaveLength(0);
  });

  test('a shared live link keeps its own city', async ({ app, mocks }) => {
    const model = defaultModel({ city: 'Lahore', aqi: liveAqiFor('Lahore') });
    await app.open(`#${contextToHashToken(model)}&live=1`);
    await app.page.waitForLoadState('networkidle');

    await expect(app.citySelect).toHaveValue('Lahore', { timeout: 2000 });
    await app.expectFigures(model);
    expect(mocks.bigDataCloud.calls).toHaveLength(0);
  });

  test('a city chosen by the user survives a reload', async ({ app, page }) => {
    await app.open('', { awaitLive: false });
    await expect(app.citySelect).toHaveValue(detectedCity);
    await app.citySelect.selectOption('Beijing');
    await app.expectFigures(defaultModel({ city: 'Beijing', aqi: liveAqiFor('Beijing') }));
    await page.reload();
    await expect(app.sourceAqi).toContainText('AQI: Live');
    await page.waitForLoadState('networkidle');

    await expect(app.citySelect).toHaveValue('Beijing', { timeout: 2000 });
  });

  test('a city chosen while silent detection is pending is not overwritten', async ({ app, mocks }) => {
    const geocode = mocks.bigDataCloud.hold();
    await app.open('', { awaitLive: false });
    await expect.poll(() => mocks.bigDataCloud.calls.length).toBe(1);
    await app.freeze();
    await app.citySelect.selectOption('Beijing');
    await geocode.release();
    await app.page.waitForLoadState('networkidle');
    await app.advance(1000);

    await expect(app.citySelect).toHaveValue('Beijing', { timeout: 2000 });
  });

  test('a persona chosen while silent detection is pending is not overwritten', async ({ app, mocks }) => {
    const geocode = mocks.bigDataCloud.hold();
    await app.open('', { awaitLive: false });
    await expect.poll(() => mocks.bigDataCloud.calls.length).toBe(1);
    await app.freeze();
    await app.persona('rajesh');
    await geocode.release();
    await app.page.waitForLoadState('networkidle');
    await app.advance(1000);

    await expect(app.citySelect).toHaveValue('Lahore', { timeout: 2000 });
  });
});

test.describe('geolocation denied', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (success, failure) => {
        queueMicrotask(() => failure({ code: 1, message: 'User denied Geolocation' }));
      };
    });
  });

  test('the detect button reports denial and changes nothing', async ({ app, page, mocks }) => {
    await app.open();
    const urlBefore = page.url();
    await app.detectButton.click();

    await expect(app.banner).toHaveText('Location access denied or timed out. Keeping preset.');
    await expect(app.detectButton).toBeEnabled();
    await expect(app.citySelect).toHaveValue('Delhi NCR');
    await app.expectFigures(defaultModel());
    expect(page.url()).toBe(urlBefore);
    expect(mocks.bigDataCloud.calls).toHaveLength(0);
    expect(mocks.nominatim.calls).toHaveLength(0);
    await app.freeze();
    await app.advance(4000);
    await expect(app.banner).toBeHidden();
  });
});

test.describe('detected location without permission', () => {
  test('a shared link for an unlisted place says there is no live feed and keeps its value', async ({ app, mocks }) => {
    const model = defaultModel({ city: 'Karol Bagh, New Delhi', aqi: 187, aqiSource: 'manual' });
    await app.open(`#${contextToHashToken(model)}&live=1`, { awaitLive: false });

    await expect(app.sourceAqi).toContainText('Not live · No live feed for this location');
    await app.expectFigures(model);
    await expect(app.citySelect).toHaveValue('Karol Bagh, New Delhi');
    expect(mocks.air.calls).toHaveLength(0);
  });
});
