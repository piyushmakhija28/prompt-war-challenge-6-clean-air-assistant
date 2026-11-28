/**
 * @fileoverview Resilience: client rate limit with automatic resume, bounded retries, the
 * circuit breaker cycle, and loss and return of connectivity.
 * @module test/e2e/resilience
 */

import {
  test, expect, defaultModel, echoReply, errorReply, quotaReply
} from './fixtures.js';

/**
 * Reads the circuit breaker state through the application test hook.
 *
 * @param {import('@playwright/test').Page} page - Page.
 * @returns {Promise<string>} State name.
 */
function breakerState(page) {
  return page.evaluate(() => window.planProvider.circuitBreaker.getState());
}

/**
 * Changes one input on a frozen clock and lets the quiet period pass.
 *
 * @param {import('./fixtures.js').CleanAirPage} app - Page object.
 * @param {Function} change - Input change.
 */
async function changeAndDispatch(app, change) {
  await change();
  await app.advance(900);
}

const PRIMARY = 'Advice: Gemini gemini-3.5-flash-lite';
const QUEUED = 'Advice: Refresh queued';
const OFFLINE = 'Advice: Offline (on-device)';

test.describe('client rate limit', () => {
  test('the fourth quick request waits, keeps current figures and resumes with the latest inputs', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    await app.saveKey();
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('cooking', 'induction'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('heating', 'heat_pump'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('commute', 'private_car'));
    await app.settleSource(QUEUED);

    const model = defaultModel({ cookingMethod: 'induction', heatingMethod: 'heat_pump', commuteMode: 'private_car' });
    await expect(app.banner).toContainText('Rate limit threshold reached');
    await app.expectFigures(model);
    expect(mocks.gemini.calls).toHaveLength(3);

    await app.advanceUntilCalls(mocks.gemini, 4);
    await app.settleAdvice(model);
    await app.expectIdle();
    await expect(app.banner).toBeHidden();
  });

  test('inputs changed while queued are the ones sent when the retry fires', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    await app.saveKey();
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('cooking', 'induction'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('heating', 'heat_pump'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('commute', 'private_car'));
    await app.settleSource(QUEUED);
    await changeAndDispatch(app, () => app.kmSlider.fill('33'));
    await changeAndDispatch(app, () => app.setVulnerability(4, true));
    await app.settleSource(QUEUED);
    expect(mocks.gemini.calls).toHaveLength(3);

    await app.advanceUntilCalls(mocks.gemini, 4);
    await app.settleAdvice(defaultModel({
      cookingMethod: 'induction', heatingMethod: 'heat_pump', commuteMode: 'private_car',
      commuteKm: 33, vulnBits: 7
    }));
    await app.advance(120000);
    expect(mocks.gemini.calls).toHaveLength(4);
  });

  test('returning to the advised inputs while queued cancels the pending request', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    await app.saveKey();
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('cooking', 'induction'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('heating', 'heat_pump'));
    await app.settleSource(PRIMARY);
    await changeAndDispatch(app, () => app.choose('commute', 'private_car'));
    await app.settleSource(QUEUED);
    await changeAndDispatch(app, () => app.choose('commute', 'two_wheeler'));
    await app.advance(60000);

    await app.expectAdvice(defaultModel({ cookingMethod: 'induction', heatingMethod: 'heat_pump' }));
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(3);
  });

  test('a recalculation refused by the rate limit is still sent when tokens return', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    await app.saveKey();
    await app.settleSource(PRIMARY);
    for (let press = 0; press < 2; press++) {
      await app.generateButton.click();
      await app.advance(100);
      await app.settleSource(PRIMARY);
    }
    await app.generateButton.click();
    await app.advance(100);
    await app.settleSource(QUEUED);
    await expect(app.banner).toContainText('will refresh automatically');
    expect(mocks.gemini.calls).toHaveLength(3);

    await app.advanceUntilCalls(mocks.gemini, 4);
  });
});

test.describe('quota back-off', () => {
  test('a recalculation that hits 429 is retried automatically as the banner promises', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    await app.saveKey();
    await app.settleSource(PRIMARY);
    mocks.gemini.always(quotaReply('20s'));
    await app.generateButton.click();
    await app.settleSource(QUEUED);
    const callsWhenQueued = mocks.gemini.calls.length;

    mocks.gemini.always(echoReply);
    await app.advance(30000);

    await expect.poll(() => mocks.gemini.calls.length, { timeout: 3000 }).toBe(callsWhenQueued + 1);
  });

  test('input changes during the back-off window make no network call', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.always(quotaReply('60s'));
    await app.saveKey();
    await app.settleSource(QUEUED);
    expect(mocks.gemini.calls).toHaveLength(5);

    mocks.gemini.always(echoReply);
    await changeAndDispatch(app, () => app.choose('cooking', 'png'));
    await app.settleSource(QUEUED);
    await changeAndDispatch(app, () => app.kmSlider.fill('5'));
    await app.settleSource(QUEUED);
    expect(mocks.gemini.calls).toHaveLength(5);

    await app.advance(61000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(6);
    await app.settleAdvice(defaultModel({ cookingMethod: 'png', commuteKm: 5 }));
  });

  test('three automatic retries are the limit, then a manual retry works', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.always(quotaReply('20s'));
    await app.saveKey();
    await app.settleSource(QUEUED);
    for (let resume = 1; resume <= 3; resume++) {
      await app.advance(21000);
      await expect.poll(() => mocks.gemini.calls.length).toBe(5 * (resume + 1));
      await app.settleSource(resume < 3 ? QUEUED : OFFLINE);
    }

    await expect(app.banner).toHaveText('Gemini is still unavailable. Press Recalculate to retry.');
    await app.expectIdle();
    await app.expectOffline();
    await app.advance(600000);
    expect(mocks.gemini.calls).toHaveLength(20);

    mocks.gemini.always(echoReply);
    await app.generateButton.click();
    await app.settleAdvice(defaultModel());
  });
});

