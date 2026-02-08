const CACHE_NAME = 'weishi-money-v1';
const ASSETS = [
  'index.html',
  'style.css',
  'script.js',
  'https://unpkg.com/vue@3/dist/vue.global.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// 安裝並快取檔案
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 攔截請求（優先使用快取，讓讀取變快）
self.addEventListener('fetch', (e) => {
  // GAS 的請求不要快取，否則資料不會更新
  if (e.request.url.includes('script.google.com')) {
    return fetch(e.request);
  }
  
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
