// VitaScan EvoMetaClaw Service Worker v2 - Full PWA offline support
const CACHE_NAME = 'vitascan-evometaclaw-v2';
const urlsToCache = [
  './index.html',
  './manifest.json',
  './sdk/vitascan-sdk.js'  // SDK for offline use
];

// Demo product data for full offline experience
const OFFLINE_DEMOS = {
  'coke': { product_name: "Coca-Cola Classic", nutriscore_grade: "e", _demoScore: 22 },
  'oats': { product_name: "Quaker Oats", nutriscore_grade: "a", _demoScore: 88 }
};

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Network first for API calls (Open Food Facts), cache first for static + SDK
  if (url.hostname.includes('openfoodfacts.org')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        // Return offline demo data if needed
        if (url.pathname.includes('demo')) {
          return new Response(JSON.stringify(OFFLINE_DEMOS), { headers: { 'Content-Type': 'application/json' } });
        }
      });
    })
  );
});