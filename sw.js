/* =========================================
   Service Worker - 离线缓存 & PWA 支持
   兼容 iOS 16.4+ (WKWebView Service Worker)
   ========================================= */

const CACHE_VERSION = 'stock-workbench-v9';
const RUNTIME_CACHE = 'stock-workbench-runtime-v9';

// 核心静态资源（App Shell）
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/api.js',
  './js/strategy.js',
  './js/app.js',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

/* ---------- 安装：预缓存 ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((e) => {
        console.warn('[SW] 部分资源预缓存失败:', e);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ---------- 激活：清理旧缓存 ---------- */
self.addEventListener('activate', (event) => {
  const expected = [CACHE_VERSION, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !expected.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- 拦截请求 ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 放行外部行情/财务接口：不拦截，让浏览器/脚本原生处理
  if (url.hostname.includes('gtimg.cn') ||
      url.hostname.includes('qt.gtimg') ||
      url.hostname.includes('eastmoney.com') ||
      url.hostname.includes('qq.com')) {
    return;
  }

  // 1) 导航请求：网络优先，失败用 offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match('./offline.html')
            .then((o) => o || caches.match('./index.html'))
          )
        )
    );
    return;
  }

  // 2) 图片类（外部 CDN icon）：缓存优先
  if (request.destination === 'image' || /\.(png|jpg|jpeg|svg|webp|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ||
        fetch(request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return resp;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 3) 同源静态资源（CSS/JS）：Cache First，失效回退网络
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return resp;
        }).catch(() => cached);
      })
    );
  }
});

/* ---------- 消息通信 ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
