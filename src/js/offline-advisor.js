/**
 * @fileoverview Deterministic Offline Clean Air Advisory Engine.
 * Rule-based fallback that builds the same plan shape as the Gemini path from the air quality
 * band, vulnerabilities, housing, cooking, heating, commute and indoor air hack, so the app
 * stays useful during network dropouts or without an API key.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module offline-advisor
 */

import { VULN_FLAGS } from './config.js';
import { getDiurnalInversion } from './air-quality-engine.js';
import {
  CHOICE_NAMES,
  DEFAULT_HACK_ID,
  computeImpact,
  getProtectionPolicy,
  getSeverityBand
} from './impact-calculator.js';

export const ACTION_TYPES = Object.freeze(['SHIFT_INDOORS', 'SAFE_VENTILATION', 'SEAL_HOME', 'COMMUTE_SHIELD']);

/**
 * 4-Hack Low-Cost Indoor Air Quality Catalog.
 * @readonly
 */
export const IAQ_HACKS_CATALOG = Object.freeze({
  corsi_rosenthal: {
    id: 'corsi_rosenthal',
    title: 'DIY Corsi-Rosenthal Box Air Purifier Cube',
    cadrCfm: 273,
    cadrEstimate: '273 CFM (Clean Air Delivery Rate)',
    costEstimate: 'About $48 in parts',
    materials: [
      '1x 20-inch box fan ($20)',
      '4x MERV 13 furnace filters ($25)',
      'Cardboard bottom base ($0)',
      '1x roll duct tape ($3)'
    ],
    steps: [
      'Tape 4 MERV 13 furnace filters into a square cube with airflow arrows pointing inward.',
      'Cut and tape a cardboard square to seal the bottom of the filter cube.',
      'Mount the 20-inch box fan on top pointing upwards; tape cardboard shroud around corners to prevent backflow vortex.',
      'Seal all corner edges with duct tape and place in central living space running on medium.'
    ]
  },
  pc_fan_stealth: {
    id: 'pc_fan_stealth',
    title: 'Ultra-Quiet 12V PC-Fan Nursery Air Purifier',
    cadrCfm: 85,
    cadrEstimate: '85 CFM (Whisper-Quiet 24 dBA)',
    costEstimate: '$20 total (ideal for sleeping infants & asthma)',
    materials: [
      '3x 120mm 12V computer fans ($12)',
      '1x MERV 13 / HEPA replacement sheet ($6)',
      '1x 12V DC wall adapter ($2)',
      'Foam tape / cardboard housing ($0)'
    ],
    steps: [
      'Array 3 120mm PC fans side-by-side wired in parallel to the 12V DC power plug.',
      'Mount the fan array onto a sealed cardboard or wooden plenum box.',
      'Seal a MERV 13 filter panel against the intake side with foam gasket tape.',
      'Run continuously in nursery or bedroom; produces zero motor whine under 25 dBA.'
    ]
  },
  wet_towel_emergency: {
    id: 'wet_towel_emergency',
    title: 'Emergency Passive Wet-Towel Adsorption & Window Seal',
    cadrCfm: 30,
    cadrEstimate: 'Stopgap draught seal, far weaker than a fan filter',
    costEstimate: '$2 total (for winter power cuts)',
    materials: [
      '2x clean cotton bath towels ($0)',
      'Water or light saline solution ($0)',
      'Clothes drying rack / window sills ($0)',
      'Foam weatherstripping / damp towel rolls ($2)'
    ],
    steps: [
      'Soak two large cotton bath towels in water, wring out excess so they are thoroughly damp.',
      'Hang directly across doorways or central living space on an indoor clothes rack.',
      'Roll damp hand towels along outer door sills to seal drafty perimeter gaps.',
      'Re-dampen every 3 hours and switch to a fan filter as soon as power returns.',
      'Never seal gaps in a home where solid fuel burns indoors (carbon monoxide risk).'
    ]
  },
  kitchen_vent_scrub: {
    id: 'kitchen_vent_scrub',
    title: 'Kitchen Exhaust Baffle & Activated Carbon Gas Scrub',
    cadrCfm: 180,
    cadrEstimate: '180 CFM (Traps cooking PM2.5 and NO2 gases)',
    costEstimate: '$15 total (protects against gas & biomass fuel)',
    materials: [
      '1x activated carbon cooker hood sheet ($8)',
      '1x fine aluminum mesh pre-filter ($7)',
      'Magnetic or tape fasteners ($0)'
    ],
    steps: [
      'Layer the activated carbon sheet behind the primary grease mesh of your exhaust hood.',
      'Fasten tightly with magnetic strips so all cooking fumes pass through carbon granules.',
      'Turn exhaust hood on 2 minutes before igniting gas/biomass burner.',
      'Activated carbon adsorbs toxic nitrogen dioxide (NO2) and volatile organics.'
    ]
  }
});

