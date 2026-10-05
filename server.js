const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const registeredUsers = {}; // { username: { avatarUrl, isAdmin, lastSeen } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       

const MASTER_ADMIN_CODE = "guddu05";
let currentDynamicCode = "4829";

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {

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
                return socket.emit('login-failed', 'अमान्य पासकोड (Invalid Passcode)!');
            }
        }

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

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
            io.to(userToKick).emit('kicked-by-admin', 'आपको एडमिन द्वारा हटा दिया गया है।');
            updateUserList();
        }
    });

    socket.on('update-avatar', (data) => {
        if (registeredUsers[data.username]) {
            registeredUsers[data.username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    socket.on('send-private-message', (data) => {
        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl || null,
            replyTo: data.replyTo || null,
            time: data.clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
        };

        chatHistory.push(msgObject);

        // Target aur Sender dono ko turant deliver karein bina refresh ke
        io.to(data.targetName).emit('receive-private-message', msgObject);
        io.to(data.senderName).emit('receive-private-message', msgObject);
    });

    socket.on('delete-message-everyone', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
        io.emit('message-deleted-everyone', { msgId: data.msgId });
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
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
server.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
