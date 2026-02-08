const CACHE_NAME = 'note-app-v10-key';
const ASSETS = [
  'index.html',
  'manifest.json',
  'https://font.emtech.cc/css/jfOpenHuninn',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
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