/**
 * Advice per vulnerability for days that need protection and for days that do not, with the
 * group names used in the community bulletin.
 * @readonly
 */
const VULNERABILITY_GUIDANCE = Object.freeze([
  {
    bit: VULN_FLAGS.INFANT,
    alert: 'Infant: keep the sleeping room as the cleanest room and postpone outings at smog peaks. Do not put a mask on a child under 2.',
    calm: 'Infant: normal outings are fine; check the AQI again before the evening.',
    who: 'infants',
    whoHi: 'शिशुओं'
  },
  {
    bit: VULN_FLAGS.ASTHMA,
    alert: 'Asthma or COPD: keep reliever medicine close, follow your care plan and seek medical care for breathing difficulty.',
    calm: 'Asthma or COPD: follow your usual care plan and note any new symptoms.',
    who: 'people with asthma',
    whoHi: 'अस्थमा के मरीज़ों'
  },
  {
    bit: VULN_FLAGS.SENIOR,
    alert: 'Older adult: move walks to the early afternoon and see a doctor for chest tightness or breathlessness.',
    calm: 'Older adult: a good day for gentle outdoor activity.',
    who: 'older adults',
    whoHi: 'बुज़ुर्गों'
  },
  {
    bit: VULN_FLAGS.PREGNANT,
    alert: 'Pregnancy: stay away from cooking smoke and ask someone else to do dusty cleaning.',
    calm: 'Pregnancy: normal activity is fine; keep avoiding cooking smoke.',
    who: 'pregnant women',
    whoHi: 'गर्भवती महिलाओं'
  },
  {
    bit: VULN_FLAGS.OUTDOOR_WORKER,
    alert: 'Outdoor worker: take breaks indoors away from traffic and move heavy work to the early afternoon.',
    calm: 'Outdoor worker: a normal shift is fine; recheck the AQI if haze builds.',
    who: 'outdoor workers',
    whoHi: 'बाहर काम करने वालों'
  }
]);

/**
 * Housing advice for days that need closed windows and for days that do not.
 * @readonly
 */
const HOUSING_GUIDANCE = Object.freeze({
  sealed_apartment: {
    alert: 'Airtight home: run the kitchen exhaust briefly so stale air does not build up between airings.',
    calm: 'Airtight home: open the windows for a while so stale air does not build up.'
  },
  standard_flat: {
    alert: 'Standard flat: close window latches and block door gaps after this airing.',
    calm: 'Standard flat: normal window airing is fine.'
  },
  drafty_home: {
    alert: 'Drafty home: tape or towel the gaps around doors and windows after this airing.',
    calm: 'Drafty home: natural airflow is welcome today.'
  }
});

/** Replaces gap-sealing advice in homes where solid fuel burns, because of carbon monoxide. */
const FUEL_GAP_WARNING = 'Do not seal door or window gaps while solid fuel burns indoors.';

const COOKING_GUIDANCE = Object.freeze({
  induction: 'Induction adds no combustion gases; run the exhaust to clear cooking particles.',
  png: 'Gas burners release NO2: start the kitchen exhaust before lighting the flame.',
  lpg: 'Gas burners release NO2: start the kitchen exhaust before lighting the flame.',
  biomass: 'Biomass smoke is a major indoor source: cook with a vent open and keep children away from the stove.'
});

