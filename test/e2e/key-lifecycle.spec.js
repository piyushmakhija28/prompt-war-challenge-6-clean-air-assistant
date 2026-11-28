/**
 * @fileoverview Gemini key lifecycle: absent, blank, invalid, valid, rejected, purged,
 * re-entered, and never persisted anywhere.
 * @module test/e2e/key-lifecycle
 */

import {
  test, expect, FAKE_KEY, PRIMARY_MODEL, defaultModel, echoReply, errorReply,
  invalidKeyReply, quotaReply, tagFor
} from './fixtures.js';

const DEFAULT_STATUS = /100% Ephemeral/;

test.describe('no key and unusable input', () => {
  test('without a key every interaction stays on device and calls Gemini never', async ({ app, mocks }) => {
    await app.open();
    await app.expectOffline();
    await expect(app.keyStatus).toHaveText(DEFAULT_STATUS);

    await app.choose('commute', 'private_car');
    await app.aqiSlider.fill('120');
    await app.generateButton.click();
    await app.refill();

    await app.expectFigures(defaultModel({ aqi: 120, aqiSource: 'manual', commuteMode: 'private_car' }));
    await app.expectOffline();
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(0);
  });

  for (const [label, value] of [['empty', ''], ['spaces only', '     ']]) {
    test(`saving a blank key (${label}) asks for a key and calls nothing`, async ({ app, page, mocks }) => {
      await app.open();
      await app.saveKey(value);

      await expect(app.keyStatus).toHaveText('Paste your Gemini API key first.');
      expect(await page.evaluate(() => window.keyStore.hasKey())).toBe(false);
      await app.expectOffline();
      expect(mocks.gemini.calls).toHaveLength(0);
    });
  }

  test('a blank save leaves an already active key and its advice in place', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    const status = await app.keyStatus.textContent();
    await app.saveKey('   ');

    await expect(app.keyStatus).toHaveText(status);
    expect(await page.evaluate(() => window.keyStore.hasKey())).toBe(true);
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  for (const [label, value] of [
    ['inner spaces', 'not a real key'],
    ['non Latin text', 'ключ-ключ'],
    ['accented text', 'test-kéy'],
    ['control character', 'test\u0001key']
  ]) {
    test(`invalid key text (${label}) is refused locally`, async ({ app, page, mocks }) => {
      await app.open();
      await app.saveKey(value);

      await expect(app.keyStatus).toHaveText('That value is not a valid API key. Operating in Offline Mode');
      await expect(app.keyInput).toHaveValue('');
      expect(await page.evaluate(() => window.keyStore.hasKey())).toBe(false);
      await app.expectOffline();
      await app.expectIdle();
      expect(mocks.gemini.calls).toHaveLength(0);
    });
  }

  test('invalid text entered after a valid key removes the model advice', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await app.saveKey('broken key value');

    await app.expectOffline();
    await expect(app.keyStatus).toContainText('not a valid API key');
    expect(await page.evaluate(() => window.keyStore.hasKey())).toBe(false);
    expect(mocks.gemini.calls).toHaveLength(1);
  });
});

