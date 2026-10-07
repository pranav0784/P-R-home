const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

let serviceAccount = null;
const secretPath = '/etc/secrets/serviceAccountKey.json';
const localPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(secretPath)) {
    try { serviceAccount = require(secretPath); } catch (e) {}
} else if (fs.existsSync(localPath)) {
    try { serviceAccount = require(localPath); } catch (e) {}
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch (e) {}
}

if (serviceAccount) {
    try {
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        }
        console.log("🔥 Firebase Admin Initialized Successfully!");
    } catch (fErr) {
        console.error("Firebase Init Error:", fErr);
    }
}

const db = (admin.apps && admin.apps.length > 0) ? admin.firestore() : null;

const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Service Worker के लिए रूट हैंडलर ताकि sw.js ठीक से लोड हो सके
app.get('/sw.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'sw.js'));
});

const activeSockets = {}; 
const userDetails = {};   
const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function getUserSocketId(username) {
    for (let socketId in activeSockets) {
        if (activeSockets[socketId] === username) return socketId;
    }
    return null;
}

async function syncUsersFromDB() {
    if (!db) return;
    try {
        const snapshot = await db.collection('users').get();
        snapshot.forEach(doc => {
            userDetails[doc.id] = doc.data();
        });
    } catch (e) {
        console.error("Error fetching users:", e);
    }
}

async function broadcastUserList() {
    await syncUsersFromDB();
    const onlineUsernames = Object.values(activeSockets);
    const list = Object.values(userDetails).map(u => ({
        ...u,
        isOnline: onlineUsernames.includes(u.username)
    }));
    io.emit('update-user-list', list);
}

async function getChatHistoryFromDB() {
    if (!db) return [];
    try {
        const snapshot = await db.collection('chats').orderBy('timestamp', 'asc').get();
        let history = [];
        snapshot.forEach(doc => {
            history.push({ msgId: doc.id, ...doc.data() });
        });
        return history;
    } catch (e) {
        console.error("Error fetching chats from DB:", e);
        return [];
    }
}

