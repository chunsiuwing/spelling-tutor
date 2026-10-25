/* SpellCoach service worker — shell is precached, everything else is
 * cached on first use.  Bump VERSION on every edit to index.html,
 * style.css or js/*.  (Forgetting this is what kept stale CSS alive
 * in the last project.) */

var VERSION = 'spellcoach-v5';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/lingo.js',
  './js/words.js',
  './js/speech.js',
  './js/camera.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './vendor/pdf/pdf.min.js',
  './vendor/pdf/pdf.worker.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* no-cache: bypass the HTTP cache so we never copy stale bytes */
      return Promise.all(SHELL.map(function (u) {
        return fetch(u, { cache: 'no-cache' })
          .then(function (r) { if (r && r.ok) return cache.put(u, r); })
          .catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Navigations: network first, so a republished site is picked up,
   * falling back to the cached shell when offline. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put('./index.html', copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  /* Everything else: cache first, then network (and cache the result). */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});
