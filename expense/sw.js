const CACHE_NAME = 'v4_cache';
const urlsToCache = [
  './',
  './index.html', // 換成你的 html 檔名
  './style.css',
  './script.js',
  './manifest.json',
  'money-bag-money-svgrepo-com.svg'
];

// 安裝 Service Worker 並快取檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// 攔截請求，優先從快取讀取
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );

});


