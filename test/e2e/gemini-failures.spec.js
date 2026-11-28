/**
 * @fileoverview Gemini failure handling: HTTP errors, timeouts, network loss, malformed or
 * hostile model output, and the model cascade.
 * @module test/e2e/gemini-failures
 */

import { GEMINI_MODELS_CASCADE } from '../../src/js/gemini-service.js';
import {
  test, expect, defaultModel, echoPlan, echoReply, textReply, planReply, errorReply, quotaReply,
  computeImpact
} from './fixtures.js';

const CHANGED = Object.freeze({ commuteMode: 'private_car' });

const FAILURES = [
  { name: 'HTTP 500', reply: errorReply(500), calls: 5, banner: /unavailable/ },
  { name: 'HTTP 502', reply: errorReply(502), calls: 5, banner: /unavailable/ },
  { name: 'HTTP 503', reply: errorReply(503), calls: 5, banner: /unavailable/ },
  { name: 'HTTP 408', reply: errorReply(408), calls: 5, banner: /unavailable/ },
  { name: 'connection failure', reply: { abort: 'failed' }, calls: 2, banner: /NETWORK/ },
  { name: 'connection reset', reply: { abort: 'connectionreset' }, calls: 2, banner: /NETWORK/ },
  {
    name: '200 with an HTML body',
    reply: { status: 200, contentType: 'text/html', body: '<html>gateway</html>' },
    calls: 5,
    banner: /INVALID_RESPONSE/
  },
  { name: '200 with an empty body', reply: { status: 200, body: '' }, calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'no candidates', reply: { status: 200, json: { candidates: [] } }, calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'empty model text', reply: textReply(''), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'model text that is not JSON', reply: textReply('Sorry, no plan today.'), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'JSON without routines', reply: planReply({ communityAdvisory: 'Stay in.' }), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'empty routine list', reply: planReply({ hourlyRoutines: [], communityAdvisory: 'Stay in.' }), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'routines of the wrong type', reply: planReply({ hourlyRoutines: 'morning', communityAdvisory: 'x' }), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'null routine entries', reply: planReply({ hourlyRoutines: [null, 7, 'x'], communityAdvisory: 'x' }), calls: 5, banner: /INVALID_RESPONSE/ },
  { name: 'literal null plan', reply: textReply('null'), calls: 5, banner: /INVALID_RESPONSE/ },
  {
    name: 'blocked prompt',
    reply: { status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } },
    calls: 1,
    banner: /declined/
  },
  { name: 'unexpected status 405', reply: errorReply(405), calls: 1, banner: /unavailable/ },
  { name: 'non key HTTP 400 on every model', reply: errorReply(400, { status: 'INVALID_ARGUMENT', message: 'Bad schema' }), calls: 5, banner: /unavailable/ },
  { name: 'HTTP 404 on every model', reply: errorReply(404), calls: 5, banner: /unavailable/ }
];

/**
 * Builds a reply whose routines are the echo routines changed by a mutator.
 *
 * @param {Function} mutate - Receives the plan and the call.
 * @returns {Function} Responder.
 */
function mutatedReply(mutate) {
  return (call) => {
    const plan = echoPlan(call);
    mutate(plan, call);
    return planReply(plan);
  };
}

test.describe('failure after a good plan', () => {
  for (const failure of FAILURES) {
    test(`${failure.name}: on-device plan for the new inputs, controls recover`, async ({ app, mocks }) => {
      await app.open();
      await app.activate();
      mocks.gemini.always(failure.reply);
      await app.choose('commute', 'private_car');

      await expect(app.banner).toContainText(failure.banner);
      await app.expectOffline();
      await app.expectFigures(defaultModel(CHANGED));
      await app.expectIdle();
      await expect(app.keyStatus).not.toContainText('rejected');
      expect(mocks.gemini.calls).toHaveLength(1 + failure.calls);

      mocks.gemini.always(echoReply);
      await app.refill();
      await app.generateButton.click();
      await app.expectAdvice(defaultModel(CHANGED));
      await expect(app.banner).toBeHidden();
    });
  }
});

