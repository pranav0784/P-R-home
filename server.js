const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB media limit
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const registeredUsers = {}; // { username: { avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       

io.on('connection', (socket) => {

    socket.on('login-attempt', (data) => {
        const { username, avatarUrl } = data;
        
        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

        if (!registeredUsers[username]) {
            registeredUsers[username] = { username, avatarUrl: userAvatar, isAdmin: false, lastSeen: 'online' };
        } else {
            if (avatarUrl) registeredUsers[username].avatarUrl = avatarUrl;
            registeredUsers[username].lastSeen = 'online';
        }

        activeSockets[socket.id] = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            avatarUrl: registeredUsers[username].avatarUrl
        });

        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    socket.on('update-avatar', (data) => {
        if (registeredUsers[data.username]) {
            registeredUsers[data.username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    socket.on('send-private-message', (data) => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl || null,
            time: timeStr
        };

        chatHistory.push(msgObject);

        io.to(data.targetName).emit('receive-private-message', msgObject);
        io.to(data.senderName).emit('receive-private-message', msgObject);
    });

    socket.on('typing', (data) => {
        io.to(data.targetName).emit('user-typing-status', { fromUser: activeSockets[socket.id], isTyping: data.isTyping });
    });

    socket.on('call-user', (data) => {
        io.to(data.targetName).emit('incoming-call', { fromUser: activeSockets[socket.id], offer: data.offer, isVideo: data.isVideo });
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

    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `last seen today at ${timeStr}`;
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
server.listen(PORT, () => console.log(`🚀 Advanced WhatsApp Web Server Active on Port ${PORT}`));
