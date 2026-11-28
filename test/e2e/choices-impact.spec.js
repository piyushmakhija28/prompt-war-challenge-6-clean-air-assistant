/**
 * @fileoverview How household choices change the impact: the breakdown card, the DIY hacks,
 * clean-air days, solid fuel safety and the model insight attached to each choice.
 *
 * <p>Figures are written out as literals, recomputed from the documented model assumptions
 * and the manual QA table in README.md, so they do not follow the application output.
 * @module test/e2e/choices-impact
 */

import { test, expect, echoPlan, planReply } from './fixtures.js';

const CHOICE_ORDER = ['iaq_hack', 'cooking', 'heating', 'commute', 'housing'];
const PROTECTIVE_WORDING = /N95|\bseal|\bmask|towel|\btape\b|close up|windows? closed|keep windows (closed|up)|block door gaps|window latches|सील|मास्क/i;
const VENT_WARNING = 'Keep a vent open whenever fuel is burning.';

/**
 * Breakdown sentence for a choice that has nothing cleaner to switch to.
 *
 * @param {string} name - Display name of the current choice.
 * @returns {string} Sentence.
 */
function alreadyCleanest(name) {
  return `${name}: already the cleanest option modelled here.`;
}

/**
 * Contribution line of the breakdown card.
 *
 * @param {number} indoor - Indoor air share in ug.
 * @param {number} timing - Window timing share in ug.
 * @param {number} travel - Travel share in ug.
 * @returns {string} Line.
 */
function contributionLine(indoor, timing, travel) {
  return `Avoided today: indoor air ${indoor} µg · window timing ${timing} µg · travel ${travel} µg`;
}

/**
 * Asserts the five breakdown sentences in their fixed order.
 *
 * @param {import('./fixtures.js').CleanAirPage} app - Page object.
 * @param {Object<string, string>} lines - Sentence per choice id.
 */
async function expectBreakdown(app, lines) {
  await expect(app.breakdownItems).toHaveText(CHOICE_ORDER.map((choice) => lines[choice]));
  for (const choice of CHOICE_ORDER) {
    await expect(app.choiceLine(choice)).toHaveText(lines[choice]);
  }
}

const VIKRAM_LINES = Object.freeze({
  iaq_hack: alreadyCleanest('Corsi-Rosenthal box'),
  cooking: alreadyCleanest('Induction'),
  heating: alreadyCleanest('Heat pump'),
  commute: 'Two-wheeler: switching to "Metro" would cut your inhaled PM2.5 by about 9 µg a day and save about 0.7 kg CO2e a day.',
  housing: 'Standard flat: switching to "Airtight apartment" would cut your inhaled PM2.5 by about 117 µg a day.'
});