const HEATING_GUIDANCE = Object.freeze({
  heat_pump: 'The heat pump adds no indoor smoke.',
  electric_radiator: 'The oil radiator adds no indoor smoke; keep fabrics clear of it.',
  space_heater: 'Never leave the space heater running in a closed room during sleep.',
  open_fire: 'The open fire releases smoke and carbon monoxide: never leave it burning during sleep.'
});

const FILTER_GUIDANCE = Object.freeze({
  corsi_rosenthal: 'Run the Corsi-Rosenthal box where the family sleeps.',
  pc_fan_stealth: 'Run the PC-fan purifier beside the bed overnight.',
  wet_towel_emergency: 'Lay damp towels along door gaps; they only slow the leak, so use a fan filter when you can.',
  kitchen_vent_scrub: 'The exhaust filter works only at the stove and does not clean smog that leaks in.'
});

/**
 * Commute advice for a calm day and a protective day, with whether a mask helps the mode.
 * @readonly
 */
const COMMUTE_GUIDANCE = Object.freeze({
  two_wheeler: {
    alert: 'Two-wheeler: close the helmet visor and stay clear of truck exhaust.',
    calm: 'A normal two-wheeler ride is fine.',
    usesMask: true
  },
  walk_cycle: {
    alert: 'Walking or cycling: take quieter streets and keep the effort gentle, because heavy breathing draws in more particles.',
    calm: 'A good morning to walk or cycle.',
    usesMask: true
  },
  public_transit: {
    alert: 'Metro: wait inside the station and away from the roadside.',
    calm: 'A normal metro trip is fine.',
    usesMask: true
  },
  private_car: {
    alert: 'Car: keep windows up and set the ventilation to recirculate.',
    calm: 'A normal drive is fine.',
    usesMask: false
  }
});

const BAND_LABELS = Object.freeze({
  GOOD: { en: 'good', hi: 'अच्छी' },
  MODERATE: { en: 'moderate', hi: 'मध्यम' },
  POOR: { en: 'poor', hi: 'खराब' },
  VERY_POOR: { en: 'very poor', hi: 'बहुत खराब' },
  SEVERE: { en: 'severe', hi: 'गंभीर' },
  HAZARDOUS: { en: 'hazardous', hi: 'अति-गंभीर' }
});

const HAZARDOUS_ABOVE = 400;

/**
 * Evaluates indoor cleaning and particulate resuspension protocols (PRD FR-06).
 * Prohibits traditional broom dry-sweeping when AQI > 200 to prevent coarse particle resuspension.
 *
 * @param {number} aqi - Ambient or indoor Air Quality Index.
 * @returns {{
 *   isTriggered: boolean,
 *   severity: 'WARNING' | 'SAFE',
 *   statusBadge: string,
 *   warning: string,
 *   recommendation: string,
 *   surfactantRatio: string
 * }} Structured cleaning and resuspension protocol.
 */
export function getCleaningProtocol(aqi) {
  const numericAQI = Number(aqi) || 0;
  const isTriggered = numericAQI > 200;

  if (isTriggered) {
    return {
      isTriggered: true,
      severity: 'WARNING',
      statusBadge: 'DRY SWEEPING PROHIBITED',
      warning: 'Dry broom sweeping throws settled PM10 and coarse dust back into the breathing zone, where it lingers in still winter air.',
      recommendation: 'Prohibit dry broom sweeping. Prescribe damp microfiber wet-mopping with 0.1% surfactant to capture settled particulates irreversibly via liquid surface tension.',
      surfactantRatio: '0.1% mild liquid detergent (approx. 1 tsp per 5 liters clean water)'
    };
  }

  return {
    isTriggered: false,
    severity: 'SAFE',
    statusBadge: 'STANDARD DAMP DUSTING',
    warning: 'Ambient particulate resuspension risk is low under current air quality conditions.',
    recommendation: 'Perform routine damp dusting and maintain standard room filtration hygiene.',
    surfactantRatio: 'Clean damp microfiber cloth or standard household water'
  };
}

/**
 * Wraps model-written advisory text with the header and impact line computed on device.
 *
 * @param {string} body - Advisory narrative.
 * @param {Object} ctx - Household context.
 * @param {{pm25AvoidedUg: number}} impact - Shared impact summary.
 * @param {'en'|'hi'} lang - Advisory language.
 * @returns {string} Shareable bulletin.
 */