test.describe('valid key', () => {
  test('status moves from active to verified and the advice is the live reply', async ({ app, mocks }) => {
    await app.open();
    const gate = mocks.gemini.hold();
    await app.saveKey();

    await expect(app.keyStatus).toContainText('Active');
    await expect(app.keyStatus).toContainText('verifying');
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await expect(app.keyInput).toHaveValue('');

    await gate.release();

    await expect(app.keyStatus).toContainText('verified');
    await app.expectAdvice(defaultModel());
    await expect(app.badge).toHaveText('GEMINI_3_5_FLASH_LITE');
    await app.expectFigures(defaultModel());
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('the key travels only in the x-goog-api-key header, trimmed', async ({ app, mocks }) => {
    await app.open();
    await app.saveKey(`   ${FAKE_KEY}  `);
    await app.expectAdvice(defaultModel());

    const [call] = mocks.gemini.calls;
    expect(call.method).toBe('POST');
    expect(call.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(call.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_MODEL}:generateContent`);
    expect(call.body).not.toContain(FAKE_KEY);
  });

  test('pressing Enter in the key field activates it', async ({ app, page }) => {
    await app.open();
    await app.keyInput.fill(FAKE_KEY);
    await app.keyInput.press('Enter');

    await app.expectAdvice(defaultModel());
    await expect(app.keyStatus).toContainText('verified');
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('rejected key', () => {
  const rejections = [
    ['400 API_KEY_INVALID', invalidKeyReply()],
    ['401', errorReply(401, { status: 'UNAUTHENTICATED' })],
    ['403', errorReply(403, { status: 'PERMISSION_DENIED' })]
  ];

  for (const [label, reply] of rejections) {
    test(`${label} marks the key rejected, stops calling and recovers on a new key`, async ({ app, mocks }) => {
      await app.open();
      mocks.gemini.always(reply);
      await app.saveKey();

      await expect(app.keyStatus).toContainText('rejected');
      await expect(app.banner).toBeVisible();
      await expect(app.banner).toContainText('rejected this API key');
      await app.expectOffline();
      await expect(app.badge).toHaveText('OFFLINE_KEY_REJECTED');
      await app.expectIdle();

      await app.choose('commute', 'public_transit');
      await app.refill();
      await app.generateButton.click();
      await app.refill();

      await app.expectFigures(defaultModel({ commuteMode: 'public_transit' }));
      await expect(app.keyStatus).toContainText('rejected');
      await expect(app.banner).toBeVisible();
      expect(mocks.gemini.calls).toHaveLength(1);

      mocks.gemini.always(echoReply);
      await app.saveKey('test-key-456');

      await app.expectAdvice(defaultModel({ commuteMode: 'public_transit' }));
      await expect(app.keyStatus).toContainText('verified');
      await expect(app.banner).toBeHidden();
      expect(mocks.gemini.calls.at(-1).headers['x-goog-api-key']).toBe('test-key-456');
    });
  }

  test('rejection of a revoked key after earlier success drops the cached advice', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    mocks.gemini.always(errorReply(403));
    await app.choose('cooking', 'biomass');

    await expect(app.keyStatus).toContainText('rejected');
    await app.expectOffline();
    await app.expectFigures(defaultModel({ cookingMethod: 'biomass' }));
  });

  test('a late rejection for the old key never applies to the replacement key', async ({ app, mocks }) => {
    await app.open();
    const oldKey = mocks.gemini.hold(invalidKeyReply());
    await app.saveKey('test-key-old');
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.saveKey('test-key-new');
    await app.expectAdvice(defaultModel());
    await oldKey.release();
    await app.refill();

    await expect(app.keyStatus).toContainText('verified');
    await expect(app.banner).toBeHidden();
    await app.expectAdvice(defaultModel());
    expect(mocks.gemini.calls.map((call) => call.headers['x-goog-api-key']))
      .toEqual(['test-key-old', 'test-key-new']);
  });
});

test.describe('purge and re-entry', () => {
  test('purge removes the model advice at once and no further call is made', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await app.purgeButton.click();

    await expect(app.keyStatus).toContainText('Key Purged');
    await app.expectOffline();
    await app.expectIdle();
    await app.expectFigures(defaultModel());
    expect(await page.evaluate(() => window.keyStore.getKey())).toBe('');

    await app.choose('commute', 'walk_cycle');
    await app.generateButton.click();
    await app.refill();
    await app.expectFigures(defaultModel({ commuteMode: 'walk_cycle' }));
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('purge while a request is in flight discards the late reply', async ({ app, mocks }) => {
    await app.open();
    const gate = mocks.gemini.hold();
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.purgeButton.click();
    await app.expectIdle();
    await gate.release();
    await app.refill();

    await app.expectOffline();
    await expect(app.keyStatus).toContainText('Key Purged');
    await expect(app.schedule).not.toContainText(tagFor(defaultModel()));
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('purge cancels a queued automatic retry', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.always(quotaReply('20s'));
    await app.saveKey();
    await expect(app.sourceAdvice).toHaveText('Advice: Refresh queued');
    const callsBeforePurge = mocks.gemini.calls.length;

    await app.purgeButton.click();
    await app.freeze();
    await app.advance(300000);

    await app.expectOffline();
    await app.expectIdle();
    await expect(app.banner).toBeHidden();
    expect(mocks.gemini.calls).toHaveLength(callsBeforePurge);
  });

  test('a key entered again after purge produces a fresh request and advice', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.purgeButton.click();
    await app.expectOffline();
    await app.choose('heating', 'heat_pump');
    await app.saveKey('test-key-again');

    await app.expectAdvice(defaultModel({ heatingMethod: 'heat_pump' }));
    await expect(app.keyStatus).toContainText('verified');
    expect(mocks.gemini.calls).toHaveLength(2);
    expect(mocks.gemini.calls[1].headers['x-goog-api-key']).toBe('test-key-again');
  });

  test('repeated purge and activate cycles stay consistent', async ({ app, mocks }) => {
    await app.open();
    for (let cycle = 0; cycle < 3; cycle++) {
      await app.saveKey(`test-key-cycle-${cycle}`);
      await app.expectAdvice(defaultModel());
      await app.purgeButton.click();
      await app.expectOffline();
      await app.refill();
    }
    expect(mocks.gemini.calls).toHaveLength(3);
  });
});

test.describe('persistence', () => {
  test('the key never reaches storage, caches, URL, DOM, telemetry or console', async ({ app, page, mocks, health, context }) => {
    const secret = 'test-secret-key-7f3a9c';
    const requestedUrls = [];
    context.on('request', (request) => requestedUrls.push(request.url()));
    await app.open();
    await app.saveKey(secret);
    await app.expectAdvice(defaultModel());
    await app.choose('commute', 'private_car');
    await app.expectAdvice(defaultModel({ commuteMode: 'private_car' }));
    await app.refill();
    await app.citySelect.selectOption('Lahore');
    await expect(app.sourceAqi).toContainText('Live');

    const surfaces = await page.evaluate(async () => {
      const dump = (store) => JSON.stringify(Object.entries(store));
      const cacheEntries = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          cacheEntries.push(request.url, await (await cache.match(request)).text());
        }
      }
      return {
        local: dump(window.localStorage),
        session: dump(window.sessionStorage),
        caches: cacheEntries.join('\n'),
        databases: JSON.stringify(await indexedDB.databases()),
        cookie: document.cookie,
        url: window.location.href,
        dom: document.documentElement.outerHTML,
        inputs: [...document.querySelectorAll('input')].map((input) => input.value).join('|'),
        telemetry: JSON.stringify(window.__CLEANAIR_TELEMETRY__ ?? []),
        state: JSON.stringify(window.__cleanAirTestUtils.state)
      };
    });

    for (const [name, content] of Object.entries(surfaces)) {
      expect(content, name).not.toContain(secret);
    }
    expect(surfaces.telemetry).toContain('SUCCESS');
    expect(health.consoleText.join('\n')).not.toContain(secret);
    expect(requestedUrls.join('\n')).not.toContain(secret);
    for (const mock of [mocks.air, mocks.bigDataCloud, mocks.nominatim]) {
      expect(JSON.stringify(mock.calls)).not.toContain(secret);
    }
  });

  test('a reload forgets the key and returns to on-device advice', async ({ app, page, mocks }) => {
    await app.open();
    await app.activate();
    await page.reload();

    await expect(app.badge).toHaveText('OFFLINE_DETERMINISTIC');
    await expect(app.keyStatus).toHaveText(DEFAULT_STATUS);
    await expect(app.keyInput).toHaveValue('');
    await app.expectOffline();
    expect(await page.evaluate(() => window.keyStore.hasKey())).toBe(false);
    expect(mocks.gemini.calls).toHaveLength(1);
  });
});
