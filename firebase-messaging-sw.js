importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');

// Config Embedded Directly
firebase.initializeApp({
  apiKey: "AIzaSyCsx9a13LTLcejj1G5AqZA53-z0ycqX5wM",
  authDomain: "p-r-home-81991.firebaseapp.com",
  databaseURL: "https://p-r-home-81991-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "p-r-home-81991",
  storageBucket: "p-r-home-81991.firebasestorage.app",
  messagingSenderId: "851201030918",
  appId: "1:851201030918:web:4bc6ad61a8a7c8fe7ebc87",
  measurementId: "G-REJFHGYW9F"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || payload.notification?.title || "👽";
    const body = payload.data?.body || payload.notification?.body || "";

    const options = {
        body: body,
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        badge: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>👽</text></svg>",
        tag: 'secret-alien-msg',
        renotify: true,
        vibrate: [200, 100, 200]
    };

    self.registration.showNotification(title, options);
});
