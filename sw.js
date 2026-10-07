// Service Worker for Alien Notifications

self.addEventListener('push', function(event) {
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = {};
    }

    const options = {
        body: "", // कोई टेक्स्ट नहीं दिखेगा
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        tag: 'alien-notification',
        renotify: true,
        silent: false,
        // कोई URL या एक्शन डेटा नहीं ताकि क्लिक करने पर ब्राउज़र/वेबसाइट न खुले
    };

    event.waitUntil(
        self.registration.showNotification('👽', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    // इमोजी पर टच करते ही नोटिफिकेशन गायब हो जाएगा और कोई वेबसाइट नहीं खुलेगी
    event.notification.close();
});
