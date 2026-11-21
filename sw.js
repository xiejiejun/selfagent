// SelfAgent Service Worker：静态资源 stale-while-revalidate（秒开+后台更新），短片与缩略图缓存优先
const V = 'sa-p448';
const PRECACHE = ['./', './index.html', './style.css', './lib.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheFirst(req) {
  return caches.open(V).then(c =>
    c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }))
  );
}

// 先给缓存，同时后台拉新版（下次进入即生效）
function swr(req) {
  const key = (() => { const u = new URL(req.url); u.search = ''; return u.href; })();
  return caches.open(V).then(c => c.match(key).then(hit => {
    const net = fetch(req, { cache: 'reload' }).then(res => {
      if (res && res.ok) c.put(key, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (/\/media\/(clip\/[0-9]+\.mp4|thumb\/[0-9]+\.webp)$/.test(u.pathname)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (u.pathname.endsWith('/') || /(index\.html|lib\.js|style\.css)$/.test(u.pathname)) {
    e.respondWith(swr(req));
  }
});
