const CACHE_NAME = 'hyper-calc-cache-v5';

// Core assets to cache immediately on installation (App Shell)
const PRECACHE_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'screenshot-mobile.png',
  'screenshot-desktop.png',
  'chart.umd.min.js',
  'jspdf.umd.min.js'
];

// On install, open cache and pre-cache all core assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Precaching App Shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .catch(err => {
        console.error('[Service Worker] Precaching failed:', err);
      })
  );
});

// On activation, clean up any old caches and take control of clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Advanced fetch interception with specific offline strategies
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle external exchange rate API calls (Network-First, with fallback)
  if (requestUrl.hostname.includes('api.exchangerate-api.com')) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If not cached, let index.html's localStorage fallbacks handle it
              return new Response(JSON.stringify({ error: 'Network offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              });
            });
        })
    );
    return;
  }

  // Stale-While-Revalidate for app shell files and same-origin assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(err => {
          console.log('[Service Worker] Fetch failed (offline):', err);
        });

      // Return the cached response immediately if available, otherwise wait for the network fetch
      return cachedResponse || fetchPromise;
    })
  );
});