test.describe('failure on the first request', () => {
  test('a first request that fails keeps the key active and shows the on-device plan', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.always(errorReply(500));
    await app.saveKey();

    await expect(app.banner).toContainText('unavailable');
    await app.expectOffline();
    await app.expectFigures(defaultModel());
    await app.expectIdle();
    await expect(app.keyStatus).toContainText('Active');
    await expect(app.keyStatus).not.toContainText('verified');
  });

  test('the warning banner dismisses itself and the plan stays', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.always(errorReply(405));
    await app.saveKey();
    await expect(app.banner).toBeVisible();
    await app.advance(6100);

    await expect(app.banner).toBeHidden();
    await app.expectOffline();
  });
});

test.describe('timeouts', () => {
  test('a silent service is abandoned within the 45 second budget', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.always(() => new Promise(() => {}));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);

    await app.advance(14900);
    expect(mocks.gemini.calls).toHaveLength(1);
    await expect(app.sourceAdvice).toHaveText('Advice: Refreshing');
    await app.advance(200);
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.advance(15000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(3);
    await app.advance(15100);

    await expect.poll(async () => {
      await app.advance(100);
      return app.sourceAdvice.textContent();
    }).toBe('Advice: Offline (on-device)');
    await expect(app.banner).toContainText('TIMEOUT');
    await app.expectIdle();
    expect(mocks.gemini.calls).toHaveLength(3);
  });

  test('a first model timeout falls through to the next model', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.next(() => new Promise(() => {}));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(1);
    await app.advance(15100);

    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await app.settleAdvice(defaultModel(), GEMINI_MODELS_CASCADE[1]);
  });
});

test.describe('model cascade', () => {
  for (const [position, first] of [[1, errorReply(404)], [2, errorReply(503)], [3, textReply('{broken')], [4, errorReply(500)]]) {
    test(`model number ${position + 1} serves the plan after ${position} failures`, async ({ app, mocks }) => {
      await app.open();
      mocks.gemini.next(...Array(position).fill(first));
      await app.saveKey();

      const name = GEMINI_MODELS_CASCADE[position];
      await app.expectAdvice(defaultModel(), name);
      await expect(app.badge)
        .toHaveText(`GEMINI_${name.replace(/^gemini-/, '').toUpperCase().replace(/[^A-Z0-9]/g, '_')}`);
      await expect(app.keyStatus).toContainText('verified');
      expect(mocks.gemini.calls.map((call) => call.url.match(/models\/(.+):generateContent/)[1]))
        .toEqual(GEMINI_MODELS_CASCADE.slice(0, position + 1));
    });
  }

  test('thinking settings are sent to gemini-3 models only and the schema is requested', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.always(errorReply(404));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(5);

    for (const call of mocks.gemini.calls) {
      const name = call.url.match(/models\/(.+):generateContent/)[1];
      const config = call.payload.generationConfig;
      expect(config.responseMimeType).toBe('application/json');
      expect(config.responseSchema.required)
        .toEqual(['hourlyRoutines', 'communityAdvisory', 'choiceInsights']);
      expect(Boolean(config.thinkingConfig), name).toBe(name.startsWith('gemini-3'));
    }
  });
});