export function frameAdvisory(body, ctx, impact, lang) {
  const city = ctx.city || 'Delhi NCR';
  const aqi = Math.max(0, Math.min(999, Math.round(Number(ctx.aqi) || 0)));
  if (lang === 'hi') {
    return `🚨 स्वच्छ वायु समुदाय परामर्श - ${city} (AQI ${aqi}):\n${body}\n• सुरक्षित उपायों से प्रतिदिन लगभग ${impact.pm25AvoidedUg} µg PM2.5 कम साँस में जाएगा।`;
  }
  return `🚨 CleanAir Community Advisory for ${city} (AQI ${aqi}):\n${body}\n• Estimated PM2.5 inhalation avoided with these steps: ${impact.pm25AvoidedUg} µg per day.`;
}

/**
 * Vulnerability entries selected in the bitfield.
 *
 * @param {number} vulnBits - Vulnerability bitfield.
 * @returns {Array<Object>} Matching guidance entries.
 */
function selectedGuidance(vulnBits) {
  return VULNERABILITY_GUIDANCE.filter((entry) => (Number(vulnBits) || 0) & entry.bit);
}

/**
 * Generates formatted community advisories in English or Hindi (हिन्दी), worded for the air
 * quality band and the vulnerable people in the household.
 *
 * @param {Object} ctx - Household lifestyle context.
 * @param {Object} plan - Partial action plan containing impact metrics.
 * @param {'en'|'hi'} [lang='en'] - Target advisory language.
 * @returns {string} Formatted WhatsApp/RWA broadcast bulletin.
 */
export function generateCommunityAdvisory(ctx, plan, lang = 'en') {
  const city = ctx.city || 'Delhi NCR';
  const rawAQI = Math.max(0, Math.min(999, Math.round(Number(ctx.aqi) || 0)));
  const severity = plan.severityLevel || getSeverityBand(rawAQI);
  const dosageAvoided = plan.quantifiedImpact ? plan.quantifiedImpact.pm25InhalationAvoidedMicrograms : 0;
  const hack = plan.iaqHack || IAQ_HACKS_CATALOG[DEFAULT_HACK_ID];
  const policy = getProtectionPolicy(rawAQI, ctx.vulnBits);
  const groups = selectedGuidance(ctx.vulnBits);
  const label = BAND_LABELS[severity] || BAND_LABELS.MODERATE;

  if (lang === 'hi') {
    const who = groups.map((g) => g.whoHi).join(', ') || 'बच्चों, बुज़ुर्गों और सांस के मरीज़ों';
    const hackLine = `• किफायती DIY हैक: ${hack.title} (अनुमानित लागत: ${hack.costEstimate}, CADR: ${hack.cadrEstimate})।\n`;
    let body = `• अच्छी खबर: हवा की गुणवत्ता ${label.hi} है। बाहर की सामान्य गतिविधि और खिड़कियाँ खोलना ठीक है।\n` +
      '• हरित आदत: जहाँ हो सके पैदल, साइकिल या मेट्रो से चलें और इंडक्शन पर खाना बनाएँ।\n';
    if (policy.restrictAiring) {
      body = `• वायुमंडलीय व्युत्क्रमण चेतावनी: सुबह और शाम के समय प्रदूषक ज़मीन के पास फंसे रहते हैं। सबसे पहले ${who} का ध्यान रखें।\n` +
        '• सुरक्षित धूप समय (Safe Window): दोपहर 12:30 से 03:30 के बीच आवश्यक कार्य करें और घर में थोड़ी देर ताज़ी हवा आने दें।\n' +
        hackLine;
    } else if (policy.useFilter) {
      body = `• सावधानी: हवा की गुणवत्ता ${label.hi} है। ${who} के लिए ट्रैफ़िक के पास भारी मेहनत कम रखें।\n` + hackLine;
    }
    const effect = dosageAvoided > 0
      ? `• प्रत्यक्ष प्रभाव (Direct Impact): आज के इन सुरक्षित उपायों से लगभग ${dosageAvoided} µg PM2.5 फेफड़ों में जाने से रोका जा सकता है।`
      : `• प्रत्यक्ष प्रभाव (Direct Impact): आज किसी अतिरिक्त सुरक्षा की ज़रूरत नहीं है (${dosageAvoided} µg अतिरिक्त बचत)।`;
    return `🚨 स्वच्छ वायु समुदाय परामर्श (CleanAir Advisory) - ${city} (AQI ${rawAQI} - ${label.hi}):\n${body}${effect}`;
  }

  const who = groups.map((g) => g.who).join(', ') || 'children, older adults and anyone with breathing trouble';
  const hackLine = `• Community Hack: ${hack.title} (${hack.costEstimate}, ${hack.cadrEstimate}).\n`;
  let body = `• Good News: air quality is ${label.en}. Normal outdoor activity and window airing are fine.\n` +
    '• Greener Habit: walk, cycle or take the metro and cook on induction where you can.\n';
  if (policy.restrictAiring) {
    body = `• Inversion Trap Alert: pollution builds near the ground around dawn and dusk. Protect ${who} first.\n` +
      '• Safe Solar Window: 12:30 PM to 03:30 PM is best for essential errands and a short home airing.\n' +
      hackLine;
  } else if (policy.useFilter) {
    body = `• Take Care: air quality is ${label.en}. Go easy on hard exercise near traffic, especially ${who}.\n` + hackLine;
  }
  const effect = dosageAvoided > 0
    ? `• Direct Impact: following this plan today avoids an estimated ${dosageAvoided} µg of inhaled PM2.5.`
    : `• Direct Impact: no extra protective steps are needed today (${dosageAvoided} µg additional saving).`;
  return `🚨 CleanAir Community Advisory for ${city} (AQI ${rawAQI} - ${severity}):\n${body}${effect}`;
}

