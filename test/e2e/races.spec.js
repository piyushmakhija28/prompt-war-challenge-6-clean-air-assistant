/**
 * @fileoverview Concurrency: fast input, changes during a request, and older replies that
 * arrive last must never leave stale data on screen.
 * @module test/e2e/races
 */

import {
  test, expect, defaultModel, liveAqiFor, pm25ForCity, airReply, invalidKeyReply, errorReply,
  tagFor
} from './fixtures.js';

/**
 * Dispatches a burst of input events on a range control, as a fast drag does.
 *
 * @param {import('@playwright/test').Locator} slider - Range input.
 * @param {number[]} values - Successive positions.
 */
async function drag(slider, values) {
  await slider.evaluate((element, positions) => {
    for (const position of positions) {
      element.value = String(position);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, values);
}

test.describe('fast input', () => {
  test('a fast AQI drag sends one request for the final position', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    const positions = Array.from({ length: 60 }, (_, index) => 100 + index * 5);
    await drag(app.aqiSlider, positions);
    await app.advance(900);

    const model = defaultModel({ aqi: positions.at(-1), aqiSource: 'manual' });
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(model);
    await app.expectFigures(model);
    expect(mocks.gemini.calls[1].facts.aqi).toBe(positions.at(-1));
  });

  test('a drag paced below the quiet period never dispatches an intermediate value', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    for (const position of [120, 180, 240, 300, 360, 420]) {
      await app.aqiSlider.fill(String(position));
      await app.advance(700);
    }
    expect(mocks.gemini.calls).toHaveLength(1);
    await app.advance(200);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    expect(mocks.gemini.calls[1].facts.aqi).toBe(420);
    await app.settleAdvice(defaultModel({ aqi: 420, aqiSource: 'manual' }));
  });

  test('fast distance and time drags stay bound to the final values', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    await drag(app.kmSlider, [2, 9, 17, 26, 33, 47]);
    await drag(app.timeSlider, [1, 5, 9, 13, 17.5]);
    await app.advance(900);

    const model = defaultModel({ commuteKm: 47 });
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(model);
    await expect(app.kmLabel).toHaveText('47 km');
    await expect(app.timeLabel).toHaveText('17:30');
    await app.expectFigures(model);
  });

  test('rapid persona switching ends on the last persona', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();

    for (const id of ['ananya', 'rajesh', 'vikram', 'ramesh', 'rajesh']) {
      await app.persona(id);
    }
    await app.advance(900);

    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    const model = {
      city: 'Lahore', aqi: 380, aqiSource: 'manual', vulnBits: 6, housingType: 'sealed_apartment',
      cookingMethod: 'png', heatingMethod: 'electric_radiator', commuteMode: 'walk_cycle', commuteKm: 2
    };
    await app.settleAdvice(model);
    await app.expectFigures(model);
  });
});

test.describe('older replies arriving last', () => {
  test('a slow older reply released after the newer one changes nothing', async ({ app, mocks }) => {
    await app.open();
    const older = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.choose('commute', 'private_car');
    const latest = defaultModel({ commuteMode: 'private_car' });
    await app.expectAdvice(latest);

    await older.release();
    await app.refill();

    await app.expectAdvice(latest);
    await expect(app.schedule).not.toContainText(tagFor(defaultModel()));
    await app.expectIdle();
  });

  test('three overlapping requests released newest first end on the newest', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    const first = mocks.gemini.hold();
    const second = mocks.gemini.hold();
    const third = mocks.gemini.hold();

    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.choose('cooking', 'induction');
    await app.advance(900);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.choose('heating', 'open_fire');
    await app.advance(900);
    await expect.poll(() => mocks.gemini.calls.length).toBe(3);

    const latest = defaultModel({ cookingMethod: 'induction', heatingMethod: 'open_fire' });
    await third.release();
    await app.settleAdvice(latest);
    await second.release();
    await first.release();
    await app.advance(2000);

    await app.expectAdvice(latest);
    await app.expectFigures(latest);
    await app.expectIdle();
  });

  test('a late success from a superseded request cannot replace an ongoing one', async ({ app, mocks }) => {
    await app.open();
    const older = mocks.gemini.hold();
    const newer = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.choose('commute', 'public_transit');
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);

    await older.release();
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await expect(app.generateButton).toBeDisabled();
    await expect(app.schedule).not.toContainText(tagFor(defaultModel()));

    await newer.release();
    await app.expectAdvice(defaultModel({ commuteMode: 'public_transit' }));
  });

  test('a late key rejection from a superseded request is ignored', async ({ app, mocks }) => {
    await app.open();
    const older = mocks.gemini.hold(invalidKeyReply());
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.choose('commute', 'walk_cycle');
    const latest = defaultModel({ commuteMode: 'walk_cycle' });
    await app.expectAdvice(latest);

    await older.release();
    await app.refill();

    await expect(app.keyStatus).toContainText('verified');
    await app.expectAdvice(latest);
  });

  test('a late server error from a superseded request is ignored', async ({ app, mocks }) => {
    await app.open();
    const older = mocks.gemini.hold(errorReply(503));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.choose('commute', 'walk_cycle');
    const latest = defaultModel({ commuteMode: 'walk_cycle' });
    await app.expectAdvice(latest);

    await older.release();
    await app.refill();

    await app.expectAdvice(latest);
    await expect(app.banner).toBeHidden();
    expect(mocks.gemini.calls).toHaveLength(2);
  });
});