test.describe('quota', () => {
  for (const [label, delay, before, after] of [
    ['server delay of 20 s', '20s', 19000, 1500],
    ['server delay below the 12 s floor', '3s', 11000, 1500],
    ['no server delay (30 s default)', undefined, 29000, 1500]
  ]) {
    test(`429 with ${label} queues and resumes on time`, async ({ app, mocks }) => {
      await app.open();
      await app.freeze();
      mocks.gemini.always(quotaReply(delay));
      await app.saveKey();
      await expect.poll(() => mocks.gemini.calls.length).toBe(5);
      await app.settleSource('Advice: Refresh queued');

      await expect(app.spinnerText).toHaveText('Refresh queued');
      await expect(app.generateButton).toBeEnabled();
      await expect(app.banner).toBeVisible();
      await app.expectFigures(defaultModel());

      mocks.gemini.always(echoReply);
      await app.advance(before);
      expect(mocks.gemini.calls).toHaveLength(5);
      await app.advance(after);
      await expect.poll(() => mocks.gemini.calls.length).toBe(6);
      await app.settleAdvice(defaultModel());
      await app.expectIdle();
      await expect(app.banner).toBeHidden();
    });
  }

  test('429 with a delay above two minutes does not retry by itself', async ({ app, mocks }) => {
    await app.open();
    await app.freeze();
    mocks.gemini.always(quotaReply('300s'));
    await app.saveKey();
    await expect.poll(() => mocks.gemini.calls.length).toBe(5);
    await app.settleSource('Advice: Offline (on-device)');
    await app.expectIdle();
    await app.advance(600000);

    await app.expectOffline();
    expect(mocks.gemini.calls).toHaveLength(5);
  });

  test('cached advice stays on screen with current figures while a retry is queued', async ({ app, mocks }) => {
    await app.open();
    await app.activate();
    await app.freeze();
    mocks.gemini.always(quotaReply('20s'));
    await app.choose('commute', 'private_car');
    await app.advance(900);
    await expect.poll(() => mocks.gemini.calls.length).toBe(6);
    await app.settleSource('Advice: Refresh queued');

    await expect(app.cards.first()).toContainText('ride=two_wheeler');
    await app.expectFigures(defaultModel(CHANGED));

    mocks.gemini.always(echoReply);
    await app.advance(21000);
    await expect.poll(() => mocks.gemini.calls.length).toBe(7);
    await app.settleAdvice(defaultModel(CHANGED));
  });

  test('a quota reply followed by a working fallback model is not queued', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(quotaReply('20s'));
    await app.saveKey();

    await app.expectAdvice(defaultModel(), GEMINI_MODELS_CASCADE[1]);
    await app.expectIdle();
  });
});

test.describe('partial and repairable output', () => {
  test('fenced JSON is accepted', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next((call) => textReply(`\`\`\`json\n${JSON.stringify(echoPlan(call))}\n\`\`\``));
    await app.saveKey();
    await app.expectAdvice(defaultModel());
  });

  test('JSON truncated inside the advisory is repaired and keeps its routines', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next((call) => {
      const text = JSON.stringify(echoPlan(call));
      return textReply(text.slice(0, text.indexOf('Neighbourhood note') + 12));
    });
    await app.saveKey();

    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await expect(app.cards).toHaveCount(4);
    await expect(app.cards.first()).toContainText('ride=two_wheeler');
    expect(mocks.gemini.calls).toHaveLength(1);
  });

  test('JSON truncated beyond repair moves to the next model', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(textReply('{"hourlyRoutines":[{"timeSlot":"Mor'));
    await app.saveKey();
    await app.expectAdvice(defaultModel(), GEMINI_MODELS_CASCADE[1]);
  });

  test('a missing advisory is replaced by the on-device advisory', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(mutatedReply((plan) => {
      delete plan.communityAdvisory;
      delete plan.communityAdvisoryHi;
    }));
    await app.saveKey();

    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await expect(app.advisory).toContainText('Inversion Trap Alert');
    await app.expectFigures(defaultModel());
    await app.langButton.click();
    await expect(app.advisory).toContainText('वायुमंडलीय');
  });

  test('a Hindi field without Devanagari falls back to on-device Hindi', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(mutatedReply((plan) => { plan.communityAdvisoryHi = 'Only English words here.'; }));
    await app.saveKey();
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await app.langButton.click();

    await expect(app.advisory).toContainText('वायुमंडलीय');
    await expect(app.advisory).not.toContainText('Only English words here.');
  });

  test('incomplete routines are dropped and the rest are shown', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(mutatedReply((plan) => {
      delete plan.hourlyRoutines[0].activity;
      plan.hourlyRoutines[1].actionType = 'EXPLODE';
      plan.hourlyRoutines[2].recommendation = '   ';
    }));
    await app.saveKey();

    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await expect(app.cards).toHaveCount(1);
    await expect(app.cards.first()).toContainText('Evening routine');
  });

  test('more than six routines are capped at six', async ({ app, mocks }) => {
    await app.open();
    mocks.gemini.next(mutatedReply((plan) => {
      plan.hourlyRoutines = [...plan.hourlyRoutines, ...plan.hourlyRoutines, ...plan.hourlyRoutines];
    }));
    await app.saveKey();
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await expect(app.cards).toHaveCount(6);
  });
});

