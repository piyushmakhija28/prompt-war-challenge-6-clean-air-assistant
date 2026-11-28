/**
 * @fileoverview The real server.js started as a child process and exercised with raw TCP
 * requests, so that request targets reach the server exactly as written: static assets and
 * MIME types, response headers, fallback, traversal and hidden path refusal.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = '127.0.0.1';
let child;
let port;

/**
 * Asks the operating system for an unused port.
 *
 * @returns {Promise<number>}
 */
async function freePort() {
  const probe = net.createServer();
  probe.listen(0, HOST);
  await once(probe, 'listening');
  const { port: chosen } = probe.address();
  probe.close();
  await once(probe, 'close');
  return chosen;
}

/**
 * Sends one request line verbatim and collects the whole reply.
 *
 * @param {string} target - Request target, sent without normalisation.
 * @param {string} [method] - HTTP method.
 * @returns {Promise<{status: number, headers: Object<string, string>, body: Buffer}>}
 */
function rawRequest(target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: HOST, port });
    const chunks = [];
    socket.setTimeout(5000, () => socket.destroy(new Error(`No reply for ${target}`)));
    socket.on('connect', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const raw = Buffer.concat(chunks);
      const split = raw.indexOf('\r\n\r\n');
      if (split < 0) {
        reject(new Error(`Incomplete reply for ${target}`));
        return;
      }
      const [statusLine, ...headerLines] = raw.subarray(0, split).toString('latin1').split('\r\n');
      const headers = Object.fromEntries(headerLines.map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
      }));
      let body = raw.subarray(split + 4);
      if (headers['transfer-encoding'] === 'chunked') body = decodeChunks(body);
      resolve({ status: Number(statusLine.split(' ')[1]), headers, body });
    });
  });
}

/**
 * Decodes a chunked transfer body.
 *
 * @param {Buffer} raw - Chunked payload.
 * @returns {Buffer} Decoded payload.
 */
function decodeChunks(raw) {
  const parts = [];
  let offset = 0;
  while (offset < raw.length) {
    const end = raw.indexOf('\r\n', offset);
    const size = parseInt(raw.subarray(offset, end).toString('latin1'), 16);
    if (!size) break;
    parts.push(raw.subarray(end + 2, end + 2 + size));
    offset = end + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/**
 * Reads a project file.
 *
 * @param {string} relative - Path from the project root.
 * @returns {Buffer}
 */
function projectFile(relative) {
  return fs.readFileSync(path.join(ROOT, relative));
}

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
    const done = (settleWith, value) => {
      clearTimeout(deadline);
      settleWith(value);
    };
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Press Ctrl + C')) done(resolve);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('exit', (code) => done(reject, new Error(`Server exited with ${code}: ${output}`)));
  });
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});

describe('static assets', () => {
  const assets = [
    ['/', 'index.html', 'text/html; charset=UTF-8'],
    ['/index.html', 'index.html', 'text/html; charset=UTF-8'],
    ['/index.html?utm=1#b=abc', 'index.html', 'text/html; charset=UTF-8'],
    ['/sw.js', 'sw.js', 'application/javascript; charset=UTF-8'],
    ['/src/css/style.css', 'src/css/style.css', 'text/css; charset=UTF-8'],
    ['/src/js/app.js?v=3.0.0', 'src/js/app.js', 'application/javascript; charset=UTF-8'],
    ['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json; charset=UTF-8'],
    ['/package.json', 'package.json', 'application/json; charset=UTF-8'],
    ['/test/screenshots/ui-ux-browser-verification.png', 'test/screenshots/ui-ux-browser-verification.png', 'image/png'],
    ['/VERSION', 'VERSION', 'application/octet-stream'],
    ['/src/%6As/config.js', 'src/js/config.js', 'application/javascript; charset=UTF-8']
  ];

  for (const [target, file, type] of assets) {
    it(`serves ${target} byte for byte as ${type}`, async () => {
      const response = await rawRequest(target);

      assert.equal(response.status, 200);
      assert.equal(response.headers['content-type'], type);
      assert.ok(response.body.equals(projectFile(file)));
    });
  }

  it('serves every ES module as JavaScript', async () => {
    const modules = fs.readdirSync(path.join(ROOT, 'src', 'js')).filter((name) => name.endsWith('.js'));
    assert.ok(modules.length >= 10);
    for (const name of modules) {
      const response = await rawRequest(`/src/js/${name}`);
      assert.equal(response.headers['content-type'], 'application/javascript; charset=UTF-8', name);
      assert.ok(response.body.equals(projectFile(`src/js/${name}`)), name);
    }
  });

  it('serves every service worker precache entry as a real file with a matching type', async () => {
    const source = projectFile('sw.js').toString('utf8');
    const block = /STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/.exec(source)[1];
    const entries = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
    assert.ok(entries.length >= 10);

    for (const entry of entries) {
      const relative = entry.replace(/^\.\//, '') || 'index.html';
      assert.ok(fs.existsSync(path.join(ROOT, relative)), `${entry} is missing on disk`);
      const response = await rawRequest(`/${relative}`);
      assert.equal(response.status, 200, entry);
      assert.ok(response.headers['content-type'].startsWith(types[path.extname(relative)]), entry);
      assert.ok(response.body.equals(projectFile(relative)), entry);
    }
  });

  it('sends the hardening headers with every file', async () => {
    for (const target of ['/', '/src/js/app.js', '/sw.js']) {
      const { headers } = await rawRequest(target);
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['content-security-policy'], "frame-ancestors 'none'");
      assert.equal(headers['cache-control'], 'no-cache, no-store, must-revalidate');
    }
  });

  for (const target of ['/no/such/page', '/src', '/src/js/', '/shared/link']) {
    it(`falls back to the app shell for ${target}`, async () => {
      const response = await rawRequest(target);

      assert.equal(response.status, 200);
      assert.equal(response.headers['content-type'], 'text/html; charset=UTF-8');
      assert.ok(response.body.equals(projectFile('index.html')));
    });
  }
});

