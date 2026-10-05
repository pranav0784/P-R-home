const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100MB payload limit for images/voice
});

app.use(express.static(__dirname));

// इन-मेमोरी डेटा स्टोरेज
const registeredUsers = {}; // { username: { avatarUrl, isAdmin } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       // सभी मैसेजेस यहाँ सेव रहेंगे (ऑफलाइन मैसेज सपोर्ट)

const MASTER_ADMIN_CODE = "pranav123";
let currentDynamicCode = "4829";

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {

    // 1. लॉगिन और ऑथेंटिकेशन
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
                return socket.emit('login-failed', 'नया यूजर! कृपया सही पासकोड दर्ज करें।');
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

        // लॉगिन होते ही पूरा चैट इतिहास यूजर को भेज दिया जाएगा
        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    // 2. पासकोड बदलना (Admin)
    socket.on('generate-new-code', () => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]?.isAdmin) {
            currentDynamicCode = generateRandomCode();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', (data) => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]?.isAdmin) {
            if (data.newCode && data.newCode.trim() !== '') {
                currentDynamicCode = data.newCode.trim();
                socket.emit('code-updated', { newCode: currentDynamicCode });
            }
        }
    });

    // 3. यूजर को किक करना (Admin)
    socket.on('remove-user-by-admin', (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser && registeredUsers[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;

            if (registeredUsers[userToKick]) {
                delete registeredUsers[userToKick];

                const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === userToKick);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('kicked-by-admin', 'आपको एडमिन द्वारा हटा दिया गया है।');
                    delete activeSockets[targetSocketId];
                }

                updateUserList();
            }
        }
    });

    // 4. प्रोफाइल अवतार अपडेट करना
    socket.on('update-avatar', (data) => {
        const { username, newAvatarUrl } = data;
        if (registeredUsers[username]) {
            registeredUsers[username].avatarUrl = newAvatarUrl;
            updateUserList();
        }
    });

    // 5. मैसेज भेजना (ऑनलाइन और ऑफलाइन दोनों स्थिति में सेव होगा)
    socket.on('send-private-message', (data) => {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message,
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl,
            time: timeStr
        };

        // हमेशा ग्लोबल चैट हिस्ट्री में मैसेज सेव करें
        chatHistory.push(msgObject);

        // अगर सामने वाला यूजर ऑनलाइन है, तो उसे रियल-टाइम में मैसेज डिलीवर करें
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive-private-message', msgObject);
        }
        
        // खुद की स्क्रीन पर मैसेज अपडेट करें
        socket.emit('receive-private-message', msgObject);
    });

    // 6. मैसेज डिलीट करना
    socket.on('delete-message', (data) => {
        const { msgId } = data;
        chatHistory = chatHistory.filter(m => m.msgId !== msgId);
        io.emit('message-deleted', { msgId });
    });

    // 7. टाइपिंग इंडिकेटर
    socket.on('typing', (data) => {
        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user-typing', { fromUser: activeSockets[socket.id], isTyping: data.isTyping });
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
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
