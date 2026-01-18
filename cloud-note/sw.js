const CACHE_NAME = 'note-app-v1';
const ASSETS = [
  'index.html',
  'manifest.json',
  'https://ymdd-image-tw.s3.ap-east-2.amazonaws.com/font/jf-openhuninn-2.1.ttf'
];

// 安裝並快取資源
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 攔截請求
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});