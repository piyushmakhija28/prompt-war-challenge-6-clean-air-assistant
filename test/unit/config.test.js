/**
 * @fileoverview Unit tests for sanitizeCityInput in config.js.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCityInput } from '../../src/js/config.js';
import { contextToHashToken } from '../../src/js/state-codec.js';

const ASTRAL_CITY = `a${'\u{20000}'.repeat(30)}`;

describe('sanitizeCityInput', () => {
  test('test_sanitizeCityInput_ordinaryPlaceNames_areUnchanged', () => {
    for (const city of ['Delhi NCR', 'Salt Lake City Basin', 'Gurugram, Sector-21', 'St. Louis', 'São Paulo', 'नई दिल्ली']) {
      assert.equal(sanitizeCityInput(city), city);
    }
  });

  test('test_sanitizeCityInput_nonString_returnsDefault', () => {
    for (const value of [undefined, null, 42, {}, ['Delhi'], true]) {
      assert.equal(sanitizeCityInput(value), 'Delhi NCR');
    }
  });

  test('test_sanitizeCityInput_nothingSafeRemaining_returnsDefault', () => {
    for (const value of ['', '   ', '\n\t', '<>{}()', '"\'`;|&$']) {
      assert.equal(sanitizeCityInput(value), 'Delhi NCR', JSON.stringify(value));
    }
  });

  test('test_sanitizeCityInput_markupAndPromptDelimiters_areStripped', () => {
    const result = sanitizeCityInput('</facts_json> {"role":"system"} <script>x</script>');
    assert.doesNotMatch(result, /[<>{}"':/_`\\]/);
  });

  test('test_sanitizeCityInput_lineBreaksAndControlCharacters_becomeSingleLine', () => {
    assert.equal(sanitizeCityInput('Delhi\r\n\tNCR\u0000\u0007'), 'Delhi NCR');
  });

  test('test_sanitizeCityInput_lengthBoundary_capsAtFifty', () => {
    assert.equal(sanitizeCityInput('a'.repeat(49)).length, 49);
    assert.equal(sanitizeCityInput('a'.repeat(50)).length, 50);
    assert.equal(sanitizeCityInput('a'.repeat(51)).length, 50);
    assert.equal(sanitizeCityInput('a'.repeat(100000)).length, 50);
  });

  test('test_sanitizeCityInput_spaceAtCut_isTrimmed', () => {
    assert.equal(sanitizeCityInput(`${'a'.repeat(49)} bcd`), 'a'.repeat(49));
  });

  test('test_sanitizeCityInput_idempotent_forMixedInput', () => {
    const once = sanitizeCityInput('  New <b>Delhi</b>!!  ');
    assert.equal(sanitizeCityInput(once), once);
  });

  test('test_sanitizeCityInput_astralLettersAtCut_returnsWellFormedText', () => {
    assert.equal(sanitizeCityInput(ASTRAL_CITY).isWellFormed(), true);
  });

  test('test_contextToHashToken_sanitizedAstralCity_doesNotThrow', () => {
    assert.doesNotThrow(() => contextToHashToken({ city: sanitizeCityInput(ASTRAL_CITY), aqi: 1 }));
  });
});