/**
 * CleanAir Action Plan structure definition shared with the Gemini path.
 * @typedef {Object} CleanAirActionPlan
 * @property {string} severityLevel - GOOD | MODERATE | POOR | VERY_POOR | SEVERE | HAZARDOUS.
 * @property {string} diurnalWindowNotice - Atmospheric mixing explanation.
 * @property {Array<{timeSlot: string, activity: string, recommendation: string, actionType: string}>} hourlyRoutines - Timestamped schedule.
 * @property {{title: string, materials: string[], cadrEstimate: string, costEstimate: string, steps: string[]}} iaqHack - DIY hack.
 * @property {Array<{category: string, currentChoice: string, cleanAlternative: string, benefit: string}>} sustainableAlternatives - Low-carbon shifts.
 * @property {{isTriggered: boolean, severity: string, statusBadge: string, warning: string, recommendation: string, surfactantRatio: string}} cleaningProtocol - PRD FR-06 surface particulate protocol.
 * @property {{pm25InhalationAvoidedMicrograms: number, cigaretteEquivalentsAvoided: number, co2eSavedKg: number, protectionScorePercent: number}} quantifiedImpact - Direct mathematical impact telemetry.
 * @property {string} communityAdvisory - RWA / WhatsApp community broadcast bulletin.
 */

/**
 * Maps the shared impact summary onto the plan schema's quantifiedImpact shape.
 *
 * @param {ReturnType<typeof computeImpact>} impact - Shared impact summary.
 * @returns {{pm25InhalationAvoidedMicrograms: number, cigaretteEquivalentsAvoided: number,
 *   co2eSavedKg: number, protectionScorePercent: number}} Plan-shaped impact block.
 */
export function toQuantifiedImpact(impact) {
  return {
    pm25InhalationAvoidedMicrograms: impact.pm25AvoidedUg,
    cigaretteEquivalentsAvoided: impact.cigarettesAvoided,
    co2eSavedKg: impact.carbonSavedKg,
    protectionScorePercent: impact.protectionScorePercent
  };
}

/**
 * Builds the four daily routine slots for a household.
 *
 * @param {Object} home - Normalized household choices.
 * @param {ReturnType<typeof getProtectionPolicy>} policy - Protective actions for the day.
 * @returns {Array<{timeSlot: string, activity: string, recommendation: string, actionType: string}>} Slots.
 */