test.describe('circuit breaker', () => {
  /**
   * Produces two consecutive failed generations, which trips the breaker.
   *
   * @param {import('./fixtures.js').CleanAirPage} app - Page object.
   * @param {Object} mocks - Host mocks.
   */
  async function trip(app, mocks) {
    await app.open();
    await app.freeze();
    mocks.gemini.always(errorReply(500));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(5);
    await app.settleSource(OFFLINE);
    expect(await breakerState(app.page)).toBe('CLOSED');
    await app.generateButton.click();
    await app.settleSource(QUEUED);
    expect(await breakerState(app.page)).toBe('OPEN');
    expect(mocks.gemini.calls).toHaveLength(10);
  }

  test('open blocks the network, a successful probe closes it', async ({ app, mocks, page }) => {
    await trip(app, mocks);
    await app.generateButton.click();
    await app.settleSource(QUEUED);
    await changeAndDispatch(app, () => app.choose('commute', 'walk_cycle'));
    await app.settleSource(QUEUED);
    await app.expectFigures(defaultModel({ commuteMode: 'walk_cycle' }));
    expect(mocks.gemini.calls).toHaveLength(10);

    mocks.gemini.always(echoReply);
    await app.advance(31000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(11);
    await app.settleAdvice(defaultModel({ commuteMode: 'walk_cycle' }));

    expect(await breakerState(page)).toBe('CLOSED');
    await app.expectIdle();
  });

  test('a failed probe re-opens the breaker and a later probe recovers', async ({ app, mocks, page }) => {
    await trip(app, mocks);
    await app.advance(31000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(15);
    await app.settleSource(QUEUED);
    expect(await breakerState(page)).toBe('OPEN');

    mocks.gemini.always(echoReply);
    await app.advance(31000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(16);
    await app.settleSource(PRIMARY);
    expect(await breakerState(page)).toBe('CLOSED');
  });

  test('an input change during the half-open probe sends a replacement probe', async ({ app, mocks, page }) => {
    await trip(app, mocks);
    mocks.gemini.always(echoReply);
    const probe = mocks.gemini.hold();
    await app.advance(31000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(11);
    expect(await breakerState(page)).toBe('HALF_OPEN');

    await changeAndDispatch(app, () => app.choose('commute', 'public_transit'));
    await expect.poll(() => mocks.gemini.calls.length).toBe(12);
    await app.settleAdvice(defaultModel({ commuteMode: 'public_transit' }));
    await probe.release();
    await app.advance(100);

    expect(await breakerState(page)).toBe('CLOSED');
    await app.expectAdvice(defaultModel({ commuteMode: 'public_transit' }));
  });

  test('saving a key again resets the breaker at once', async ({ app, mocks, page }) => {
    await trip(app, mocks);
    mocks.gemini.always(echoReply);
    await app.advance(13000);
    await app.saveKey('test-key-reset');
    await app.settleAdvice(defaultModel());

    expect(await breakerState(page)).toBe('CLOSED');
  });
});

test.describe('connectivity', () => {
  test('offline shows the on-device plan and coming back online refreshes advice', async ({ app, mocks, context, health }) => {
    await app.open();
    await app.activate();
    health.networkDown = true;
    mocks.gemini.always({ abort: 'internetdisconnected' });
    await context.setOffline(true);
    await app.choose('commute', 'private_car');

    await expect(app.banner).toContainText('You are offline');
    await app.expectOffline();
    await app.expectFigures(defaultModel({ commuteMode: 'private_car' }));
    await app.expectIdle();

    mocks.gemini.always(echoReply);
    await context.setOffline(false);

    await app.expectAdvice(defaultModel({ commuteMode: 'private_car' }));
    await expect(app.banner).toBeHidden();
  });

  test('an online event with current advice makes no new request', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await app.refill();

    await expect.poll(() => mocks.air.calls.length).toBeGreaterThan(1);
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('an online event without a key calls no model', async ({ app, page, mocks }) => {
    await app.open();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => mocks.air.calls.length).toBe(2);
    await app.expectOffline();
    expect(mocks.gemini.calls).toHaveLength(0);
  });
});