io.on('connection', (socket) => {

    socket.on('login-attempt', async (data) => {
        const { username, inputCode, avatarUrl, clientTime } = data;
        if (!username) return socket.emit('login-failed', 'Username is required!');

        await syncUsersFromDB();
        let userObj = userDetails[username];
        let isAdmin = false;

        if (userObj && userObj.isApproved) {
            isAdmin = !!userObj.isAdmin;
        } else {
            if (inputCode === MASTER_ADMIN_CODE) {
                isAdmin = true;
            } else if (inputCode === currentDynamicCode) {
                isAdmin = false;
            } else {
                return socket.emit('login-failed', 'Invalid Passcode!');
            }
        }

        const userAvatar = avatarUrl || userObj?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

        userObj = {
            username,
            avatarUrl: userAvatar,
            isAdmin: isAdmin,
            isApproved: true,
            lastSeen: 'Online'
        };

        userDetails[username] = userObj;

        if (db) {
            try {
                await db.collection('users').doc(username).set(userObj, { merge: true });
            } catch (err) {
                console.error("Error saving user:", err);
            }
        }

        activeSockets[socket.id] = username;
        
        socket.join(username);
        socket.join('global-chat-room');

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: userObj.avatarUrl
        });

        const chatHistory = await getChatHistoryFromDB();
        socket.emit('load-chat-history', chatHistory);
        await broadcastUserList();
    });

    socket.on('request-user-list', async () => { 
        await broadcastUserList(); 
    });

    socket.on('generate-new-code', async () => {
        const username = activeSockets[socket.id];
        if (username && userDetails[username]?.isAdmin) {
            currentDynamicCode = generateRandomCode();
            io.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', async (data) => {
        const username = activeSockets[socket.id];
        if (username && userDetails[username]?.isAdmin && data.newCode) {
            currentDynamicCode = data.newCode;
            io.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('update-avatar', async (data) => {
        const { username, newAvatarUrl } = data;
        if (userDetails[username]) {
            userDetails[username].avatarUrl = newAvatarUrl;
            if (db) {
                await db.collection('users').doc(username).set({ avatarUrl: newAvatarUrl }, { merge: true });
            }
            await broadcastUserList();
        }
    });

    socket.on('remove-user-by-admin', async (data) => {
        const adminName = activeSockets[socket.id];
        if (adminName && userDetails[adminName]?.isAdmin) {
            const targetSocketId = getUserSocketId(data.targetUsername);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked-by-admin', 'You have been removed by the Master Admin.');
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) targetSocket.disconnect();
            }
            if (db) {
                await db.collection('users').doc(data.targetUsername).delete();
            }
            delete userDetails[data.targetUsername];
            await broadcastUserList();
        }
    });

    socket.on('send-private-message', async (data) => {
        const { senderName, targetName, message, mediaType, mediaUrl, isViewOnce, replyTo, clientTime } = data;
        
        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const msgObj = {
            msgId,
            senderName,
            targetName,
            message: message || '',
            mediaType: mediaType || 'text',
            mediaUrl: mediaUrl || '',
            isViewOnce: !!isViewOnce,
            isOpened: false,
            replyTo: replyTo || null,
            time: clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            timestamp: admin.firestore ? admin.firestore.FieldValue.serverTimestamp() : Date.now(),
            isDelivered: true,
            isRead: false
        };

        if (db) {
            try {
                await db.collection('chats').doc(msgId).set(msgObj);
            } catch (e) {
                console.error("Error saving message:", e);
            }
        }

        io.to(targetName).emit('receive-private-message', msgObj);
        socket.emit('receive-private-message', msgObj);
    });

    socket.on('mark-messages-read', async (data) => {
        const { readerName } = data;
        io.emit('messages-read-update', { readerName });
    });

    socket.on('mark-viewonce-opened', async (data) => {
        const { msgId } = data;
        if (db) {
            try {
                await db.collection('chats').doc(msgId).set({ isOpened: true }, { merge: true });
            } catch (e) {}
        }
        io.emit('viewonce-opened-update', { msgId });
    });

    socket.on('delete-message-everyone', async (data) => {
        const { msgId } = data;
        if (db) {
            try {
                await db.collection('chats').doc(msgId).delete();
            } catch (e) {}
        }
        io.emit('message-deleted-everyone', { msgId });
    });

    socket.on('typing', (data) => {
        const fromUser = activeSockets[socket.id];
        if (fromUser) {
            io.to(data.targetName).emit('user-typing-status', { fromUser, isTyping: data.isTyping });
        }
    });

    socket.on('wb-draw-data', (data) => {
        const senderName = activeSockets[socket.id];
        if(senderName) {
            io.to(data.targetName).emit('wb-draw-receive', { senderName, ...data });
        }
    });

    socket.on('wb-clear-data', (data) => {
        const senderName = activeSockets[socket.id];
        if(senderName) {
            io.to(data.targetName).emit('wb-clear-receive', { senderName });
        }
    });

    socket.on('call-user', (data) => {
        const fromUser = activeSockets[socket.id];
        if (fromUser) {
            io.to(data.targetName).emit('incoming-call', { fromUser, offer: data.offer, isVideo: data.isVideo });
        }
    });

    socket.on('call-ringing', (data) => {
        const fromUser = activeSockets[socket.id];
        if (fromUser) {
            io.to(data.targetName).emit('call-ringing-received');
        }
    });

    socket.on('answer-call', (data) => {
        io.to(data.targetName).emit('call-accepted', { answer: data.answer });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.targetName).emit('ice-candidate', { candidate: data.candidate });
    });

    socket.on('end-call', (data) => {
        io.to(data.targetName).emit('call-ended');
    });

    socket.on('disconnect', async () => {
        const username = activeSockets[socket.id];
        if (username) {
            delete activeSockets[socket.id];
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            const lastSeenStr = `Last seen today at ${timeStr}`;
            
            if (userDetails[username]) {
                userDetails[username].lastSeen = lastSeenStr;
                if (db) {
                    try {
                        await db.collection('users').doc(username).set({ lastSeen: lastSeenStr }, { merge: true });
                    } catch (e) {}
                }
            }
        }
        await broadcastUserList();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Quantum Messenger Server running on port ${PORT}`);
});
