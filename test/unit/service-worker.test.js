/**
 * @fileoverview Precache contract of the service worker: every listed asset exists, and
 * every application module is listed so that the app starts offline.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const source = fs.readFileSync(new URL('sw.js', ROOT), 'utf8');
const precached = [...source.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
  .map((match) => match[1]);

describe('service worker precache', () => {
  test('test_staticAssets_everyEntry_existsInTheRepository', () => {
    assert.ok(precached.length > 0);
    const missing = precached.filter((asset) => !fs.existsSync(new URL(asset, ROOT)));
    assert.deepEqual(missing, []);
  });

  test('test_staticAssets_applicationModules_matchTheSourceFolderExactly', () => {
    const modules = fs.readdirSync(new URL('src/js/', ROOT))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `./src/js/${name}`);
    assert.deepEqual(precached.filter((asset) => asset.startsWith('./src/js/')).sort(), modules.sort());
  });

  test('test_cacheName_currentRelease_isVersion1Point5', () => {
    assert.match(source, /const CACHE_NAME = 'cleanair-guardian-v1\.5';/);
  });
});