test.describe('choice breakdown card', () => {
  test('the card explains all five choices of the Vikram household @mobile', async ({ app, page }) => {
    await app.open();
    await app.persona('vikram');

    await expect(page.getByRole('heading', { name: 'How Your Choices Change the Impact' })).toBeVisible();
    await expect(app.avoidedMetric).toHaveText('463 µg');
    await expect(app.contributions).toHaveText(contributionLine(354, 64, 45));
    await expectBreakdown(app, VIKRAM_LINES);
    await expect(app.protectedLabel).toHaveText(
      '🟢 With CleanAir Plan (DIY Corsi-Rosenthal Box Air Purifier Cube / N95 outdoors / timed airing)'
    );
  });

  test('the card follows a heating change and returns when it is undone', async ({ app, page }) => {
    await app.open();
    await app.persona('vikram');
    await app.choose('heating', 'open_fire');

    await expect(app.avoidedMetric).toHaveText('576 µg');
    await expect(page.locator('#metric-carbon-saved')).toHaveText('5.7 kg');
    await expect(app.contributions).toHaveText(contributionLine(467, 64, 45));
    await expect(app.choiceLine('heating')).toHaveText(
      'Open fire: switching to "Heat pump" would cut your inhaled PM2.5 by about 84 µg a day and save about 5 kg CO2e a day.'
    );
    await expect(app.choiceLine('housing'))
      .toHaveText('Standard flat: keep a vent open while solid fuel burns indoors (carbon monoxide risk).');

    await app.choose('heating', 'heat_pump');

    await expect(app.avoidedMetric).toHaveText('463 µg');
    await expect(app.contributions).toHaveText(contributionLine(354, 64, 45));
    await expectBreakdown(app, VIKRAM_LINES);
  });

  test('moving to the metro leaves no carbon to save', async ({ app, page }) => {
    await app.open();
    await app.persona('vikram');
    await app.choose('commute', 'public_transit');

    await expect(app.avoidedMetric).toHaveText('452 µg');
    await expect(page.locator('#metric-carbon-saved')).toHaveText('0 kg');
    await expect(app.choiceLine('commute')).toHaveText(alreadyCleanest('Metro'));
  });

  const hacks = [
    {
      id: 'pc_fan_stealth', avoided: 400, indoor: 291, title: 'Ultra-Quiet 12V PC-Fan Nursery Air Purifier',
      line: 'PC-fan purifier: switching to "Corsi-Rosenthal box" would cut your inhaled PM2.5 by about 63 µg a day.'
    },
    {
      id: 'wet_towel_emergency', avoided: 167, indoor: 58, title: 'Emergency Passive Wet-Towel Adsorption & Window Seal',
      line: 'Wet towels at door gaps: switching to "Corsi-Rosenthal box" would cut your inhaled PM2.5 by about 296 µg a day.'
    },
    {
      id: 'kitchen_vent_scrub', avoided: 112, indoor: 3, title: 'Kitchen Exhaust Baffle & Activated Carbon Gas Scrub',
      line: 'Kitchen exhaust filter: switching to "Corsi-Rosenthal box" would cut your inhaled PM2.5 by about 351 µg a day.'
    }
  ];

  for (const { id, avoided, indoor, title, line } of hacks) {
    test(`choosing the ${id} hack changes the avoided figure and its explanation`, async ({ app }) => {
      await app.open();
      await app.persona('vikram');
      await expect(app.avoidedMetric).toHaveText('463 µg');

      await app.hack(id);

      await expect(app.avoidedMetric).toHaveText(`${avoided} µg`);
      await expect(app.advisory).toContainText(`${avoided} µg`);
      await expect(app.contributions).toHaveText(contributionLine(indoor, 64, 45));
      await expect(app.choiceLine('iaq_hack')).toHaveText(line);
      await expect(app.protectedLabel)
        .toHaveText(`🟢 With CleanAir Plan (${title} / N95 outdoors / timed airing)`);

      await app.hack('corsi_rosenthal');

      await expect(app.avoidedMetric).toHaveText('463 µg');
      await expectBreakdown(app, VIKRAM_LINES);
    });
  }

  test('a solo driver is told about recirculation instead of a mask', async ({ app }) => {
    await app.open();
    await app.persona('vikram');
    await app.choose('commute', 'private_car');

    await expect(app.protectedLabel).toHaveText(
      '🟢 With CleanAir Plan (DIY Corsi-Rosenthal Box Air Purifier Cube / car air recirculation / timed airing)'
    );
  });
});

test.describe('clean-air day', () => {
  const households = [
    ['the default household', async () => {}],
    ['every vulnerability in a drafty home with a solo car', async (app) => {
      await app.setVulnerability(4, true);
      await app.setVulnerability(8, true);
      await app.setVulnerability(16, true);
      await app.housing.selectOption('drafty_home');
      await app.choose('commute', 'private_car');
    }],
    ['a walker in an airtight apartment using the PC fan', async (app) => {
      await app.housing.selectOption('sealed_apartment');
      await app.choose('commute', 'walk_cycle');
      await app.hack('pc_fan_stealth');
    }]
  ];

  for (const [label, arrange] of households) {
    test(`AQI 30 gives ${label} no sealing or N95 advice and no avoided dose`, async ({ app, page }) => {
      await app.open();
      await arrange(app);
      await expect(app.schedule).toContainText(PROTECTIVE_WORDING);
      await app.aqiSlider.fill('30');

      await expect(app.avoidedMetric).toHaveText('0 µg');
      await expect(page.locator('#metric-cigarettes-avoided')).toHaveText('0.0 Cigs');
      await expect(page.locator('#metric-protection-score')).toHaveText('0%');
      await expect(app.contributions).toHaveText(contributionLine(0, 0, 0));
      await expect(app.protectedLabel).toHaveText('🟢 With CleanAir Plan (no extra protection needed today)');
      await expect(app.cards).toHaveCount(4);
      await expect(app.advisory).toContainText('(AQI 30 - GOOD)');

      for (const region of [app.schedule, app.advisory, app.breakdownItems, app.alternatives,
        page.locator('#hero-inversion-notice')]) {
        for (const text of await region.allInnerTexts()) {
          expect(text).not.toMatch(PROTECTIVE_WORDING);
        }
      }

      await app.langButton.click();
      await expect(app.advisory).toHaveAttribute('lang', 'hi');
      expect(await app.advisory.innerText()).not.toMatch(PROTECTIVE_WORDING);
    });
  }

  test('wet towels chosen at AQI 30 claim no protection', async ({ app }) => {
    await app.open();
    await app.aqiSlider.fill('30');
    await app.hack('wet_towel_emergency');

    await expect(app.avoidedMetric).toHaveText('0 µg');
    await expect(app.protectedLabel).toHaveText('🟢 With CleanAir Plan (no extra protection needed today)');
    await expect(app.choiceLine('iaq_hack'))
      .toHaveText('Wet towels at door gaps: switching to "Corsi-Rosenthal box" makes no modelled difference today.');
    await expect(app.schedule).not.toContainText(/towel/i);
  });
});