describe('refused paths', () => {
  const refused = [
    '/..',
    '/../server.js',
    '/../../../../../../etc/passwd',
    '/src/../../outside.txt',
    '/src/js/../../server.js',
    '/%2e%2e/server.js',
    '/%2E%2E%2F%2E%2E%2Fwindows%2Fwin.ini',
    '/..%2f..%2fwindows%2fwin.ini',
    '/..%5c..%5cwindows%5cwin.ini',
    '/..\\..\\windows\\win.ini',
    '/src\\..\\..\\server.js',
    '/.git/config',
    '/.git/HEAD',
    '/.gitignore',
    '/.github/workflows/ci.yml',
    '/%2egit/config',
    '/%2E%67it/config',
    '/src/.env',
    '/.env',
    '/.git%2fconfig',
    '/.git%5cconfig',
    '/.git::$INDEX_ALLOCATION/config',
    '/index.html%00.png',
    '/%',
    '/%zz',
    '/%c0%ae%c0%ae/server.js'
  ];

  for (const target of refused) {
    it(`answers 403 to ${target}`, async () => {
      const response = await rawRequest(target);

      assert.equal(response.status, 403);
      assert.equal(response.body.toString('utf8'), '403 Forbidden');
    });
  }

  it('refuses an absolute drive path outside the project', { skip: process.platform !== 'win32' }, async () => {
    for (const target of ['/C:/Windows/win.ini', '/C:%5CWindows%5Cwin.ini', '/D:/secret.txt']) {
      assert.equal((await rawRequest(target)).status, 403, target);
    }
  });

  const neverOutside = [
    '//etc/passwd',
    '/%252e%252e/server.js',
    '////server/share/file',
    '/NUL',
    '/CON',
    '/src/AUX.js',
    `/${'a'.repeat(4000)}`
  ];

  for (const target of neverOutside) {
    it(`stays inside the project for ${target.slice(0, 40)}`, async () => {
      const response = await rawRequest(target);

      assert.ok([200, 403, 404].includes(response.status));
      if (response.status === 200) assert.ok(response.body.equals(projectFile('index.html')));
    });
  }

  const hidden = [
    ['.git', 'config'],
    ['.git', 'HEAD'],
    ['.gitignore'],
    ['.github', 'workflows', 'ci.yml'],
    ['.nojekyll']
  ];

  for (const segments of hidden) {
    const [directory, ...rest] = segments;
    const stem = directory.slice(1).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
    const alias = [1, 2, 3, 4]
      .map((index) => `${stem}~${index}`)
      .find((candidate) => {
        const aliased = path.join(ROOT, candidate, ...rest);
        const real = path.join(ROOT, ...segments);
        return fs.existsSync(aliased) && fs.existsSync(real) && fs.statSync(aliased).ino === fs.statSync(real).ino;
      });
    const name = `does not expose ${segments.join('/')} through its Windows short name`;
    it(name, { skip: alias ? false : 'no 8.3 short name on this volume' }, async () => {
      const target = `/${[alias, ...rest].join('/')}`;
      const response = await rawRequest(target);
      const secret = projectFile(segments.join('/'));

      assert.ok(!(response.status === 200 && response.body.equals(secret)),
        `GET ${target} returned the contents of hidden ${segments.join('/')} (status ${response.status})`);
    });
  }

  it('is still serving after the hostile requests', async () => {
    assert.equal((await rawRequest('/index.html')).status, 200);
    assert.equal(child.exitCode, null);
  });
});