function buildRoutines(home, policy) {
  const tone = policy.restrictAiring ? 'alert' : 'calm';
  const commute = COMMUTE_GUIDANCE[home.commute];
  const label = BAND_LABELS[getSeverityBand(home.aqi)].en;
  const burnsFuel = home.cooking === 'biomass' || home.heating === 'open_fire';
  const people = selectedGuidance(home.vulnBits).map((g) => g[policy.useFilter ? 'alert' : 'calm']);
  const join = (parts) => parts.filter(Boolean).join(' ');

  let morningOpening = `Air quality is ${label}: outdoor exercise and school travel are fine.`;
  if (policy.useFilter) morningOpening = `Air quality is ${label}: keep hard exercise away from traffic.`;
  if (policy.restrictAiring) {
    morningOpening = 'Air near the ground is usually at its dirtiest now: keep windows closed.';
  }

  let midday = 'Open the windows and let the home air out.';
  if (policy.restrictAiring) {
    midday = home.aqi > HAZARDOUS_ABOVE
      ? 'Even midday air is hazardous: air the home for no more than 5 minutes, then close up and run filtration.'
      : 'Mixing is usually strongest now: air the home for about 15 minutes, then close up.';
  }

  let errands = {
    recommendation: 'A good window for errands, walks and play outdoors.',
    actionType: 'SAFE_VENTILATION'
  };
  if (policy.useMask) {
    errands = {
      recommendation: 'Run necessary errands now, while air is usually at its best, wearing a well-fitted N95.',
      actionType: 'COMMUTE_SHIELD'
    };
  }
  if (policy.avoidOutdoors) {
    errands = {
      recommendation: 'Postpone non-essential errands. If you must go out, keep it short and wear a well-fitted N95.',
      actionType: 'SHIFT_INDOORS'
    };
  }

  return [
    {
      timeSlot: '06:30 AM - 09:30 AM',
      activity: 'Morning Commute & School Window',
      recommendation: join([
        morningOpening,
        commute[tone],
        policy.useMask && commute.usesMask ? 'Wear a well-fitted N95.' : '',
        policy.avoidOutdoors ? 'Cancel outdoor exercise this morning.' : '',
        ...people
      ]),
      actionType: policy.restrictAiring ? 'SEAL_HOME' : 'SAFE_VENTILATION'
    },
    {
      timeSlot: '12:30 PM - 01:30 PM',
      activity: 'Solar Convective Aeration',
      recommendation: join([
        midday,
        burnsFuel && policy.restrictAiring && home.housing !== 'sealed_apartment'
          ? FUEL_GAP_WARNING
          : HOUSING_GUIDANCE[home.housing][tone]
      ]),
      actionType: 'SAFE_VENTILATION'
    },
    {
      timeSlot: '01:30 PM - 03:30 PM',
      activity: 'Outdoor Errands & Transit Window',
      ...errands
    },
    {
      timeSlot: '06:00 PM - 09:30 PM',
      activity: 'Evening Rush & Dinner Preparation',
      recommendation: join([
        policy.restrictAiring ? 'Close up again before the evening smog.' : '',
        policy.useFilter
          ? (burnsFuel && home.hackId === 'wet_towel_emergency' ? FUEL_GAP_WARNING : FILTER_GUIDANCE[home.hackId])
          : '',
        COOKING_GUIDANCE[home.cooking],
        HEATING_GUIDANCE[home.heating],
        burnsFuel ? `Keep a vent open whenever fuel is burning${policy.restrictAiring ? ', even on smoggy evenings' : ''}.` : ''
      ]),
      actionType: policy.restrictAiring ? 'SEAL_HOME' : 'SAFE_VENTILATION'
    }
  ];
}

/**
 * Turns the commute, cooking and heating comparisons into sustainable alternatives.
 *
 * @param {ReturnType<typeof computeImpact>} impact - Shared impact summary.
 * @param {boolean} useMask - Whether a mask is advised today.
 * @returns {Array<{category: string, currentChoice: string, cleanAlternative: string, benefit: string}>}
 */
