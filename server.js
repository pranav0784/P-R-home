const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// 1. Firebase Admin Initialisation (Render Secret / Local Support)
let serviceAccount = null;

const secretPath = '/etc/secrets/serviceAccountKey.json';
const localPath = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(secretPath)) {
    try {
        serviceAccount = require(secretPath);
        console.log("Found Firebase key in /etc/secrets/");
    } catch (e) {
        console.error("Error loading secret file:", e);
    }
} else if (fs.existsSync(localPath)) {
    try {
        serviceAccount = require(localPath);
        console.log("Found Firebase key in local directory.");
    } catch (e) {
        console.error("Error loading local serviceAccountKey.json:", e);
    }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log("Found Firebase key in Environment Variable.");
    } catch (e) {
        console.error("Error parsing FIREBASE_SERVICE_ACCOUNT env var:", e);
    }
}

if (serviceAccount) {
    try {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        console.log("🔥 Firebase Admin Initialized Successfully!");
    } catch (fErr) {
        console.error("Firebase Admin Initialization Failed:", fErr);
    }
} else {
    console.log("⚠️ Running without Firebase. Data will not persist across restarts.");
}

const db = (admin.apps && admin.apps.length > 0) ? admin.firestore() : null;

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

const activeSockets = {}; // socket.id -> username
const userDetails = {};   // username -> { username, avatarUrl, isAdmin, isApproved, lastSeen }
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
            const data = doc.data();
            userDetails[doc.id] = data;
        });
    } catch (e) {
        console.error("Error fetching users DB:", e);
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
        console.error("Error fetching chats:", e);
        return [];
    }
}

io.on('connection', (socket) => {

    socket.on('login-attempt', async (data) => {
        const { username, inputCode, avatarUrl } = data;
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
                console.error("Error saving user to Firestore:", err);
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
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', async (data) => {
        const username = activeSockets[socket.id];
        if (username && userDetails[username]?.isAdmin && data.newCode) {
            currentDynamicCode = data.newCode.trim();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('remove-user-by-admin', async (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser && userDetails[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;
            
            delete userDetails[userToKick];
            if (db) {
                try {
                    await db.collection('users').doc(userToKick).delete();
                } catch (err) {
                    console.error("Error deleting user from Firestore:", err);
                }
            }
            
            const targetSocketId = getUserSocketId(userToKick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked-by-admin', 'Administrator ने आपको रिमूव कर दिया है। अब दोबारा जुड़ने के लिए नया कोड दर्ज करें।');
            }
            await broadcastUserList();
        }
    });

    socket.on('update-avatar', async (data) => {
        if (userDetails[data.username]) {
            userDetails[data.username].avatarUrl = data.newAvatarUrl;
        }
        if (db) {
            try {
                await db.collection('users').doc(data.username).update({ avatarUrl: data.newAvatarUrl });
            } catch (err) {
                console.error("Error updating avatar in Firestore:", err);
            }
        }
        await broadcastUserList();
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
            try {
                await db.collection('chats').doc(msgId).set(msgObject);
            } catch (err) {
                console.error("Error saving message to Firestore:", err);
            }
        }

        const clientPayload = { msgId, ...msgObject };

        io.to(data.targetName).emit('receive-private-message', clientPayload);
        if (data.senderName !== data.targetName) {
            io.to(data.senderName).emit('receive-private-message', clientPayload);
        }
    });

    socket.on('mark-messages-read', async (data) => {
        if (db) {
            try {
                const snapshot = await db.collection('chats')
                    .where('senderName', '==', data.senderName)
                    .where('targetName', '==', data.readerName)
                    .get();
                
                const batch = db.batch();
                snapshot.docs.forEach(doc => {
                    batch.update(doc.ref, { isRead: true, isDelivered: true });
                });
                await batch.commit();
            } catch (err) {
                console.error("Error marking messages read in Firestore:", err);
            }
        }
        io.to(data.senderName).emit('messages-read-update', { readerName: data.readerName });
    });

    socket.on('mark-viewonce-opened', async (data) => {
        if (db) {
            try {
                await db.collection('chats').doc(data.msgId).update({ isOpened: true });
            } catch (err) {
                console.error("Error updating viewOnce in Firestore:", err);
            }
        }
        io.emit('viewonce-opened-update', { msgId: data.msgId });
    });

    socket.on('delete-message-everyone', async (data) => {
        if (db) {
            try {
                await db.collection('chats').doc(data.msgId).delete();
            } catch (err) {
                console.error("Error deleting message from Firestore:", err);
            }
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
            if (userDetails[username]) {
                userDetails[username].lastSeen = `last seen today at ${timeStr}`;
            }
            if (db) {
                try {
                    await db.collection('users').doc(username).update({
                        lastSeen: `last seen today at ${timeStr}`
                    });
                } catch (err) {
                    console.error("Error updating lastSeen in Firestore:", err);
                }
            }
            delete activeSockets[socket.id];
            await broadcastUserList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server Active on Port ${PORT}`));
