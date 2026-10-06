// sw.js - Service Worker for Push Notifications & Offline Caching

const CACHE_NAME = 'chatapp-v1';
const urlsToCache = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => response || fetch(event.request))
    );
});

// Push Notifications Listener
self.addEventListener('push', function(event) {
    const options = {
        body: '👽',
        icon: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alien',
        badge: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alien',
        vibrate: [200, 100, 200],
        tag: 'chat-notification',
        renotify: true,
        data: {
            dateOfArrival: Date.now()
        }
    };

    event.waitUntil(
        self.registration.showNotification('👽', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
