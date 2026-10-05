const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB File Limit
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

const registeredUsers = {}; // { username: { avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       

const MASTER_ADMIN_CODE = "pranav123";
let currentDynamicCode = "4829";

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {

    // 1. User Authentication
    socket.on('login-attempt', (data) => {
        const { username, inputCode, avatarUrl } = data;
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
                return socket.emit('login-failed', 'Invalid passcode! Please enter correct passcode.');
            }
        }

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

        if (!registeredUsers[username]) {
            registeredUsers[username] = { username, avatarUrl: userAvatar, isAdmin, lastSeen: 'Online' };
        } else {
            if (avatarUrl) registeredUsers[username].avatarUrl = avatarUrl;
            registeredUsers[username].lastSeen = 'Online';
        }

        activeSockets[socket.id] = username;

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: registeredUsers[username].avatarUrl
        });

        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    // 2. Admin Passcode Controls
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

    // 3. Admin Kick Action
    socket.on('remove-user-by-admin', (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser && registeredUsers[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;
            delete registeredUsers[userToKick];

            const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === userToKick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked-by-admin', 'You have been removed by the Admin.');
                delete activeSockets[targetSocketId];
            }
            updateUserList();
        }
    });

    // 4. Update Profile Picture
    socket.on('update-avatar', (data) => {
        if (registeredUsers[data.username]) {
            registeredUsers[data.username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    // 5. Send Private Message (Text, Image, Video, Audio, Call Log)
    socket.on('send-private-message', (data) => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl || null,
            replyTo: data.replyTo || null,
            time: timeStr
        };

        chatHistory.push(msgObject);

        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive-private-message', msgObject);
        }
        socket.emit('receive-private-message', msgObject);
    });

    // 6. Delete for Everyone Broadcast
    socket.on('delete-message-everyone', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    // 7. Typing Indicator
    socket.on('typing', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user-typing-status', { fromUser: activeSockets[socket.id], isTyping: data.isTyping });
        }
    });

    // 8. WebRTC Call Signals
    socket.on('call-user', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming-call', { fromUser: activeSockets[socket.id], offer: data.offer, isVideo: data.isVideo });
        }
    });

    socket.on('answer-call', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-accepted', { answer: data.answer });
        }
    });

    socket.on('ice-candidate', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice-candidate', { candidate: data.candidate });
        }
    });

    socket.on('end-call', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-ended');
        }
    });

    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `Last seen today at ${timeStr}`;
            }
            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

function updateUserList() {
    const list = Object.values(registeredUsers).map(user => ({
        ...user,
        isOnline: Object.values(activeSockets).includes(user.username)
    }));
    io.emit('update-user-list', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Quantum Engine Active on Port ${PORT}`));