test.describe('changes during a request', () => {
  test('changing and changing back during a request still lands advice for the screen', async ({ app, mocks }) => {
    await app.open();
    const first = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.freeze();
    await app.choose('commute', 'private_car');
    await app.choose('commute', 'two_wheeler');
    await app.advance(900);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await first.release();

    await app.settleAdvice(defaultModel());
    await app.expectIdle();
  });

  test('language toggle and time scrubbing during a request do not restart it', async ({ app, mocks }) => {
    await app.open();
    const gate = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.freeze();
    await app.langButton.click();
    await app.timeSlider.fill('13');
    await app.advance(3000);
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await gate.release();

    await app.settleAdvice(defaultModel());
    await expect(app.advisory).toHaveAttribute('lang', 'hi');
    await expect(app.timeLabel).toHaveText('13:00');
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('switching the hack during a request aborts it and asks for advice on the new hack', async ({ app, page, mocks }) => {
    const aborted = [];
    page.on('requestfailed', (request) => {
      if (request.url().includes('generativelanguage')) aborted.push(request.failure().errorText);
    });
    await app.open();
    const older = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.freeze();
    await app.hack('pc_fan_stealth');
    await expect.poll(() => aborted).toEqual(['net::ERR_ABORTED']);
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await app.advanceUntilCalls(mocks.gemini, 2);
    await older.release();

    const model = defaultModel({ hackId: 'pc_fan_stealth' });
    await app.settleAdvice(model);
    await app.expectFigures(model);
    await expect(app.schedule).not.toContainText(tagFor(defaultModel()));
    await app.expectIdle();
    expect(mocks.gemini.calls.map((call) => call.facts.choices.find((item) => item.choice === 'iaq_hack').current))
      .toEqual(['corsi_rosenthal', 'pc_fan_stealth']);
  });

  test('a key replaced mid-flight is used for the advice that is shown', async ({ app, mocks }) => {
    await app.open();
    const older = mocks.gemini.hold();
    await app.saveKey('test-key-first');
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.saveKey('test-key-second');
    await app.expectAdvice(defaultModel());
    await older.release();

    expect(mocks.gemini.calls).toHaveLength(2);
    expect(mocks.gemini.calls[1].headers['x-goog-api-key']).toBe('test-key-second');
    await app.expectAdvice(defaultModel());
  });

  test('a key saved before the live reading lands ends with advice for the live value', async ({ app, mocks }) => {
    const air = mocks.air.hold(airReply(pm25ForCity('Delhi NCR')));
    await app.open('', { awaitLive: false });
    await app.saveKey();
    const manual = defaultModel({ aqi: 395, aqiSource: 'manual' });
    await app.expectAdvice(manual);

    await air.release();

    await expect(app.sourceAqi).toContainText('AQI: Live');
    await app.expectAdvice(defaultModel());
    await app.expectFigures(defaultModel());
    expect(mocks.gemini.calls.at(-1).facts.aqiSource).toBe('live');
  });
});

test.describe('live reading races', () => {
  test('a slow older city reading arriving last is discarded', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    const lahore = mocks.air.hold(airReply(pm25ForCity('Lahore')));
    await app.citySelect.selectOption('Lahore');
    await expect.poll(() => mocks.air.calls.length).toBe(2);
    await app.citySelect.selectOption('Kolkata');

    const model = defaultModel({ city: 'Kolkata', aqi: liveAqiFor('Kolkata') });
    await expect(app.heroAqi).toHaveText(String(model.aqi));
    await lahore.release();

    await app.expectAdvice(model);
    await app.expectFigures(model);
    await expect(app.sourceAqi).toContainText('AQI: Live');
  });

  test('a manual value typed while a live reading is pending wins', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    const pending = mocks.air.hold(airReply(300));
    await app.liveButton.click();
    await expect.poll(() => mocks.air.calls.length).toBe(2);
    await app.aqiSlider.fill('66');
    await pending.release();

    const model = defaultModel({ aqi: 66, aqiSource: 'manual' });
    await expect(app.sourceAqi).toHaveText('AQI: Manual');
    await app.expectFigures(model);
    await app.expectAdvice(model);
  });

  test('a persona chosen while a live reading is pending wins', async ({ app, mocks }) => {
    await app.open();
    const pending = mocks.air.hold(airReply(300));
    await app.citySelect.selectOption('Lucknow');
    await expect.poll(() => mocks.air.calls.length).toBe(2);
    await app.persona('vikram');
    await pending.release();
    await app.refill();

    await expect(app.sourceAqi).toHaveText('AQI: Manual');
    await expect(app.citySelect).toHaveValue('Delhi NCR');
    await expect(app.heroAqi).toHaveText('410');
  });

  test('advice waits for a slow reading before describing the new city', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    const pending = mocks.air.hold(airReply(pm25ForCity('Lahore')));
    await app.freeze();
    await app.citySelect.selectOption('Lahore');
    await app.advance(2500);
    expect(mocks.gemini.calls).toHaveLength(1);

    await pending.release();
    await app.advanceUntilCalls(mocks.gemini, 2);

    expect(mocks.gemini.calls[1].facts.city).toBe('Lahore');
    expect(mocks.gemini.calls[1].facts.aqi).toBe(liveAqiFor('Lahore'));
    await app.settleAdvice(defaultModel({ city: 'Lahore', aqi: liveAqiFor('Lahore') }));
  });

  test('advice never pairs a new city with an old reply after the city changes', async ({ app, mocks }) => {
    await app.open();
    const delhi = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.citySelect.selectOption('Beijing');
    const model = defaultModel({ city: 'Beijing', aqi: liveAqiFor('Beijing') });
    await app.expectAdvice(model);
    await delhi.release();
    await app.refill();

    await app.expectAdvice(model);
    await expect(app.advisory).not.toContainText('city=Delhi NCR');
  });
});
