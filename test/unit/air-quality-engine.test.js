/**
 * @fileoverview Projection of an observed AQI reading onto another hour of the day.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { projectDiurnalReading, getDiurnalInversion } from '../../src/js/air-quality-engine.js';

const OBSERVED = '2026-11-28T10:00';

describe('projectDiurnalReading', () => {
  it('returns the reading unchanged at its own observation hour', () => {
    const projected = projectDiurnalReading(10, 224, OBSERVED);

    assert.equal(projected.effectiveAQI, 224);
    assert.equal(projected.ratio, 1);
    assert.equal(projected.observedClock, '10:00');
  });

  it('applies the ratio of the two hourly multipliers', () => {
    const projected = projectDiurnalReading(7.5, 224, OBSERVED);
    const ratio = getDiurnalInversion(7.5, 224).multiplier / getDiurnalInversion(10, 224).multiplier;

    assert.equal(projected.phase, 'MORNING_TRAP');
    assert.ok(Math.abs(projected.effectiveAQI - 224 * ratio) <= 3, `${projected.effectiveAQI}`);
    assert.ok(projected.effectiveAQI < getDiurnalInversion(7.5, 224).effectiveAQI);
  });

  it('reads minutes from the observation time', () => {
    assert.equal(projectDiurnalReading(10.25, 224, '2026-11-28T10:15').effectiveAQI, 224);
  });

  for (const [label, aqi, expected] of [['a large reading', 999, 999], ['a negative reading', -20, 0]]) {
    it(`keeps ${label} on the AQI scale`, () => {
      assert.equal(projectDiurnalReading(7.5, aqi, '2026-11-28T13:00').effectiveAQI, expected);
    });
  }

  for (const observedAt of ['', undefined, null, 't1', '2026-11-28', '2026-11-28T24:00']) {
    it(`declines an unreadable observation time: ${String(observedAt)}`, () => {
      assert.equal(projectDiurnalReading(7.5, 224, observedAt), null);
    });
  }
});
