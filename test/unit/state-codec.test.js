/**
 * @fileoverview Unit tests for state-codec.js: lossless round trips, compact layout
 * boundaries and handling of hostile or corrupted shared links.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeBase64URL,
  decodeBase64URL,
  packContextTo5Bytes,
  contextToHashToken,
  unpackContextFrom5Bytes,
  hashTokenToContext
} from '../../src/js/state-codec.js';
import { METRO_BASIN_PRESETS } from '../../src/js/config.js';

const PRESET_CONTEXT = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  vulnBits: 3,
  cookingMethod: 'lpg',
  heatingMethod: 'space_heater',
  commuteMode: 'two_wheeler',
  commuteKm: 14,
  housingType: 'standard_flat',
  simulatedHour: null
});

const BASE = Object.freeze({
  city: 'Delhi NCR',
  aqi: 395,
  vulnBits: 3,
  housingType: 'standard_flat',
  cookingMethod: 'lpg',
  heatingMethod: 'space_heater',
  commuteMode: 'two_wheeler',
  commuteKm: 14,
  simulatedHour: null
});

/**
 * Encodes raw bytes as a compact hash.
 *
 * @param {Iterable<number>} bytes - Byte values.
 * @returns {string} Hash with the b= prefix.
 */
function compactHash(bytes) {
  return `#b=${Buffer.from(Uint8Array.from(bytes)).toString('base64url')}`;
}

/**
 * Encodes a pipe separated payload as a v1 hash.
 *
 * @param {Array<*>} parts - Payload fields.
 * @returns {string} Hash with the v1= prefix.
 */
function v1Hash(parts) {
  return `#v1=${Buffer.from(parts.join('|'), 'utf8').toString('base64url')}`;
}

describe('round trip', () => {
  test('test_contextToHashToken_everyOptionCombination_roundTripsLosslessly', () => {
    const failures = [];
    for (const city of [...METRO_BASIN_PRESETS, 'Greater Noida, UP']) {
      for (const housingType of ['standard_flat', 'sealed_apartment', 'drafty_home']) {
        for (const cookingMethod of ['induction', 'png', 'lpg', 'biomass']) {
          for (const heatingMethod of ['electric_radiator', 'space_heater', 'heat_pump', 'open_fire']) {
            for (const commuteMode of ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car']) {
              for (const simulatedHour of [null, 0, 7.5, 23]) {
                const ctx = { ...BASE, city, housingType, cookingMethod, heatingMethod, commuteMode, simulatedHour };
                const decoded = hashTokenToContext(contextToHashToken(ctx));
                if (JSON.stringify(decoded, Object.keys(ctx).sort()) !== JSON.stringify(ctx, Object.keys(ctx).sort())) {
                  failures.push({ ctx, decoded });
                }
              }
            }
          }
        }
      }
    }
    assert.deepEqual(failures.slice(0, 3), []);
  });

  for (const [field, values] of Object.entries({
    aqi: [0, 1, 255, 256, 511, 512, 998, 999],
    vulnBits: [0, 1, 2, 4, 8, 16, 31],
    commuteKm: [0, 1, 7, 8, 126, 127, 128, 200, 12.5],
    simulatedHour: [1, 12, 23, 23.75]
  })) {
    test(`test_contextToHashToken_${field}Boundaries_roundTrip`, () => {
      for (const value of values) {
        const ctx = { ...BASE, [field]: value };
        assert.equal(hashTokenToContext(`#${contextToHashToken(ctx)}`)[field], value, `${field}=${value}`);
      }
    });
  }

  test('test_contextToHashToken_presetDefault_usesSevenCharacterCompactForm', () => {
    assert.match(contextToHashToken(BASE), /^b=[A-Za-z0-9_-]{7}$/);
  });

  test('test_contextToHashToken_lossyForCompactLayout_usesV1Form', () => {
    for (const override of [
      { city: 'Noida' }, { housingType: 'drafty_home' }, { simulatedHour: 0 },
      { simulatedHour: 7.5 }, { commuteKm: 128 }, { commuteKm: 2.5 }
    ]) {
      assert.match(contextToHashToken({ ...BASE, ...override }), /^v1=/, JSON.stringify(override));
    }
  });

  test('test_hashTokenToContext_liveSuffix_isIgnoredByDecoder', () => {
    for (const ctx of [BASE, { ...BASE, city: 'Noida' }]) {
      const token = contextToHashToken(ctx);
      assert.deepEqual(hashTokenToContext(`#${token}&live=1`), hashTokenToContext(token));
    }
  });

  test('test_contextToHashToken_unicodeCity_roundTrips', () => {
    for (const city of ['São Paulo', 'नई दिल्ली', '北京市']) {
      assert.equal(hashTokenToContext(contextToHashToken({ ...BASE, city })).city, city);
    }
  });

  test('test_contextToHashToken_cityContainingDelimiter_doesNotShiftFields', () => {
    const decoded = hashTokenToContext(contextToHashToken({ ...BASE, city: 'A|999|31' }));
    assert.equal(decoded.city, 'A 999 31');
    assert.equal(decoded.aqi, 395);
  });

  test('test_decodeBase64URL_unpaddedUnicode_restoresText', () => {
    const text = 'हवा ~?>> ok';
    const encoded = encodeBase64URL(text);
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.equal(decodeBase64URL(encoded), text);
  });
});

