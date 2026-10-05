const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100MB File/Media Transfer Limit
});

app.use(express.static(__dirname));

const registeredUsers = {}; // { username: { avatarUrl, isAdmin } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       // Global chat history for persistent messages

const MASTER_ADMIN_CODE = "pranav123";
let currentDynamicCode = "4829";

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {

    // 1. Authenticate / Login
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
                return socket.emit('login-failed', 'गलत पासकोड! कृपया सही कोड दर्ज करें।');
            }
        }

        const userAvatar = avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

        if (!registeredUsers[username]) {
            registeredUsers[username] = { username, avatarUrl: userAvatar, isAdmin };
        } else if (avatarUrl) {
            registeredUsers[username].avatarUrl = avatarUrl;
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

    // 3. Remove/Kick User (Admin)
    socket.on('remove-user-by-admin', (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser && registeredUsers[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;
            delete registeredUsers[userToKick];

            const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === userToKick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked-by-admin', 'आपको एडमिन द्वारा हटा दिया गया है।');
                delete activeSockets[targetSocketId];
            }
            updateUserList();
        }
    });

    // 4. Avatar Update
    socket.on('update-avatar', (data) => {
        if (registeredUsers[data.username]) {
            registeredUsers[data.username].avatarUrl = data.newAvatarUrl;
            updateUserList();
        }
    });

    // 5. Send Private Message (Text, Image, Video, Audio)
    socket.on('send-private-message', (data) => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message,
            mediaType: data.mediaType, // text, image, video, audio
            mediaUrl: data.mediaUrl,
            time: timeStr
        };

        chatHistory.push(msgObject);

        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive-private-message', msgObject);
        }
        socket.emit('receive-private-message', msgObject);
    });

    // 6. Delete Message
    socket.on('delete-message', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
        io.emit('message-deleted', { msgId: data.msgId });
    });

    // 7. Live Typing Indicator
    socket.on('typing', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user-typing-status', { fromUser: activeSockets[socket.id], isTyping: data.isTyping });
        }
    });

    // 8. Audio & Video Call WebRTC Signaling
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
        delete activeSockets[socket.id];
        updateUserList();
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
server.listen(PORT, () => console.log(`Quantum Server active on port ${PORT}`));
