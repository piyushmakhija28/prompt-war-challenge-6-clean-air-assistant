/**
 * @fileoverview Unit tests for resolveRequestPath in server.js.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRequestPath } from '../../server.js';

const ROOT = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

describe('resolveRequestPath', () => {
  test('test_import_serverModule_doesNotListen', async () => {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process.getActiveResourcesInfo().includes('TCPServerWrap'), false);
  });

  test('test_resolveRequestPath_rootAndEmpty_mapToIndex', () => {
    for (const url of ['/', '', '//', '/?a=1', '/#b=AAAAAAA']) {
      assert.equal(resolveRequestPath(url), path.join(ROOT, 'index.html'), JSON.stringify(url));
    }
  });

  test('test_resolveRequestPath_assetWithQueryAndHash_mapsInsideRoot', () => {
    assert.equal(resolveRequestPath('/src/js/app.js?v=2#x'), path.join(ROOT, 'src', 'js', 'app.js'));
    assert.equal(resolveRequestPath('/src%2Fcss%2Fstyle.css'), path.join(ROOT, 'src', 'css', 'style.css'));
  });

  for (const url of [
    '/..', '/../secret', '/src/../../secret', '/%2e%2e/secret', '/%2E%2E%2Fsecret', '/..%5c..%5csecret',
    '/..\\..\\secret', '/src/%2e%2e%2f%2e%2e%2fsecret', '/.git/config', '/%2egit/config', '/.env',
    '/src/.hidden', '/.github/workflows/ci.yml', '/src%5c.git', '/index.html%00.png', '/%', '/%zz', '/%c0%ae'
  ]) {
    test(`test_resolveRequestPath_${url}_isRefused`, () => {
      assert.equal(resolveRequestPath(url), null);
    });
  }

  test('test_resolveRequestPath_absoluteAndDoubleEncodedInputs_neverEscapeRoot', () => {
    for (const url of ['//etc/passwd', '/C:/Windows/win.ini', '/C:', '//server/share/file', '/%252e%252e/secret', 'etc/passwd']) {
      const resolved = resolveRequestPath(url);
      assert.ok(resolved === null || resolved.startsWith(ROOT + path.sep), `${url} -> ${resolved}`);
    }
  });

  test('test_resolveRequestPath_windowsShortNameOfHiddenDirectory_isRefused', (t) => {
    const alias = path.join(ROOT, 'GIT~1');
    if (!fs.existsSync(alias) || !path.basename(fs.realpathSync.native(alias)).startsWith('.')) {
      t.skip('This volume has no 8.3 alias for a hidden directory (checked 2026-11-28)');
      return;
    }
    assert.equal(resolveRequestPath('/GIT~1/config'), null);
  });
});
