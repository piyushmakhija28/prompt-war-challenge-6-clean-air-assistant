/**
 * @fileoverview Progressive Web App (PWA) Offline Service Worker.
 * Enforces a Network-First strategy with Cache Fallback for zero-latency updates and 100% offline resilience.
 * Conforms to Level 2.2 Docstrings-Only documentation governance.
 */

const CACHE_NAME = 'cleanair-guardian-v1.2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/css/style.css',
  './src/js/config.js',
  './src/js/air-quality-engine.js',
  './src/js/impact-calculator.js',
  './src/js/cadr-calculator.js',
  './src/js/state-codec.js',
  './src/js/offline-advisor.js',
  './src/js/gemini-service.js',
  './src/js/signals.js',
  './src/js/errors.js',
  './src/js/event-bus.js',
  './src/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html') || caches.match('./');
            }
            return new Response('Offline resource unavailable', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