describe('hostile and corrupted links', () => {
  test('test_hashTokenToContext_v1NumbersAboveRange_areClamped', () => {
    const decoded = hashTokenToContext(v1Hash(['Noida', 5000, 99, 0, 0, 0, 99, 9999, 0]));
    assert.equal(decoded.aqi, 999);
    assert.equal(decoded.vulnBits, 31);
    assert.equal(decoded.simulatedHour, 23.99);
    assert.equal(decoded.commuteKm, 200);
  });

  test('test_hashTokenToContext_v1NegativeNumbers_clampToZero', () => {
    const decoded = hashTokenToContext(v1Hash(['Noida', -5, -1, 0, 0, 0, -3, -20, 0]));
    assert.deepEqual(
      [decoded.aqi, decoded.vulnBits, decoded.simulatedHour, decoded.commuteKm],
      [0, 0, 0, 0]
    );
  });

  test('test_hashTokenToContext_v1NonNumericFields_useDefaults', () => {
    const decoded = hashTokenToContext(v1Hash(['Noida', 'x', 'y', 'z', 'Infinity', '9', 'q', 'NaN', '7']));
    assert.deepEqual(decoded, {
      city: 'Noida',
      aqi: 395,
      vulnBits: 0,
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'two_wheeler',
      simulatedHour: null,
      commuteKm: 14,
      housingType: 'standard_flat'
    });
  });

  test('test_hashTokenToContext_v1MarkupCity_isSanitized', () => {
    const decoded = hashTokenToContext(v1Hash(['<img src=x onerror=alert(1)>', 100, 0, 0, 0, 0]));
    assert.doesNotMatch(decoded.city, /[<>=()"'`]/);
    assert.ok(decoded.city.length <= 50);
  });

  test('test_hashTokenToContext_garbage_neverThrowsAndReturnsPreset', () => {
    for (const hash of ['', '#', '#v1=', '#v1=!!!', '#b=', '#b=!!!', '#b=AA', '#%%%', v1Hash(['only', 'two'])]) {
      const decoded = hashTokenToContext(hash);
      assert.equal(decoded.city, 'Delhi NCR', hash);
      assert.equal(decoded.aqi, 395, hash);
    }
  });

  test('test_hashTokenToContext_corruptedHash_returnsCompleteContext', () => {
    assert.equal(hashTokenToContext('#b=!!!').housingType, 'standard_flat');
  });

  test('test_hashTokenToContext_compactAqiAbove999_isClamped', () => {
    const hash = compactHash([0xFF, 0x03, 0x00, 0x00, 0x00]);
    assert.ok(hashTokenToContext(hash).aqi <= 999, `${hash} decoded aqi ${hashTokenToContext(hash).aqi}`);
  });

  test('test_hashTokenToContext_compactHourAbove23_isClamped', () => {
    const hash = compactHash([100, 0x00, 0x00, 0x00, 31 << 1]);
    const hour = hashTokenToContext(hash).simulatedHour;
    assert.ok(hour <= 23.99, `${hash} decoded hour ${hour}`);
  });

  test('test_hashTokenToContext_compactUnknownCityIndex_fallsBackToDelhi', () => {
    assert.equal(hashTokenToContext(compactHash([100, 0, 0, 0xF0, 0x01])).city, 'Delhi NCR');
  });
});

describe('compact decoder leniency', () => {
  test('test_unpackContextFrom5Bytes_missingOrShortInput_returnsThePreset', () => {
    for (const bytes of [null, undefined, new Uint8Array(0), Uint8Array.from([1, 2, 3, 4])]) {
      assert.deepEqual(unpackContextFrom5Bytes(bytes), PRESET_CONTEXT);
    }
  });

  test('test_hashTokenToContext_shortCompactHash_returnsThePreset', () => {
    for (const bytes of [[], [100], [100, 0, 0, 0]]) {
      assert.deepEqual(hashTokenToContext(compactHash(bytes)), PRESET_CONTEXT, bytes.join(','));
    }
  });

  test('test_hashTokenToContext_invalidBase64_returnsThePreset', () => {
    assert.deepEqual(hashTokenToContext('#b=@@@@@@@'), PRESET_CONTEXT);
  });

  test('test_hashTokenToContext_extraTrailingByte_decodesTheFirstFiveBytes', () => {
    const bytes = [...packContextTo5Bytes({ ...BASE, aqi: 123 }), 0xFF];
    assert.equal(hashTokenToContext(compactHash(bytes)).aqi, 123);
  });

  test('test_hashTokenToContext_parityFlipped_stillDecodesTheFields', () => {
    const bytes = packContextTo5Bytes(BASE);
    bytes[4] ^= 0x40;
    assert.deepEqual(hashTokenToContext(compactHash(bytes)), hashTokenToContext(contextToHashToken(BASE)));
  });
});
