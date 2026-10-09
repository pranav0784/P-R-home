self.addEventListener('push', function(event) {
    const options = {
        body: "", // Stealth: No text content
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        tag: 'stealth-alien-msg',
        renotify: true,
        silent: false,
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification("👽", options)
    );
});

// Dismiss notification immediately on click
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
});
