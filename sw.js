/* FINUITY service worker
   Caches only the app shell (this page + the Firebase SDK scripts it loads +
   the manifest/icons) so the app can open with no connection at all.
   It never touches Firestore/Auth network calls — those are left alone so
   cloud sync keeps working normally whenever you do have a connection.

   IMPORTANT: bump the number in CACHE_NAME any time you change index.html,
   manifest.json, or any icon file. This service worker's own byte content
   has to change for the browser to even notice there's an update, and the
   activate handler below only deletes old caches whose name doesn't match
   CACHE_NAME — so an unchanged cache name means old, stale assets (icons
   included) can keep being served indefinitely even after you replace the
   underlying files. */
const CACHE_NAME = 'finuity-shell-v7';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './virtual-pet/pet.css',
  './virtual-pet/pet.js',
  './virtual-pet/pet-dialogue.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    // Cache each file on its own. cache.addAll() is all-or-nothing: one missing icon or a
    // blocked CDN request would silently leave the WHOLE app uncached (no offline mode).
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        cache.add(url).catch(err => console.warn('SW install: could not cache', url, err))
      )))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // never touch writes (Firestore etc.)

  const isShellAsset = APP_SHELL.some(shellUrl => {
    try { return new URL(shellUrl, self.location.href).href === event.request.url; }
    catch (e) { return false; }
  });
  if (!isShellAsset) return; // let every other request (Firestore, Auth, images...) pass through untouched

  // The page itself (index.html / the app's start URL) goes network-first so a
  // pushed update shows up on the very next open instead of needing two opens.
  // Everything else in the shell (icons, manifest, Firebase SDK — rarely change)
  // stays cache-first for an instant, offline-friendly load.
  const isPageRequest = event.request.mode === 'navigate' ||
    event.request.url === new URL('./', self.location.href).href ||
    event.request.url === new URL('./index.html', self.location.href).href;

  if (isPageRequest) {
    event.respondWith(
      // cache:'no-cache' makes the browser revalidate with the server instead of
      // reusing its own HTTP cache. Without it, hosts like GitHub Pages (which send
      // a ~10 minute max-age) can hand back the OLD index.html even though this
      // fetch looks "network-first".
      fetch(event.request, { cache: 'no-cache' }).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request)) // offline: fall back to last cached page
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // offline: fall back to whatever's cached
      return cached || networkFetch; // instant load if cached, background-refreshed for next time
    })
  );
});