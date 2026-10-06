const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);

// 100MB Max Payload limit for high-res images/audio sending
const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

// --- Push Notification Setup (VAPID Keys) ---
const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || 'YOUR_PUBLIC_VAPID_KEY',
    privateKey: process.env.VAPID_PRIVATE_KEY || 'YOUR_PRIVATE_VAPID_KEY'
};

webpush.setVapidDetails(
    'mailto:admin@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// --- Middleware & Routes ---
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- In-Memory Data Stores ---
const registeredUsers = {};    // { username: { username, avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};      // { socketId: username }
const pushSubscriptions = {};  // { username: subscriptionObject }
let chatHistory = [];       

// --- Passcode System ---
const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

// --- Utility Functions ---
function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function getUserSocketId(username) {
    for (let socketId in activeSockets) {
        if (activeSockets[socketId] === username) {
            return socketId;
        }
    }
    return null;
}

function updateUserList() {
    const list = Object.values(registeredUsers).map(user => ({
        ...user,
        isOnline: Object.values(activeSockets).includes(user.username)
    }));
    io.emit('update-user-list', list);
}

// --- Socket.IO Event Engine ---
io.on('connection', (socket) => {

    // ------------------------------------
    // 1. AUTHENTICATION & LOGIN
    // ------------------------------------
    socket.on('login-attempt', (data) => {
        const { username, inputCode, avatarUrl } = data;
        
        if (!username || !username.trim()) {
            return socket.emit('login-failed', 'यूज़रनेम आवश्यक है (Username is required)!');
        }

        const cleanUsername = username.trim();
        let isAdmin = false;
        const isExistingUser = !!registeredUsers[cleanUsername];

        if (isExistingUser) {
            isAdmin = registeredUsers[cleanUsername].isAdmin;
        } else {
            if (inputCode === MASTER_ADMIN_CODE) {
                isAdmin = true;
            } else if (inputCode === currentDynamicCode) {
                isAdmin = false;
            } else {
                return socket.emit('login-failed', 'अमान्य पासकोड (Invalid Passcode)!');
            }
        }

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUsername)}`;

        if (!registeredUsers[cleanUsername]) {
            registeredUsers[cleanUsername] = { 
                username: cleanUsername, 
                avatarUrl: userAvatar, 
                isAdmin: isAdmin, 
                lastSeen: 'Online' 
            };
        } else {
            if (avatarUrl) {
                registeredUsers[cleanUsername].avatarUrl = avatarUrl;
            }
            registeredUsers[cleanUsername].lastSeen = 'Online';
        }

        activeSockets[socket.id] = cleanUsername;
        socket.join(cleanUsername);

        // Success Event - Synchronized with UI
        socket.emit('login-success', {
            username: cleanUsername,
            isAdmin: isAdmin,
            avatarUrl: registeredUsers[cleanUsername].avatarUrl
        });

        // Push Chat History
        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    socket.on('request-user-list', () => {
        updateUserList();
    });

    // ------------------------------------
    // 2. ADMIN ACTIONS & CODE CONTROLS
    // ------------------------------------
    socket.on('generate-new-code', () => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]?.isAdmin) {
            currentDynamicCode = generateRandomCode();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', (data) => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]?.isAdmin && data.newCode) {
            currentDynamicCode = data.newCode.toString().trim();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('remove-user-by-admin', (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser && registeredUsers[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;
            delete registeredUsers[userToKick];
            
            const targetSocketId = getUserSocketId(userToKick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked-by-admin', 'आपको एडमिन द्वारा हटा दिया गया है।');
            }
            updateUserList();
        }
    });

    socket.on('update-avatar', (data) => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]) {
            registeredUsers[username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    // ------------------------------------
    // 3. WEB PUSH SUBSCRIPTION
    // ------------------------------------
    socket.on('register-push-subscription', (data) => {
        const username = activeSockets[socket.id] || data.username;
        if (username && data.subscription) {
            pushSubscriptions[username] = data.subscription;
        }
    });

    // ------------------------------------
    // 4. CHAT, MEDIA & VIEW-ONCE SYSTEM
    // ------------------------------------
    socket.on('send-private-message', (data) => {
        const senderName = activeSockets[socket.id] || data.senderName;
        if (!data.targetName || !senderName) return;

        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            senderName: senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType || null,
            mediaUrl: data.mediaUrl || null,
            replyTo: data.replyTo || null,
            isViewOnce: !!data.isViewOnce,
            time: data.clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        };

        // Don't store View Once media permanently in server history for security
        if (!msgObject.isViewOnce) {
            chatHistory.push(msgObject);
        }

        // Emit to Receiver and Sender
        io.to(data.targetName).emit('receive-private-message', msgObject);
        if (senderName !== data.targetName) {
            io.to(senderName).emit('receive-private-message', msgObject);
        }

        // Web Push Trigger for Receiver (👽)
        const targetSub = pushSubscriptions[data.targetName];
        if (targetSub) {
            const payload = JSON.stringify({
                title: '👽',
                body: '👽'
            });

            webpush.sendNotification(targetSub, payload).catch(err => {
                console.error('Push Notification Error:', err.message);
            });
        }
    });

    socket.on('delete-message-everyone', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    socket.on('typing', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('user-typing-status', { 
                fromUser: sender, 
                isTyping: !!data.isTyping 
            });
        }
    });

    // ------------------------------------
    // 5. LIVE WHITEBOARD / PAINTBOARD
    // ------------------------------------
    socket.on('wb-draw-data', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('wb-draw-receive', {
                senderName: sender,
                x0: data.x0, y0: data.y0,
                x1: data.x1, y1: data.y1,
                color: data.color,
                size: data.size
            });
        }
    });

    socket.on('wb-clear-data', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('wb-clear-receive', {
                senderName: sender
            });
        }
    });

    // ------------------------------------
    // 6. WEBRTC AUDIO & VIDEO CALLING
    // ------------------------------------
    socket.on('call-user', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('incoming-call', { 
                fromUser: sender, 
                offer: data.offer, 
                isVideo: !!data.isVideo 
            });
        }
    });

    socket.on('answer-call', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('call-accepted', { 
                fromUser: sender,
                answer: data.answer 
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName && sender) {
            io.to(data.targetName).emit('ice-candidate', { 
                fromUser: sender,
                candidate: data.candidate 
            });
        }
    });

    socket.on('end-call', (data) => {
        const sender = activeSockets[socket.id];
        if (data.targetName) {
            io.to(data.targetName).emit('call-ended', { fromUser: sender });
        }
    });

    // ------------------------------------
    // 7. DISCONNECT & OFFLINE STATUS
    // ------------------------------------
    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `Last seen today at ${timeStr}`;
            }
            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🚀 Server fully synced and running on port ${PORT}`);
    console.log(`=================================`);
});