function buildAlternatives(impact, useMask) {
  const byChoice = Object.fromEntries(impact.choices.map((item) => [item.choice, item]));
  const { commute, cooking, heating } = byChoice;
  const isLowCarbonCommute = commute.current === 'walk_cycle' || commute.current === 'public_transit';
  const maskNote = useMask ? ' A well-fitted N95 cuts what you breathe on the way.' : '';

  const toCard = (category, item, extra = '') => ({
    category,
    currentChoice: CHOICE_NAMES[item.choice][item.current],
    cleanAlternative: item.alternative
      ? CHOICE_NAMES[item.choice][item.alternative]
      : `Keep using ${CHOICE_NAMES[item.choice][item.current].toLowerCase()}`,
    benefit: `${item.explanation}${extra}`
  });

  return [
    isLowCarbonCommute
      ? {
        category: 'Urban Transit',
        currentChoice: CHOICE_NAMES.commute[commute.current],
        cleanAlternative: 'Keep this low-carbon commute and use quieter, early-afternoon trips where possible',
        benefit: `Your commute is already low-carbon.${maskNote}`
      }
      : toCard('Urban Transit', commute, ' Sharing the ride also lowers emissions per person.'),
    toCard('Cooking', cooking, cooking.current === 'biomass' ? ' It also removes a major indoor smoke source.' : ''),
    toCard('Home Heating', heating)
  ];
}

/**
 * Deterministically generates an actionable clean air plan in the shared plan schema.
 * Operates purely on local rules with zero network calls.
 *
 * @param {Object} ctx - Household lifestyle context.
 * @param {Object} [options={}] - Optional overrides for selected hackId and language.
 * @returns {CleanAirActionPlan} Authoritative CleanAir action plan.
 */
export function generateOfflineCleanAirPlan(ctx, options = {}) {
  const rawAQI = Math.max(0, Math.min(999, Math.round(Number(ctx.aqi) || 0)));
  const simHour = ctx.simulatedHour !== null && ctx.simulatedHour !== undefined
    ? Number(ctx.simulatedHour)
    : 7.5;
  const severity = getSeverityBand(rawAQI);
  const policy = getProtectionPolicy(rawAQI, ctx.vulnBits);

  const requestedHack = options.hackId || ctx.hackId;
  const iaqHack = IAQ_HACKS_CATALOG[requestedHack] || IAQ_HACKS_CATALOG[DEFAULT_HACK_ID];
  const impact = computeImpact({ ...ctx, hackId: iaqHack.id });

  const pick = (value, table, fallback) => (Object.hasOwn(table, value) ? value : fallback);
  const home = {
    aqi: rawAQI,
    vulnBits: ctx.vulnBits,
    hackId: iaqHack.id,
    commute: pick(ctx.commuteMode, COMMUTE_GUIDANCE, 'two_wheeler'),
    cooking: pick(ctx.cookingMethod, COOKING_GUIDANCE, 'lpg'),
    heating: pick(ctx.heatingMethod, HEATING_GUIDANCE, 'space_heater'),
    housing: pick(ctx.housingType, HOUSING_GUIDANCE, 'standard_flat')
  };

  const advisoryPlanStub = {
    severityLevel: severity,
    quantifiedImpact: { pm25InhalationAvoidedMicrograms: impact.pm25AvoidedUg },
    iaqHack
  };
  const advisoryEn = generateCommunityAdvisory(ctx, advisoryPlanStub, 'en');
  const advisoryHi = generateCommunityAdvisory(ctx, advisoryPlanStub, 'hi');

  return {
    severityLevel: severity,
    diurnalWindowNotice: policy.restrictAiring
      ? getDiurnalInversion(simHour, rawAQI).advisory
      : `Air quality is ${BAND_LABELS[severity].en}. Mornings and evenings are usually a little hazier than midday.`,
    hourlyRoutines: buildRoutines(home, policy),
    iaqHack,
    cleaningProtocol: getCleaningProtocol(rawAQI),
    sustainableAlternatives: buildAlternatives(impact, policy.useMask),
    quantifiedImpact: toQuantifiedImpact(impact),
    communityAdvisory: (options.lang || ctx.lang) === 'hi' ? advisoryHi : advisoryEn,
    bilingualAdvisory: {
      en: advisoryEn,
      hi: advisoryHi
    }
  };
}

