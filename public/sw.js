// ═══════════════════════════════════════════
//  Aura Chat — Service Worker v2
//  Handles: Caching, Offline, Push Notifications
// ═══════════════════════════════════════════

const CACHE_NAME  = 'aura-chat-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Instrument+Sans:wght@300;400;500&display=swap',
  'https://cdn.socket.io/4.7.5/socket.io.min.js'
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// FETCH
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API / socket — network only
  if (url.hostname.includes('onrender.com') || url.pathname.startsWith('/socket.io')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Fonts — cache first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(resp => {
        caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
        return resp;
      }))
    );
    return;
  }

  // Navigation — network first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(resp => {
        caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
        return resp;
      }).catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // Assets — cache first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp && resp.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(request, resp.clone()));
        }
        return resp;
      }).catch(() => new Response('', { status: 404 }));
    })
  );
});

// PUSH
self.addEventListener('push', event => {
  let data = { title: 'Aura Chat', body: 'New message', icon: '/icons/icon-192.png' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     data.icon || '/icons/icon-192.png',
      badge:    '/icons/icon-72.png',
      tag:      'aura-' + (data.room || 'msg'),
      renotify: true,
      vibrate:  [100, 50, 100],
      data:     { url: data.url || '/', room: data.room },
      actions:  [{ action: 'open', title: '💬 Open' }, { action: 'dismiss', title: '✕' }]
    })
  );
});

// NOTIFICATION CLICK
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if ('focus' in c) {
          c.focus();
          c.postMessage({ type: 'NOTIFICATION_CLICK', room: event.notification.data?.room });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// BACKGROUND SYNC
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_MESSAGES' }))
      )
    );
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});