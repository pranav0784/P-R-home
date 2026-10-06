const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

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

// JSON File Persistence Paths
const USERS_FILE = path.join(__dirname, 'users.json');
const CHAT_FILE = path.join(__dirname, 'messages.json');

// Helper Functions to Load/Save Data
function loadJSON(filepath, defaultValue) {
    try {
        if (fs.existsSync(filepath)) {
            const data = fs.readFileSync(filepath, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error(`Error reading ${filepath}:`, err);
    }
    return defaultValue;
}

function saveJSON(filepath, data) {
    try {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error(`Error writing ${filepath}:`, err);
    }
}

// Data Structures
let registeredUsers = loadJSON(USERS_FILE, {}); // { username: { username, avatarUrl, isAdmin, lastSeen } }
let chatHistory = loadJSON(CHAT_FILE, []);       // Message history
const activeSockets = {};                       // { socketId: username }

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
        
        if (!username) return socket.emit('login-failed', 'Username ज़रूरी है!');

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
            if (avatarUrl) registeredUsers[username].avatarUrl = avatarUrl;
            registeredUsers[username].lastSeen = 'Online';
        }

        saveJSON(USERS_FILE, registeredUsers);

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
            saveJSON(USERS_FILE, registeredUsers);
            
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
            saveJSON(USERS_FILE, registeredUsers);
            updateUserList();
        }
    });

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
        saveJSON(CHAT_FILE, chatHistory);

        io.to(data.targetName).emit('receive-private-message', msgObject);
        if (data.senderName !== data.targetName) {
            io.to(data.senderName).emit('receive-private-message', msgObject);
        }
    });

    socket.on('mark-messages-read', (data) => {
        let changed = false;
        chatHistory.forEach(m => {
            if (m.senderName === data.senderName && m.targetName === data.readerName && !m.isRead) {
                m.isRead = true;
                changed = true;
            }
        });
        if (changed) {
            saveJSON(CHAT_FILE, chatHistory);
            io.to(data.senderName).emit('messages-read-update', { readerName: data.readerName });
        }
    });

    socket.on('mark-viewonce-opened', (data) => {
        const msg = chatHistory.find(m => m.msgId === data.msgId);
        if (msg) {
            msg.isOpened = true;
            saveJSON(CHAT_FILE, chatHistory);
            io.to(msg.senderName).emit('viewonce-opened-update', { msgId: data.msgId });
            io.to(msg.targetName).emit('viewonce-opened-update', { msgId: data.msgId });
        }
    });

    socket.on('delete-message-everyone', (data) => {
        chatHistory = chatHistory.filter(m => m.msgId !== data.msgId);
        saveJSON(CHAT_FILE, chatHistory);
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    socket.on('clear-chat-history', (data) => {
        const { user1, user2 } = data;
        chatHistory = chatHistory.filter(m => 
            !((m.senderName === user1 && m.targetName === user2) || 
              (m.senderName === user2 && m.targetName === user1))
        );
        saveJSON(CHAT_FILE, chatHistory);
        io.to(user1).emit('load-chat-history', chatHistory);
        io.to(user2).emit('load-chat-history', chatHistory);
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

    socket.on('disconnect', () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            if (registeredUsers[username]) {
                registeredUsers[username].lastSeen = `today at ${timeStr}`;
                saveJSON(USERS_FILE, registeredUsers);
            }
            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Active on Port ${PORT}`));