/**
 * Factory creating validated, normalized CleanAirActionPlan instances.
 * Conforms to GoF Factory Pattern and LLD 03 §3.4.
 */
export class PlanFactory {
  /**
   * Normalizes and freezes raw action plan structure.
   * @param {Object} raw - Raw plan data.
   * @returns {Readonly<Object>} Frozen normalized action plan.
   */
  static createPlan(raw) {
    if (!raw || typeof raw !== 'object') {
      return Object.freeze({
        severityLevel: 'MODERATE',
        diurnalWindowNotice: 'Standard diurnal schedule.',
        hourlyRoutines: [],
        iaqHack: Object.freeze({ title: 'Damp Wet-Mopping', materials: [], steps: [] }),
        cleaningProtocol: null,
        sustainableAlternatives: [],
        quantifiedImpact: Object.freeze({
          pm25InhalationAvoidedMicrograms: 0,
          cigaretteEquivalentsAvoided: 0,
          co2eSavedKg: 0,
          protectionScorePercent: 0
        }),
        communityAdvisory: ''
      });
    }

    return Object.freeze({
      severityLevel: raw.severityLevel || 'MODERATE',
      diurnalWindowNotice: raw.diurnalWindowNotice || 'Standard diurnal schedule.',
      hourlyRoutines: Array.isArray(raw.hourlyRoutines)
        ? raw.hourlyRoutines.filter((r) => r && typeof r === 'object').map((r) => Object.freeze({
          ...r,
          actionType: ACTION_TYPES.includes(r.actionType) ? r.actionType : 'SHIFT_INDOORS'
        }))
        : [],
      iaqHack: Object.freeze({
        title: 'Damp Wet-Mopping',
        ...raw.iaqHack,
        materials: Array.isArray(raw.iaqHack?.materials) ? raw.iaqHack.materials : [],
        steps: Array.isArray(raw.iaqHack?.steps) ? raw.iaqHack.steps : []
      }),
      cleaningProtocol: raw.cleaningProtocol ? Object.freeze(raw.cleaningProtocol) : null,
      sustainableAlternatives: Array.isArray(raw.sustainableAlternatives) ? raw.sustainableAlternatives.map(Object.freeze) : [],
      quantifiedImpact: Object.freeze({
        pm25InhalationAvoidedMicrograms: Number(raw.quantifiedImpact?.pm25InhalationAvoidedMicrograms) || 0,
        cigaretteEquivalentsAvoided: Number(raw.quantifiedImpact?.cigaretteEquivalentsAvoided) || 0,
        co2eSavedKg: Number(raw.quantifiedImpact?.co2eSavedKg) || 0,
        protectionScorePercent: Math.min(Math.max(Number(raw.quantifiedImpact?.protectionScorePercent) || 0, 0), 100)
      }),
      communityAdvisory: String(raw.communityAdvisory || ''),
      bilingualAdvisory: raw.bilingualAdvisory ? Object.freeze(raw.bilingualAdvisory) : undefined
    });
  }

  /**
   * Validates whether an action plan object conforms to the mandatory CleanAirActionPlan schema.
   * Conforms to HLD 02 §2.4 C4 Class Model and API Contract 03 §2.1.
   *
   * @param {Object} plan - Action plan candidate.
   * @returns {boolean} True if plan satisfies all schema invariants.
   */
  static validateSchema(plan) {
    if (!plan || typeof plan !== 'object') return false;
    return Boolean(
      typeof plan.severityLevel === 'string' &&
      typeof plan.diurnalWindowNotice === 'string' &&
      Array.isArray(plan.hourlyRoutines) &&
      plan.iaqHack && typeof plan.iaqHack === 'object' &&
      Array.isArray(plan.sustainableAlternatives) &&
      plan.quantifiedImpact && typeof plan.quantifiedImpact === 'object' &&
      typeof plan.quantifiedImpact.pm25InhalationAvoidedMicrograms === 'number' &&
      typeof plan.communityAdvisory === 'string'
    );
  }
}
