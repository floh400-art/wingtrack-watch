const V = 'wingtrack-v31';
const SHELL = ['./', 'index.html', 'app.js', 'stats.js', 'manifest.webmanifest', 'icon-192.png', 'meteo.js', 'carnet.js', 'wmap.js', 'replay.js', 'spots.js', 'shore.js', 'fieldlayer.js', 'spotcanvas.js', 'stations.js', 'carte.js', 'osmworker.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = e.request.url;
  if (e.request.method !== 'GET') return;
  if (/tile\.openstreetmap\.org|arcgisonline\.com/.test(u)) {
    // tuiles : réseau d'abord, cache en secours (utile au spot sans réseau si la zone a déjà été vue)
    e.respondWith(fetch(e.request).then(r => { const cl = r.clone(); caches.open('tiles').then(c => c.put(e.request, cl)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (new URL(u).origin === location.origin) {
    // fichiers de l'appli : réseau d'abord (mises à jour immédiates), cache si pas de réseau
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(V).then(c => c.put(e.request, cl)); } return res; })
      .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
