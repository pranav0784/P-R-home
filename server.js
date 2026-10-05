const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100MB payload limit for high-res images and audio
});

app.use(express.static(__dirname));

// Persistent In-Memory Storage
const registeredUsers = {}; // { username: { avatarUrl, isAdmin } }
const activeSockets = {};   // { socketId: username }
let chatHistory = [];       // Global Array for Chat History Retention

const MASTER_ADMIN_CODE = "pranav123";
let currentDynamicCode = "4829"; // Default 4-Digit Passcode
let currentAppLogo = "https://cdn-icons-png.flaticon.com/512/3670/3670051.png";

// Helper: 4-Digit Random Code Generator
function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    socket.emit('update-logo', { logoUrl: currentAppLogo });

    // 1. User Authentication Logic
    socket.on('login-attempt', (data) => {
        const { username, inputCode, avatarUrl } = data;
        let isAdmin = false;

        const isExistingUser = registeredUsers[username] ? true : false;

        if (isExistingUser) {
            // पुराने रजिस्टर्ड यूज़र के लिए पासकोड की ज़रूरत नहीं है
            isAdmin = registeredUsers[username].isAdmin;
        } else {
            // केवल नए यूज़र के लिए पासकोड वेरीफाई करें
            if (inputCode === MASTER_ADMIN_CODE) {
                isAdmin = true;
            } else if (inputCode === currentDynamicCode) {
                isAdmin = false;
            } else {
                return socket.emit('login-failed', 'नया यूज़र! अमान्य पासकोड (Invalid Passcode)। कृपया सही कोड दर्ज करें।');
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
            avatarUrl: registeredUsers[username].avatarUrl,
            currentCode: currentDynamicCode
        });

        // WhatsApp Style - पुरानी चैट हिस्ट्री लोड करें
        socket.emit('load-chat-history', chatHistory);
        updateUserList();
    });

    // 2. Admin Action: Generate New Dynamic Passcode
    socket.on('generate-new-code', () => {
        const username = activeSockets[socket.id];
        if (username && registeredUsers[username]?.isAdmin) {
            currentDynamicCode = generateRandomCode();
            io.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    // 3. Admin Action: Kick / Remove User Feature
    socket.on('remove-user-by-admin', (data) => {
        const requestingUser = activeSockets[socket.id];
        
        // केवल एडमिन ही यूज़र को हटा सकता है
        if (requestingUser && registeredUsers[requestingUser]?.isAdmin) {
            const userToKick = data.targetUsername;

            if (registeredUsers[userToKick]) {
                // डेटाबेस से यूज़र हटाएं
                delete registeredUsers[userToKick];

                // अगर यूज़र ऑनलाइन है तो डिस्कनेक्ट करें
                const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === userToKick);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('kicked-by-admin', 'आपको एडमिन द्वारा ऐप से हटा दिया गया है।');
                    delete activeSockets[targetSocketId];
                }

                updateUserList();
            }
        }
    });

    // 4. Send Private Message
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

        chatHistory.push(msgObject);

        const targetSocketId = Object.keys(activeSockets).find(sId => activeSockets[sId] === data.targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive-private-message', msgObject);
        }
        socket.emit('receive-private-message', msgObject);
    });

    // 5. Delete Message (Delete For Everyone)
    socket.on('delete-message', (data) => {
        const { msgId } = data;
        chatHistory = chatHistory.filter(m => m.msgId !== msgId);
        io.emit('message-deleted', { msgId });
    });

    // 6. Typing Status
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
server.listen(PORT, () => console.log(`Quantum Engine active on port ${PORT}`));
