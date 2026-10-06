const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);

// 1. Firebase Admin Initialisation (Render Secret / Local Support)
let serviceAccount;
try {
    serviceAccount = require('/etc/secrets/serviceAccountKey.json');
} catch (e) {
    try {
        serviceAccount = require('./serviceAccountKey.json');
    } catch (err) {
        console.log("Firebase key file not found. Running without Firebase fallback.");
    }
}

if (serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("🔥 Firebase Admin Initialized Successfully!");
}

const db = serviceAccount ? admin.firestore() : null;

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const activeSockets = {};   
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

async function getUsersFromDB() {
    if (!db) return {};
    try {
        const snapshot = await db.collection('users').get();
        let users = {};
        snapshot.forEach(doc => {
            users[doc.id] = doc.data();
        });
        return users;
    } catch (e) {
        console.error("Error fetching users from DB:", e);
        return {};
    }
}

async function updateUserList() {
    const registeredUsers = await getUsersFromDB();
    const list = Object.values(registeredUsers).map(user => ({
        ...user,
        isOnline: Object.values(activeSockets).includes(user.username)
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
        const { username, inputCode, avatarUrl } = data;
        if (!username) return socket.emit('login-failed', 'Username is required!');

        const registeredUsers = await getUsersFromDB();
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

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

        const userData = {
            username,
            avatarUrl: userAvatar,
            isAdmin,
            lastSeen: 'Online'
        };

        if (db) {
            await db.collection('users').doc(username).set(userData, { merge: true });
        }

        activeSockets[socket.id] = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: userData.avatarUrl
        });

        const chatHistory = await getChatHistoryFromDB();
        socket.emit('load-chat-history', chatHistory);
        await updateUserList();
    });

    socket.on('request-user-list', async () => { 
        await updateUserList(); 
    });

    socket.on('generate-new-code', async () => {
        const username = activeSockets[socket.id];
        const users = await getUsersFromDB();
        if (username && users[username]?.isAdmin) {
            currentDynamicCode = generateRandomCode();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', async (data) => {
        const username = activeSockets[socket.id];
        const users = await getUsersFromDB();
        if (username && users[username]?.isAdmin && data.newCode) {
            currentDynamicCode = data.newCode.trim();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('remove-user-by-admin', async (data) => {
        const requestingUser = activeSockets[socket.id];
        const users = await getUsersFromDB();
        if (requestingUser && users[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;
            if (db) {
                await db.collection('users').doc(userToKick).delete();
            }
            
            const targetSocketId = getUserSocketId(userToKick);
            if (targetSocketId) io.to(targetSocketId).emit('kicked-by-admin', 'You have been removed by the administrator.');
            await updateUserList();
        }
    });

    socket.on('update-avatar', async (data) => {
        if (db) {
            await db.collection('users').doc(data.username).update({ avatarUrl: data.newAvatarUrl });
            await updateUserList();
        }
    });

    socket.on('send-private-message', async (data) => {
        if (!data.targetName || !data.senderName) return;

        const msgId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        const msgObject = {
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType || null,
            mediaUrl: data.mediaUrl || null,
            replyTo: data.replyTo || null,
            isViewOnce: !!data.isViewOnce,
            isOpened: false,
            time: data.clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            timestamp: Date.now()
        };

        if (db) {
            await db.collection('chats').doc(msgId).set(msgObject);
        }

        const clientPayload = { msgId, ...msgObject };

        io.to(data.targetName).emit('receive-private-message', clientPayload);
        if (data.senderName !== data.targetName) {
            io.to(data.senderName).emit('receive-private-message', clientPayload);
        }
    });

    socket.on('mark-messages-read', async (data) => {
        if (db) {
            const snapshot = await db.collection('chats')
                .where('senderName', '==', data.senderName)
                .where('targetName', '==', data.readerName)
                .get();
            
            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, { isRead: true, isDelivered: true });
            });
            await batch.commit();
        }
        io.to(data.senderName).emit('messages-read-update', { readerName: data.readerName });
    });

    socket.on('mark-viewonce-opened', async (data) => {
        if (db) {
            await db.collection('chats').doc(data.msgId).update({ isOpened: true });
        }
        io.emit('viewonce-opened-update', { msgId: data.msgId });
    });

    socket.on('delete-message-everyone', async (data) => {
        if (db) {
            await db.collection('chats').doc(data.msgId).delete();
        }
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    socket.on('typing', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('user-typing-status', { 
                fromUser: activeSockets[socket.id], 
                isTyping: data.isTyping 
            });
        }
    });

    socket.on('wb-draw-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-draw-receive', {
                senderName: activeSockets[socket.id],
                x0: data.x0, y0: data.y0, x1: data.x1, y1: data.y1,
                color: data.color, size: data.size
            });
        }
    });

    socket.on('wb-clear-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-clear-receive', { senderName: activeSockets[socket.id] });
        }
    });

    socket.on('call-user', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('incoming-call', { fromUser: activeSockets[socket.id], offer: data.offer, isVideo: data.isVideo });
        }
    });

    socket.on('call-ringing', (data) => {
        if (data.targetName) {
            const targetSocketId = getUserSocketId(data.targetName);
            if (targetSocketId) io.to(targetSocketId).emit('call-ringing-received');
        }
    });

    socket.on('answer-call', (data) => {
        if (data.targetName) io.to(data.targetName).emit('call-accepted', { answer: data.answer });
    });

    socket.on('ice-candidate', (data) => {
        if (data.targetName) io.to(data.targetName).emit('ice-candidate', { candidate: data.candidate });
    });

    socket.on('end-call', (data) => {
        if (data.targetName) io.to(data.targetName).emit('call-ended');
    });

    socket.on('disconnect', async () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            if (db) {
                await db.collection('users').doc(username).update({
                    lastSeen: `last seen today at ${timeStr}`
                });
            }
            delete activeSockets[socket.id];
            await updateUserList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
