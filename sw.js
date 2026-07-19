const CACHE_NAME = 'hyper-calc-cache-v8';
const STATIC_ASSETS_CACHE = 'hyper-calc-static-v8';

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
    caches.open(STATIC_ASSETS_CACHE)
      .then(cache => {
        console.log('[SW] Precaching App Shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .catch(err => {
        console.error('[SW] Precaching failed:', err);
      })
  );
});

// On activation, clean up old caches and take control
self.addEventListener('activate', event => {
  const validCaches = [STATIC_ASSETS_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!validCaches.includes(cacheName) && cacheName.startsWith('hyper-calc-')) {
            console.log('[SW] Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch interception with specific offline strategies
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Only handle http/https requests (prevents crashes from chrome-extension or data URLs)
  if (!requestUrl.protocol.startsWith('http')) {
    return;
  }

  // Handle navigation requests: serve cached index.html immediately (Cache-First)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html')
        .then(cachedPage => {
          if (cachedPage) {
            // Serve from cache immediately, then update in background
            const fetchPromise = fetch(event.request)
              .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                  const clone = networkResponse.clone();
                  caches.open(STATIC_ASSETS_CACHE).then(cache => {
                    cache.put('index.html', clone);
                  });
                }
                return networkResponse;
              })
              .catch(() => cachedPage);
            return cachedPage;
          }
          // No cached page, try network
          return fetch(event.request).catch(() => {
            // If offline and no cache, return a minimal offline page
            return new Response(
              '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline - Hyper Calc</title><style>body{background:#0d0d1a;color:#eaeaff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px}div{max-width:400px}h1{color:#f0a030}button{background:#f0a030;color:#0d0d1a;border:none;padding:12px 30px;border-radius:30px;font-size:1rem;font-weight:700;cursor:pointer;margin-top:16px}</style></head><body><div><h1>⚡ Hyper Calc</h1><p style="opacity:0.8;margin:12px 0">You are offline. The calculator tools are still available once the app loads.</p><button onclick="window.location.reload()">Try Again</button></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // Handle external exchange rate API calls (Network-First, with cache and localStorage fallback)
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
              // Let index.html's localStorage/hardcoded fallbacks handle it
              return new Response(JSON.stringify({ error: 'Network offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              });
            });
        })
    );
    return;
  }

  // Only handle same-origin requests
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  // Cache-First for app shell assets, Network-First for everything else
  const isAppShell = PRECACHE_ASSETS.some(asset => {
    const assetPath = asset.startsWith('./') ? asset.slice(2) : asset;
    return requestUrl.pathname.endsWith('/' + assetPath) || requestUrl.pathname.endsWith('/' + assetPath.replace(/^\//, ''));
  });

  if (isAppShell) {
    // Cache-First for static assets
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Update cache in background
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(STATIC_ASSETS_CACHE).then(cache => {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(STATIC_ASSETS_CACHE).then(cache => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        });
      })
    );
  } else {
    // Stale-While-Revalidate for other same-origin assets
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(STATIC_ASSETS_CACHE).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(err => {
            console.log('[SW] Fetch failed (offline):', err);
            if (cachedResponse) {
              return cachedResponse;
            }
            throw err;
          });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
