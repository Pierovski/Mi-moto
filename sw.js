const CACHE_NAME = 'mi-moto-n160-cache-v22';
const MAP_TILES_CACHE = 'mi-moto-n160-maptiles-v1';
const MAX_MAP_TILES = 250;

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
  './icono.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        CORE_ASSETS.map((assetUrl) =>
          cache.add(assetUrl).catch((err) => {
            console.warn('[SW] Activo omitido en precarga:', assetUrl, err);
          })
        )
      );
    })
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
  const excess = keys.length - maxItems;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!url.startsWith('http')) return;

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

  // Caché dedicada para teselas del mapa satelital y calles (Stale-While-Revalidate)
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

  // Estrategia Network-First con respaldo inteligente para navegación y atajos PWA
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
      .catch(async () => {
        const directMatch = await caches.match(event.request);
        if (directMatch) return directMatch;

        const ignoreSearchMatch = await caches.match(event.request, { ignoreSearch: true });
        if (ignoreSearchMatch) return ignoreSearchMatch;

        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return undefined;
      })
  );
});
