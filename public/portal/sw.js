/* FA Client Portal service worker: fast loading, works on weak connections, shows notifications. */
const VERSION = 'fa-portal-v1';
const SHELL = [
  '/portal/', '/portal/index.html', '/portal/portal.css', '/portal/common.js', '/portal/i18n.js', '/portal/app.js',
  '/portal/studio/', '/portal/studio/index.html', '/portal/studio/studio.js',
  '/portal/manifest.webmanifest', '/portal/icon-192.png', '/images/logo.webp',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// App files: try the network first (always fresh), fall back to the saved copy when offline.
// API calls and uploaded files are never cached here (they are private and change often).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/portal/') && !url.pathname.startsWith('/images/')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match(url.pathname.startsWith('/portal/studio/') ? '/portal/studio/' : '/portal/')))
  );
});

// A push is only a "wake-up" signal; we ask the server what to show (in the person's language).
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let list = [];
    try {
      const r = await fetch('/api/notifications/pending', { credentials: 'include' });
      if (r.ok) list = (await r.json()).notifications || [];
    } catch (err) {}
    if (!list.length) {
      return self.registration.showNotification('FA Architectural Design', { body: 'You have a new update in your portal.', icon: '/portal/icon-192.png', badge: '/portal/icon-192.png', tag: 'fa-update', data: { url: '/portal/' } });
    }
    for (const n of list.slice(0, 3)) {
      await self.registration.showNotification(n.title, { body: n.body, icon: '/portal/icon-192.png', badge: '/portal/icon-192.png', tag: 'fa-' + n.id, data: { url: n.url } });
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/portal/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith('/portal/') && 'focus' in c) { c.postMessage({ go: target }); return c.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
