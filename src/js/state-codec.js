/**
 * @fileoverview High-density binary bitstream state codec and RFC 4648 Base64URL encoder/decoder.
 * Encodes all 7 household lifestyle parameters into exactly 40 bits (5 bytes), producing an ultra-compact
 * 7-character URL hash for instant state restoration and clean messaging previews.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 * @module state-codec
 */

import { METRO_BASIN_PRESETS } from './config.js';
import { InvalidStateHashError } from './errors.js';

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

  const cookingMethods = ['induction', 'png', 'lpg', 'biomass'];
  const heatingMethods = ['electric_radiator', 'space_heater', 'heat_pump', 'open_fire'];
  const commuteModes = ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car'];

  const city = (cityIdx >= 0 && cityIdx < METRO_BASIN_PRESETS.length)
    ? METRO_BASIN_PRESETS[cityIdx]
    : 'Delhi NCR';

  return {
    city,
    aqi,
    vulnBits,
    cookingMethod: cookingMethods[cookIdx] || 'lpg',
    heatingMethod: heatingMethods[heatIdx] || 'space_heater',
    commuteMode: commuteModes[commuteIdx] || 'two_wheeler',
    commuteKm,
    simulatedHour: simHour === 0 ? null : simHour
  };
}

/**
 * Serializes context into a 7-character Base64URL hash token.
 * @param {Object} ctx - Context object.
 * @returns {string} 7-character Base64URL string (prefixed with 'b=').
 */
export function contextToHashToken(ctx) {
  const bytes = packContextTo5Bytes(ctx);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return 'b=' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Parses context from a Base64URL hash token.
 * @param {string} hash - URL hash string (e.g. '#b=A3fZ9qA' or 'b=A3fZ9qA').
 * @returns {Object} Reconstructed context object.
 */
export function hashTokenToContext(hash) {
  let clean = String(hash).replace(/^#/, '');

  if (clean.startsWith('v1=')) {
    try {
      const rawStr = decodeBase64URL(clean.slice(3));
      const parts = rawStr.split('|');
      if (parts.length >= 6) {
        const city = parts[0];
        const aqi = Number(parts[1]) || 395;
        const vulnBits = Number(parts[2]) || 0;
        const cookIdx = Number(parts[3]) || 2;
        const heatIdx = Number(parts[4]) || 1;
        const commuteIdx = Number(parts[5]) || 1;
        const simHour = parts[6] !== undefined && parts[6] !== '' ? Number(parts[6]) : null;
        const cookingMethods = ['induction', 'png', 'lpg', 'biomass'];
        const heatingMethods = ['electric_radiator', 'space_heater', 'heat_pump', 'open_fire'];
        const commuteModes = ['walk_cycle', 'two_wheeler', 'public_transit', 'private_car'];
        return {
          city: city || 'Delhi NCR',
          aqi,
          vulnBits,
          cookingMethod: cookingMethods[cookIdx] || 'lpg',
          heatingMethod: heatingMethods[heatIdx] || 'space_heater',
          commuteMode: commuteModes[commuteIdx] || 'two_wheeler',
          commuteKm: 14,
          simulatedHour: simHour
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
  let clean = String(hash).replace(/^#/, '');
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
