/**
 * @fileoverview High-density binary bitstream state codec and RFC 4648 Base64URL encoder/decoder.
 * Encodes all 7 household lifestyle parameters into exactly 40 bits (5 bytes), producing an ultra-compact
 * 7-character URL hash for instant state restoration and clean messaging previews.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module state-codec
 */

import { METRO_BASIN_PRESETS, sanitizeCityInput } from './config.js';
import { InvalidStateHashError } from './errors.js';

const COOKING_METHODS = Object.freeze(['induction', 'png', 'lpg', 'biomass']);
const HEATING_METHODS = Object.freeze(['electric_radiator', 'space_heater', 'heat_pump', 'open_fire']);
const COMMUTE_MODES = Object.freeze(['walk_cycle', 'two_wheeler', 'public_transit', 'private_car']);
const HOUSING_TYPES = Object.freeze(['standard_flat', 'sealed_apartment', 'drafty_home']);

/**
 * Reads an optional numeric payload field, keeping legitimate zero values.
 *
 * @param {string|undefined} raw - Field text from the payload.
 * @param {number|null} fallback - Value used when the field is absent or not numeric.
 * @returns {number|null} Parsed number or the fallback.
 */
function numberOr(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Restricts a decoded number to its physical range, since links are untrusted input.
 *
 * @param {number} value - Decoded value.
 * @param {number} max - Upper bound.
 * @returns {number} Value within 0 and max.
 */
function clamp(value, max) {
  return Math.max(0, Math.min(max, value));
}

/**
 * Reports whether every field of a context survives the 40-bit compact layout.
 * The layout has no housing field, floors the hour, reserves hour 0 for "unset"
 * and caps distance at 127 km.
 *
 * @param {Object} ctx - Context object.
 * @returns {boolean} True when the compact token is lossless.
 */
function fitsCompactLayout(ctx) {
  const hour = ctx.simulatedHour;
  const km = Number(ctx.commuteKm) || 0;
  return METRO_BASIN_PRESETS.includes(ctx.city) &&
    (!ctx.housingType || ctx.housingType === 'standard_flat') &&
    (hour === null || hour === undefined || (Number.isInteger(Number(hour)) && Number(hour) > 0)) &&
    Number.isInteger(km) && km >= 0 && km <= 127;
}

/**
 * Encodes an arbitrary UTF-8 string into URL-safe Base64URL (RFC 4648 §5) with padding stripped.
 * Complexity: O(M) time, O(M) space where M is string length.
 *
 * @param {string} str - Raw input string.
 * @returns {string} URL-safe Base64URL string without '+', '/', or '=' characters.
 */
export function encodeBase64URL(str) {
  const b64 = btoa(unescape(encodeURIComponent(String(str))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a URL-safe Base64URL string back to standard UTF-8 string.
 * Automatically restores trailing '=' padding if missing.
 * Complexity: O(M) time, O(M) space.
 *
 * @param {string} b64url - Base64URL string.
 * @returns {string} Decoded original string.
 */
export function decodeBase64URL(b64url) {
  let b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Packs 7 household lifestyle parameters into a compact 5-byte (40-bit) Uint8Array.
 * Bit Allocation:
 * - Bits 0-9   (10 bits): AQI (0 to 1023)
 * - Bits 10-14 (5 bits) : Vulnerability Bitmask (0 to 31)
 * - Bits 15-16 (2 bits) : Cooking Index (0 to 3)
 * - Bits 17-18 (2 bits) : Heating Index (0 to 3)
 * - Bits 19-20 (2 bits) : Commute Index (0 to 3)
 * - Bits 21-27 (7 bits) : Commute Distance (0 to 127 km)
 * - Bits 28-32 (5 bits) : City Basin ID (0 to 31)
 * - Bits 33-37 (5 bits) : Simulated Hour (0 to 23)
 * - Bits 38-39 (2 bits) : Parity Check
 *
 * Complexity: O(1) time, O(1) space.
 *
 * @param {Object} ctx - Household context object.
 * @returns {Uint8Array} Exactly 5 bytes of packed binary state.
 */
export function packContextTo5Bytes(ctx) {
  const bytes = new Uint8Array(5);
  const aqi = Math.max(0, Math.min(1023, Math.round(Number(ctx.aqi) || 0)));
  const vuln = Math.max(0, Math.min(31, Number(ctx.vulnBits) || 0));

  let cookIdx = 2; // default lpg
  if (ctx.cookingMethod === 'induction') cookIdx = 0;
  else if (ctx.cookingMethod === 'png') cookIdx = 1;
  else if (ctx.cookingMethod === 'biomass') cookIdx = 3;

  let heatIdx = 1; // default space_heater
  if (ctx.heatingMethod === 'electric_radiator') heatIdx = 0;
  else if (ctx.heatingMethod === 'heat_pump') heatIdx = 2;
  else if (ctx.heatingMethod === 'open_fire') heatIdx = 3;

  let commuteIdx = 1; // default two_wheeler
  if (ctx.commuteMode === 'walk_cycle') commuteIdx = 0;
  else if (ctx.commuteMode === 'public_transit') commuteIdx = 2;
  else if (ctx.commuteMode === 'private_car') commuteIdx = 3;

  const distanceKm = Math.max(0, Math.min(127, Math.round(Number(ctx.commuteKm) || 0)));

  let cityIdx = METRO_BASIN_PRESETS.indexOf(ctx.city);
  if (cityIdx < 0 && ctx.nearestBasin && ctx.nearestBasin.name) {
    cityIdx = METRO_BASIN_PRESETS.indexOf(ctx.nearestBasin.name);
  }
  if (cityIdx < 0) cityIdx = 0;

  const simHour = ctx.simulatedHour !== null && ctx.simulatedHour !== undefined
    ? Math.max(0, Math.min(23, Math.floor(Number(ctx.simulatedHour))))
    : 0;

  // Byte 0: AQI bits 0-7
  bytes[0] = aqi & 0xFF;

  // Byte 1: AQI bits 8-9 (2 bits) | Vuln bits 0-4 (5 bits) | Cook bit 0 (1 bit)
  bytes[1] = ((aqi >> 8) & 0x03) | ((vuln & 0x1F) << 2) | ((cookIdx & 0x01) << 7);

  // Byte 2: Cook bit 1 (1 bit) | Heat (2 bits) | Commute (2 bits) | Dist bits 0-2 (3 bits)
  bytes[2] = ((cookIdx >> 1) & 0x01) | ((heatIdx & 0x03) << 1) | ((commuteIdx & 0x03) << 3) | ((distanceKm & 0x07) << 5);

  // Byte 3: Dist bits 3-6 (4 bits) | City bits 0-3 (4 bits)
  bytes[3] = ((distanceKm >> 3) & 0x0F) | ((cityIdx & 0x0F) << 4);

  // Byte 4: City bit 4 (1 bit) | SimHour (5 bits) | Parity (2 bits)
  const parity = (bytes[0] ^ bytes[1] ^ bytes[2] ^ bytes[3]) & 0x03;
  bytes[4] = ((cityIdx >> 4) & 0x01) | ((simHour & 0x1F) << 1) | ((parity & 0x03) << 6);

  return bytes;
}

/**
 * Unpacks 5-byte (40-bit) Uint8Array into a structured household lifestyle context object.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {Uint8Array} bytes - 5-byte array.
 * @returns {Object} Reconstructed context object.
 */
export function unpackContextFrom5Bytes(bytes) {
  if (!bytes || bytes.length < 5) {
    return {
      city: 'Delhi NCR',
      aqi: 395,
      vulnBits: 3,
      cookingMethod: 'lpg',
      heatingMethod: 'space_heater',
      commuteMode: 'two_wheeler',
      commuteKm: 14,
      housingType: 'standard_flat',
      simulatedHour: null
    };
  }

  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  const b4 = bytes[4];

  const aqi = b0 | ((b1 & 0x03) << 8);
  const vulnBits = (b1 >> 2) & 0x1F;
  const cookIdx = ((b1 >> 7) & 0x01) | ((b2 & 0x01) << 1);
  const heatIdx = (b2 >> 1) & 0x03;
  const commuteIdx = (b2 >> 3) & 0x03;
  const commuteKm = ((b2 >> 5) & 0x07) | ((b3 & 0x0F) << 3);
  const cityIdx = ((b3 >> 4) & 0x0F) | ((b4 & 0x01) << 4);
  const simHour = (b4 >> 1) & 0x1F;

  const city = (cityIdx >= 0 && cityIdx < METRO_BASIN_PRESETS.length)
    ? METRO_BASIN_PRESETS[cityIdx]
    : 'Delhi NCR';

  return {
    city,
    aqi: clamp(aqi, 999),
    vulnBits,
    housingType: 'standard_flat',
    cookingMethod: COOKING_METHODS[cookIdx] || 'lpg',
    heatingMethod: HEATING_METHODS[heatIdx] || 'space_heater',
    commuteMode: COMMUTE_MODES[commuteIdx] || 'two_wheeler',
    commuteKm,
    simulatedHour: simHour === 0 ? null : clamp(simHour, 23)
  };
}

/**
 * Serializes context into an efficient URL hash token.
 * Uses the compact 7-character Base64URL string (prefixed with 'b=') whenever it is
 * lossless, and the 'v1=' Base64URL string otherwise.
 *
 * @param {Object} ctx - Context object.
 * @returns {string} URL hash token string.
 */
export function contextToHashToken(ctx) {
  if (fitsCompactLayout(ctx)) {
    const bytes = packContextTo5Bytes(ctx);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    return 'b=' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const cookIdx = COOKING_METHODS.indexOf(ctx.cookingMethod);
  const heatIdx = HEATING_METHODS.indexOf(ctx.heatingMethod);
  const commuteIdx = COMMUTE_MODES.indexOf(ctx.commuteMode);
  const housingIdx = HOUSING_TYPES.indexOf(ctx.housingType);
  const simHour = ctx.simulatedHour !== null && ctx.simulatedHour !== undefined ? ctx.simulatedHour : '';

  const payload = [
    String(ctx.city).replace(/\|/g, ' '),
    ctx.aqi,
    ctx.vulnBits,
    cookIdx >= 0 ? cookIdx : 2,
    heatIdx >= 0 ? heatIdx : 1,
    commuteIdx >= 0 ? commuteIdx : 1,
    simHour,
    ctx.commuteKm ?? 14,
    housingIdx >= 0 ? housingIdx : 0
  ].join('|');

  return 'v1=' + encodeBase64URL(payload);
}

/**
 * Parses context from a Base64URL hash token.
 * @param {string} hash - URL hash string (e.g. '#b=A3fZ9qA' or 'b=A3fZ9qA').
 * @returns {Object} Reconstructed context object.
 */
export function hashTokenToContext(hash) {
  let clean = String(hash).replace(/^#/, '').split('&')[0];

  if (clean.startsWith('v1=')) {
    try {
      const rawStr = decodeBase64URL(clean.slice(3));
      const parts = rawStr.split('|');
      if (parts.length >= 6) {
        return {
          city: sanitizeCityInput(parts[0]),
          aqi: clamp(numberOr(parts[1], 395), 999),
          vulnBits: clamp(Math.trunc(numberOr(parts[2], 0)), 31),
          cookingMethod: COOKING_METHODS[numberOr(parts[3], 2)] || 'lpg',
          heatingMethod: HEATING_METHODS[numberOr(parts[4], 1)] || 'space_heater',
          commuteMode: COMMUTE_MODES[numberOr(parts[5], 1)] || 'two_wheeler',
          simulatedHour: numberOr(parts[6], null) === null ? null : clamp(numberOr(parts[6], 0), 23.99),
          commuteKm: clamp(numberOr(parts[7], 14), 200),
          housingType: HOUSING_TYPES[numberOr(parts[8], 0)] || 'standard_flat'
        };
      }
    } catch (e) {
      // Fall through to 5-byte unpacking
    }
  }

  if (clean.startsWith('b=')) {
    clean = clean.slice(2);
  }
  let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }

  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return unpackContextFrom5Bytes(bytes);
  } catch (e) {
    return unpackContextFrom5Bytes(null);
  }
}

/**
 * Strictly decodes and validates a Base64URL hash token, validating 5-byte length and parity checksum.
 * Throws InvalidStateHashError if corrupted, truncated, or tampered.
 * Complexity: O(1) time, O(1) space.
 *
 * @param {string} hash - URL hash string.
 * @returns {Object} Validated context object.
 * @throws {InvalidStateHashError} If hash is malformed, length != 5 bytes, or parity checksum fails.
 */
export function hashTokenToContextStrict(hash) {
  let clean = String(hash).replace(/^#/, '').split('&')[0];
  if (clean.startsWith('b=')) {
    clean = clean.slice(2);
  }
  let b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }

  let binary;
  try {
    binary = atob(b64);
  } catch (err) {
    throw new InvalidStateHashError(`Base64 decode failed: ${err.message}`);
  }

  if (binary.length !== 5) {
    throw new InvalidStateHashError(`Invalid bitstream length: expected 5 bytes, got ${binary.length}`);
  }

  const bytes = new Uint8Array(5);
  for (let i = 0; i < 5; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const expectedParity = (bytes[0] ^ bytes[1] ^ bytes[2] ^ bytes[3]) & 0x03;
  const actualParity = (bytes[4] >> 6) & 0x03;
  if (expectedParity !== actualParity) {
    throw new InvalidStateHashError('Bitstream checksum parity mismatch');
  }

  return unpackContextFrom5Bytes(bytes);
}
