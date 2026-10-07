// Service Worker for Alien Notifications

self.addEventListener('push', function(event) {
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = {};
    }

    const options = {
        body: "",
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        tag: 'alien-notification',
        renotify: true,
        silent: false,
        data: {
            url: '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification('', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
});

