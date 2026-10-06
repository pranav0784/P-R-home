const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

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

const registeredUsers = {}; // { username: { username, avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       

const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

function getUserSocketId(username) {
    for (let socketId in activeSockets) {
        if (activeSockets[socketId] === username) return socketId;
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

    socket.on('login-attempt', (data) => {
        const { username, inputCode, avatarUrl } = data;
        
        if (!username) return socket.emit('login-failed', 'Username अनिवार्य है!');

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
            registeredUsers[username].lastSeen = 'Online';
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

    // --- MESSAGING SYSTEM WITH REAL-TIME DELIVERED/READ TICKS ---
    socket.on('send-private-message', (data) => {
        if (!data.targetName || !data.senderName) return;

        const isTargetOnline = Object.values(activeSockets).includes(data.targetName);

        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType || null,
            mediaUrl: data.mediaUrl || null,
            isViewOnce: !!data.isViewOnce,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            status: isTargetOnline ? 'delivered' : 'sent' // Single tick vs Double tick logic
        };

        chatHistory.push(msgObject);

        io.to(data.targetName).emit('receive-private-message', msgObject);
        io.to(data.senderName).emit('receive-private-message', msgObject);
    });

    socket.on('mark-read', (data) => {
        const affectedMsgIds = [];
        chatHistory.forEach(msg => {
            if (msg.senderName === data.senderName && msg.targetName === data.receiverName && msg.status !== 'read') {
                msg.status = 'read';
                affectedMsgIds.push(msg.msgId);
            }
        });

        if (affectedMsgIds.length > 0) {
            io.to(data.senderName).emit('messages-status-update', { msgIds: affectedMsgIds, status: 'read' });
            io.to(data.receiverName).emit('messages-status-update', { msgIds: affectedMsgIds, status: 'read' });
        }
    });

    socket.on('typing', (data) => {
        if (data.targetName) {
            io.to(data.targetName).emit('user-typing-status', { 
                fromUser: activeSockets[socket.id], 
                isTyping: data.isTyping 
            });
        }
    });

    // --- WHITEBOARD HANDLERS ---
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
            io.to(data.targetName).emit('wb-clear-receive', { senderName: activeSockets[socket.id] });
        }
    });

    // --- DISCONNECT HANDLER ---
    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `Last seen at ${timeStr}`;
            }
            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
