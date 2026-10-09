// Stealth Mode Service Worker for Alien Notifications

self.addEventListener('push', function(event) {
    let title = "👽";
    let body = "";

    if (event.data) {
        try {
            const data = event.data.json();
            title = data.title || data.notification?.title || title;
            body = data.body || data.notification?.body || body;
        } catch (e) {
            title = event.data.text() || title;
        }
    }

    const options = {
        body: body,
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        tag: 'secret-alien-msg',
        renotify: true,
        silent: false,
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