test.describe('hostile and contradicting model text', () => {
  const payloads = [
    '<img src=x onerror="window.injected=1">',
    '<script>window.injected=1</script>',
    '<a href="javascript:window.injected=1">open</a>',
    'Visit http://evil.example now',
    'Visit www.evil.example now',
    'Run `window.injected=1` now'
  ];

  test('markup and links in routines and advisory never reach the page', async ({ app, page, mocks }) => {
    await app.open();
    for (const payload of payloads) {
      await app.refill();
      mocks.gemini.next(mutatedReply((plan) => {
        plan.hourlyRoutines[0].recommendation = payload;
        plan.hourlyRoutines[1].activity = payload;
        plan.hourlyRoutines[2].timeSlot = payload;
        plan.communityAdvisory = payload;
        plan.communityAdvisoryHi = `सलाह ${payload}`;
      }));
      if (payload === payloads[0]) await app.saveKey();
      else await app.generateButton.click();

      await expect(app.cards).toHaveCount(1);
      await expect(app.advisory).toContainText('Inversion Trap Alert');
      await expect(page.locator('main')).not.toContainText(payload);
      await expect(page.locator('#hourly-schedule-container img, #hourly-schedule-container script, #hourly-schedule-container a, #advisory-preview *')).toHaveCount(0);
      await app.refill();
      await app.generateButton.click();
      await app.expectAdvice(defaultModel());
    }
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  });

  test('a plan made only of injected markup is refused entirely', async ({ app, page, mocks }) => {
    await app.open();
    mocks.gemini.always(mutatedReply((plan) => {
      plan.hourlyRoutines.forEach((routine) => { routine.recommendation = payloads[0]; });
    }));
    await app.saveKey();

    await expect(app.banner).toContainText('INVALID_RESPONSE');
    await app.expectOffline();
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  });

  for (const claim of [
    'Today you inhale 250 µg of particles.',
    'Today you inhale 250 micrograms of particles.',
    'Your exposure falls by 40% today.',
    'Your exposure falls by 40 percent today.',
    'The AQI 300 reading calls for care.',
    'The AQI is 300 right now.',
    'This equals 12 cigarettes today.',
    'You save 3.5 kg of carbon today.'
  ]) {
    test(`text restating an app figure is dropped: "${claim}"`, async ({ app, page, mocks }) => {
      await app.open();
      mocks.gemini.next(mutatedReply((plan) => {
        plan.hourlyRoutines[0].recommendation = claim;
        plan.communityAdvisory = claim;
      }));
      await app.saveKey();

      await expect(app.sourceAdvice).toContainText('Advice: Gemini');
      await expect(app.cards).toHaveCount(3);
      await expect(page.locator('main')).not.toContainText(claim);
      await expect(app.advisory).toContainText(`${computeImpact(defaultModel()).pm25AvoidedUg} µg`);
    });
  }

  for (const claim of [
    'With AQI above 450 today, stay indoors.',
    'The AQI has crossed 450, stay indoors.',
    'An air quality index of 450 was recorded.'
  ]) {
    test(`an AQI that contradicts the screen is not shown: "${claim}"`, async ({ app, page, mocks }) => {
      await app.open();
      mocks.gemini.next(mutatedReply((plan) => {
        plan.hourlyRoutines[0].recommendation = claim;
        plan.communityAdvisory = claim;
      }));
      await app.saveKey();

      await expect(app.sourceAdvice).toContainText('Advice: Gemini');
      await expect(app.heroAqi).toHaveText(String(defaultModel().aqi));
      await expect(page.locator('main')).not.toContainText(claim, { timeout: 2000 });
    });
  }
});