test.describe('solid fuel on a calm day', () => {
  const fuels = [
    ['open-fire heating', 'heating', 'open_fire', 'heat_pump'],
    ['biomass cooking', 'cooking', 'biomass', 'induction']
  ];

  for (const [label, group, fuel, clean] of fuels) {
    test(`${label} brings keep-a-vent-open advice that leaves with the fuel`, async ({ app }) => {
      await app.open();
      await app.aqiSlider.fill('30');
      await expect(app.schedule).not.toContainText(VENT_WARNING);

      await app.choose(group, fuel);

      const evening = app.cards.nth(3);
      await expect(evening).toContainText(VENT_WARNING);
      await expect(app.schedule).not.toContainText(PROTECTIVE_WORDING);
      await expect(app.choiceLine('housing'))
        .toHaveText('Standard flat: keep a vent open while solid fuel burns indoors (carbon monoxide risk).');
      await expect(app.breakdownItems.filter({ hasText: 'Airtight' })).toHaveCount(0);
      if (fuel === 'open_fire') await expect(evening).toContainText('carbon monoxide');

      await app.choose(group, clean);

      await expect(app.schedule).not.toContainText('Keep a vent open');
      await expect(app.choiceLine('housing')).toContainText('switching to "Airtight apartment"');
    });
  }
});

test.describe('model insight per choice', () => {
  const insights = [
    {
      choice: 'commute',
      alternative: 'Share a metro ride for the daily trip',
      whyItMatters: 'Riding beside exhaust pipes keeps you close to traffic smoke.'
    },
    {
      choice: 'cooking',
      alternative: 'Move a daily meal to induction',
      whyItMatters: 'This removes 4 parts in 10 of the kitchen smoke.'
    },
    {
      choice: 'housing',
      alternative: 'Weatherstrip the window frames',
      whyItMatters: 'Gaps let outdoor haze drift inside.'
    }
  ];

  /**
   * Successful reply carrying the echoed plan and the fixed insights.
   *
   * @param {Object} call - Recorded Gemini call.
   * @returns {Object} Mock reply.
   */
  function insightReply(call) {
    return planReply({ ...echoPlan(call), choiceInsights: insights });
  }

  /**
   * Alternative card of one category.
   *
   * @param {import('./fixtures.js').CleanAirPage} app - Page object.
   * @param {string} category - Category label.
   * @returns {import('@playwright/test').Locator} Card.
   */
  function card(app, category) {
    return app.alternatives.locator('.alt-card')
      .filter({ has: app.page.locator('.alt-category', { hasText: category }) });
  }

  test('a usable insight is shown with the app estimate and a figure bearing one is dropped', async ({ app, mocks }) => {
    mocks.gemini.always(insightReply);
    await app.open();
    await app.saveKey();
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');

    const commute = card(app, 'Urban Transit');
    await expect(commute).toContainText('Shift: Share a metro ride for the daily trip');
    await expect(commute.locator('.alt-benefit-text')).toHaveText(
      /^Riding beside exhaust pipes keeps you close to traffic smoke\. App estimate: Two-wheeler: switching to "Metro" would .*save about 0\.45 kg CO2e a day\.$/
    );
    await expect(card(app, 'Home Sealing')).toContainText('Shift: Weatherstrip the window frames');
    await expect(app.alternatives).not.toContainText('Move a daily meal to induction');
    await expect(app.alternatives).not.toContainText('4 parts in 10');
    await expect(card(app, 'Cooking')).toContainText('Shift: Induction');
  });

  test('an insight disappears as soon as its choice changes', async ({ app, mocks }) => {
    mocks.gemini.always(insightReply);
    await app.open();
    await app.saveKey();
    await expect(app.alternatives).toContainText('Share a metro ride for the daily trip');

    const gate = mocks.gemini.hold(insightReply);
    await app.choose('commute', 'public_transit');

    await expect(app.alternatives).not.toContainText('Share a metro ride for the daily trip');
    await expect(card(app, 'Urban Transit')).toContainText('already low-carbon');
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await gate.release();
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');

    await expect(app.alternatives).toContainText('Weatherstrip the window frames');
    await expect(app.alternatives).not.toContainText('Share a metro ride for the daily trip');
  });

  test('a model sealing idea is never shown while solid fuel burns indoors', async ({ app, mocks }) => {
    mocks.gemini.always(insightReply);
    await app.open();
    await app.saveKey();
    await expect(app.alternatives).toContainText('Weatherstrip the window frames');

    await app.choose('heating', 'open_fire');

    await expect(app.alternatives).not.toContainText('Weatherstrip the window frames');
    await expect.poll(() => mocks.gemini.calls.length).toBe(2);
    await expect(app.sourceAdvice).toContainText('Advice: Gemini');
    await expect(app.alternatives).toContainText('Share a metro ride for the daily trip');
    await expect(app.alternatives).not.toContainText('Weatherstrip the window frames');
  });
});
