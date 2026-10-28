const CACHE_NAME = 'mi-moto-n160-cache-v17.0';
const MAP_TILES_CACHE = 'mi-moto-n160-maptiles-v1';
const MAX_MAP_TILES = 120;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './constants.js',
  './firebase.js',
  './state.js',
  './telemetry.js',
  './obd.js',
  './ui.js',
  './app.js',
  './manifest.json',
  './icono.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== MAP_TILES_CACHE) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!url.startsWith('http')) return;

  // 1. Excluir APIs dinámicas (Firebase, OSRM Routing, Nominatim Search, Open-Meteo DEM)
  if (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('identitytoolkit') ||
    url.includes('router.project-osrm.org') ||
    url.includes('nominatim.openstreetmap.org') ||
    url.includes('api.open-meteo.com')
  ) {
    return;
  }

  // 2. Aislar Tiles de Mapas Satelitales y Calles en caché rotativo con límite (FIFO)
  if (
    url.includes('arcgisonline.com') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('basemaps.cartocdn.com')
  ) {
    event.respondWith(
      caches.open(MAP_TILES_CACHE).then((cache) =>
        cache.match(event.request).then((cachedResp) => {
          const fetchPromise = fetch(event.request)
            .then((netResp) => {
              if (netResp && netResp.status === 200) {
                cache.put(event.request, netResp.clone());
                trimCache(MAP_TILES_CACHE, MAX_MAP_TILES);
              }
              return netResp;
            })
            .catch(() => cachedResp);
          return cachedResp || fetchPromise;
        })
      )
    );
    return;
  }

  // 3. Estrategia Network-First para el código núcleo de la aplicación
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
