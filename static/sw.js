const CACHE_NAME = 'drae-studio-v1';
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/color-utils.js',
    '/static/js/pigments.js',
    '/static/js/palette.js',
    '/static/js/grids.js',
    '/static/js/composition.js',
    '/static/js/app.js',
    '/static/manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Always go to network for API calls
    if (event.request.url.includes('/extract') || event.request.url.includes('/image/') || event.request.url.includes('/colormap/') || event.request.url.includes('/sketch/') || event.request.url.includes('/remove-bg') || event.request.url.includes('/valuemap/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for static assets
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
