const CACHE_NAME = 'weishi-money-v2'; // 更新版本號
const ASSETS = [
  './',               // 代表根目錄，通常指 index.html
  './index.html',
  './style.css',
  './script.js',
  './piggy-bank.svg', // 確保圖示也被快取
  'https://unpkg.com/vue@3/dist/vue.global.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// 安裝並快取檔案
self.addEventListener('install', (e) => {
  self.skipWaiting(); // 強制更新
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// 啟動時清理舊快取
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// 攔截請求
self.addEventListener('fetch', (e) => {
  // 1. GAS 的請求不要快取
  if (e.request.url.includes('script.google.com')) {
    return; // 交給瀏覽器默認處理
  }
  
  // 2. 動態產生的 blob manifest 不要快取
  if (e.request.url.startsWith('blob:')) {
    return;
  }

  e.respondWith(
    // 關鍵修改：ignoreSearch 確保帶參數的網址也能命中 index.html 快取
    caches.match(e.request, { ignoreSearch: true }).then((res) => {
      return res || fetch(e.request);
    })
  );
});
