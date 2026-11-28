/**
 * @fileoverview Zero-dependency Local Development HTTP Server.
 * Serves static assets with correct MIME types for ES Modules and Service Workers.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8080;
const ROOT = fs.realpathSync.native(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Reports whether a path lies inside the project root and has no hidden segment.
 *
 * @param {string} candidate - Absolute path.
 * @returns {boolean}
 */
function isServable(candidate) {
  const relative = path.relative(ROOT, candidate);
  if (!relative || path.isAbsolute(relative)) return false;
  return !relative.split(path.sep).some((segment) => segment.startsWith('.'));
}

/**
 * Maps a request URL to a file inside the project root. Traversal outside the root and
 * hidden files or directories (such as .git) are refused, including when they are
 * addressed through an alias such as a Windows short name or a symbolic link.
 *
 * @param {string} url - Raw request URL.
 * @returns {string|null} Absolute file path, or null when the request is not allowed.
 */
export function resolveRequestPath(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const segments = pathname.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  const filePath = path.resolve(ROOT, segments.join('/') || 'index.html');
  if (!isServable(filePath)) return null;
  if (!fs.existsSync(filePath)) return filePath;
  const realPath = fs.realpathSync.native(filePath);
  return isServable(realPath) ? realPath : null;
}

const server = http.createServer((req, res) => {
  let filePath = resolveRequestPath(req.url);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'none'"
    });
    res.end(data);
  });
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n======================================================');
  console.log(' CleanAir Guardian (VayuRakshak) — Local Dev Server');
  console.log('======================================================');
  console.log(`\n  🚀 App is running locally at: \x1b[36m${url}\x1b[0m\n`);
  console.log('  Press Ctrl + C to stop the server.\n');

  if (process.env.NO_OPEN) return;

  if (process.platform === 'win32') {
    exec(`start ${url}`);
  } else if (process.platform === 'darwin') {
    exec(`open ${url}`);
  } else {
    exec(`xdg-open ${url}`);
  }
});
