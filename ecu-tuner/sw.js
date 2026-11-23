// Offline cache so the installed app opens without internet
const CACHE = 'sm-remap-v15';
const FILES = ['./', 'index.html', 'js/honda.js', 'js/link.js', 'js/app.js', 'js/mapfinder.js', 'js/autotune.js', 'js/dyno.js', 'js/xdf.js', 'js/catalog.js', 'js/tools.js', 'js/quicktune.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// network first (always newest version when online), cache as fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
