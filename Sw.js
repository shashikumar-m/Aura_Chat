// Aura Chat — Service Worker for Push Notifications
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'Aura Chat', body: 'New message' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'Aura Chat', {
      body: data.body || 'You have a new message',
      icon: data.icon || '/icon.png',
      badge: '/badge.png',
      tag: 'aura-chat-msg',
      renotify: true,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(windowClients => {
    for (const client of windowClients) {
      if (client.url === url && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});