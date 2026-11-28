/**
 * @fileoverview Reverse geocoding provider fallback.
 * @module test/unit/reverse-geocode
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseGeocodeNominatim } from '../../src/js/app.js';

test('test_reverseGeocode_firstProviderTimesOut_usesSecondProvider', async (t) => {
  const hosts = [];
  t.mock.method(globalThis, 'fetch', (url, { signal }) => {
    const { hostname } = new URL(url);
    hosts.push(hostname);
    if (hostname === 'api.bigdatacloud.net') {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')));
      });
    }
    if (signal.aborted) return Promise.reject(new DOMException('already aborted', 'AbortError'));
    return Promise.resolve(Response.json({ address: { suburb: 'Karol Bagh', city: 'New Delhi' } }));
  });

  const name = await reverseGeocodeNominatim(11.11, 22.22, 20);

  assert.equal(name, 'Karol Bagh, New Delhi');
  assert.deepEqual(hosts, ['api.bigdatacloud.net', 'nominatim.openstreetmap.org']);
});
