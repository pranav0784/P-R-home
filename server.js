const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB max payload
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

// Static Files & Basic Route
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Data Structures
const registeredUsers = {}; // { username: { username, avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       

const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

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

io.on('connection', (socket) => {

    // --- LOGIN SYSTEM ---
    socket.on('login-attempt', (data) => {
        const { username, inputCode, avatarUrl } = data;
        
        if (!username) {
            return socket.emit('login-failed', 'Username zaroori hai!');
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
                return socket.emit('login-failed', 'अमान्य पासकोड (Invalid Passcode)!');
            }
        }

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`;

        if (!registeredUsers[username]) {
            registeredUsers[username] = { username, avatarUrl: userAvatar, isAdmin, lastSeen: 'Online' };
        } else {
            if (avatarUrl) {
                registeredUsers[username].avatarUrl = avatarUrl;
            }
            registeredUsers[username].lastSeen = 'Online';
        }

        activeSockets[socket.id] = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: registeredUsers[username].avatarUrl
        });

        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    socket.on('request-user-list', () => {
        updateUserList();
    });

    // --- ADMIN CONTROLS ---
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
            currentDynamicCode = data.newCode.trim();
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
        if (registeredUsers[data.username]) {
            registeredUsers[data.username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    // --- MESSAGING SYSTEM ---
    socket.on('send-private-message', (data) => {
        if (!data.targetName || !data.senderName) return;

        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType || null,
            mediaUrl: data.mediaUrl || null,
            isViewOnce: !!data.isViewOnce,
            isOpened: false,
            replyTo: data.replyTo || null,
            time: data.clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        };

        chatHistory.push(msgObject);

        io.to(data.targetName).emit('receive-private-message', msgObject);
        if (data.senderName !== data.targetName) {
            io.to(data.senderName).emit('receive-private-message', msgObject);
        }
    });

    socket.on('mark-messages-read', (data) => {
        chatHistory.forEach(m => {
            if (m.senderName === data.senderName && m.targetName === data.readerName) {
                m.isRead = true;
                m.isDelivered = true;
            }
        });
        io.to(data.senderName).emit('messages-read-update', { readerName: data.readerName });
    });

    socket.on('mark-viewonce-opened', (data) => {
        const msg = chatHistory.find(m => m.msgId === data.msgId);
        if (msg) {
            msg.isOpened = true;
            io.to(msg.senderName).emit('viewonce-opened-update', { msgId: data.msgId });
            io.to(msg.targetName).emit('viewonce-opened-update', { msgId: data.msgId });
        }
    });

    socket.on('delete-message-everyone', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
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

    // --- LIVE WHITEBOARD ---
    socket.on('wb-draw-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-draw-receive', {
                senderName: activeSockets[socket.id],
                x0: data.x0, y0: data.y0,
                x1: data.x1, y1: data.y1,
                color: data.color,
                size: data.size
            });
        }
    });

    socket.on('wb-clear-data', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('wb-clear-receive', {
                senderName: activeSockets[socket.id]
            });
        }
    });

    // --- WEBRTC CALLING ---
    socket.on('call-user', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('incoming-call', { 
                fromUser: activeSockets[socket.id], 
                offer: data.offer, 
                isVideo: data.isVideo 
            });
        }
    });

    socket.on('answer-call', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('call-accepted', { answer: data.answer });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('ice-candidate', { candidate: data.candidate });
        }
    });

    socket.on('end-call', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('call-ended');
        }
    });

    // --- DISCONNECT HANDLER (FIXED LAST SEEN FORMAT) ---
    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `last seen today at ${timeStr}`;
            }
            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
