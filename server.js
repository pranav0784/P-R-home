const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

// Configure VAPID Keys for Web Push Notifications
const vapidKeys = {
    publicKey: 'YOUR_PUBLIC_VAPID_KEY',
    privateKey: 'YOUR_PRIVATE_VAPID_KEY'
};

webpush.setVapidDetails(
    'mailto:admin@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Static Files
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Data Structures
const registeredUsers = {}; 
const activeSockets = {};   
const pushSubscriptions = {}; // { username: subscriptionObject }
let chatHistory = [];       

const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

function updateUserList() {
    const list = Object.values(registeredUsers).map(user => ({
        ...user,
        isOnline: Object.values(activeSockets).includes(user.username)
    }));
    io.emit('update-user-list', list);
}

io.on('connection', (socket) => {

    // Login System
    socket.on('login-attempt', (data) => {
        const { username, inputCode } = data;
        
        if (!username) {
            return socket.emit('login-failed', 'Username is required!');
        }

        let isAdmin = false;
        const isExistingUser = !!registeredUsers[username];

        if (isExistingUser) {
            isAdmin = registeredUsers[username].isAdmin;
        } else {
            if (inputCode === MASTER_ADMIN_CODE) {
                isAdmin = true;
            } else if (inputCode === currentDynamicCode) {
                isAdmin = false;
            } else {
                return socket.emit('login-failed', 'Invalid Passcode!');
            }
        }

        const userAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

        if (!registeredUsers[username]) {
            registeredUsers[username] = { username, avatarUrl: userAvatar, isAdmin, lastSeen: 'Online' };
        }

        activeSockets[socket.id] = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: registeredUsers[username].avatarUrl
        });

        updateUserList();
    });

    // Save Push Subscription
    socket.on('register-push-subscription', (data) => {
        if (data.username && data.subscription) {
            pushSubscriptions[data.username] = data.subscription;
        }
    });

    // Private Messaging with Push Notification Payload
    socket.on('send-private-message', (data) => {
        if (!data.targetName || !data.senderName) return;

        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaUrl: data.mediaUrl || null,
            isViewOnce: data.isViewOnce || false,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        };

        chatHistory.push(msgObject);

        // Send via Socket IO
        io.to(data.targetName).emit('receive-private-message', msgObject);
        if (data.senderName !== data.targetName) {
            io.to(data.senderName).emit('receive-private-message', msgObject);
        }

        // Send Push Notification (Target User device receives Alien Emoji 👽)
        const targetSub = pushSubscriptions[data.targetName];
        if (targetSub) {
            const payload = JSON.stringify({
                title: '👽',
                body: '👽'
            });

            webpush.sendNotification(targetSub, payload).catch(err => {
                console.error('Push notification delivery error:', err);
            });
        }
    });

    // Whiteboard Sync
    socket.on('wb-draw-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-draw-receive', data);
        }
    });

    socket.on('wb-clear-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-clear-receive');
        }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
        updateUserList();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
