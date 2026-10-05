const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 1e8, // 100MB
    pingInterval: 3000,
    pingTimeout: 7000,
    cors: { origin: "*" }
});

app.use(express.static(__dirname));

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quantum_db";

let isDbConnected = false;
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB Connected!");
        isDbConnected = true;
    })
    .catch(() => {
        console.log("⚠️ Running in Memory Storage Mode.");
    });

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    avatarUrl: String,
    isAdmin: { type: Boolean, default: false },
    lastSeen: String,
    isKicked: { type: Boolean, default: false }
});

const MessageSchema = new mongoose.Schema({
    msgId: String,
    senderName: String,
    targetName: String,
    message: String,
    mediaType: String,
    mediaUrl: String,
    replyTo: String,
    status: { type: String, default: 'sent' },
    time: String,
    timestamp: { type: Date, default: Date.now }
});

const UserModel = mongoose.model('User', UserSchema);
const MessageModel = mongoose.model('Message', MessageSchema);

const activeSockets = {};   // { socketId: username }
const memoryUsers = {};
let memoryChatHistory = [];

const MASTER_ADMIN_CODE = "pranav123";
let currentDynamicCode = "4829";

// Anti-Sleep Ping for Render
setInterval(() => {
    http.get(`http://localhost:${process.env.PORT || 3000}`, () => {}).on('error', () => {});
}, 200000);

function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function getFormattedTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

io.on('connection', (socket) => {

    socket.on('login-attempt', async (data) => {
        const { username, inputCode, avatarUrl } = data;
        let isAdmin = false;

        let dbUser = isDbConnected ? await UserModel.findOne({ username }) : memoryUsers[username];

        if (dbUser && dbUser.isKicked) {
            return socket.emit('login-failed', 'You were removed by Admin. Please re-authenticate.');
        }

        if (dbUser) {
            isAdmin = dbUser.isAdmin;
        } else {
            if (inputCode === MASTER_ADMIN_CODE) {
                isAdmin = true;
            } else if (inputCode === currentDynamicCode) {
                isAdmin = false;
            } else {
                return socket.emit('login-failed', 'Invalid Passcode!');
            }
        }

        const userAvatar = avatarUrl || (dbUser ? dbUser.avatarUrl : `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`);
        const loginTimeStr = `Last seen today at ${getFormattedTime()}`;

        const userData = { username, avatarUrl: userAvatar, isAdmin, lastSeen: 'Online', isKicked: false };

        if (isDbConnected) {
            await UserModel.findOneAndUpdate({ username }, userData, { upsert: true, new: true });
        } else {
            memoryUsers[username] = userData;
        }

        activeSockets[socket.id] = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            isAdmin: isAdmin,
            avatarUrl: userAvatar
        });

        if (isDbConnected) {
            await MessageModel.updateMany({ targetName: username, status: 'sent' }, { status: 'delivered' });
            const history = await MessageModel.find({
                $or: [{ senderName: username }, { targetName: username }]
            }).sort({ timestamp: 1 }).limit(300);
            socket.emit('load-chat-history', history);
        } else {
            memoryChatHistory.forEach(m => {
                if (m.targetName === username && m.status === 'sent') m.status = 'delivered';
            });
            socket.emit('load-chat-history', memoryChatHistory);
        }

        updateUserList();
    });

    socket.on('generate-new-code', () => {
        const username = activeSockets[socket.id];
        if (username) {
            currentDynamicCode = generateRandomCode();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('set-custom-code', (data) => {
        const username = activeSockets[socket.id];
        if (username && data.newCode) {
            currentDynamicCode = data.newCode.trim();
            socket.emit('code-updated', { newCode: currentDynamicCode });
        }
    });

    socket.on('remove-user-by-admin', async (data) => {
        const requestingUser = activeSockets[socket.id];
        if (requestingUser) {
            const userToKick = data.targetUsername;
            if (isDbConnected) {
                await UserModel.findOneAndUpdate({ username: userToKick }, { isKicked: true });
            } else if (memoryUsers[userToKick]) {
                memoryUsers[userToKick].isKicked = true;
            }

            io.to(userToKick).emit('kicked-by-admin', 'You have been removed by Admin.');
            updateUserList();
        }
    });

    socket.on('update-avatar', async (data) => {
        if (isDbConnected) {
            await UserModel.findOneAndUpdate({ username: data.username }, { avatarUrl: data.newAvatarUrl });
        } else if (memoryUsers[data.username]) {
            memoryUsers[data.username].avatarUrl = data.newAvatarUrl;
        }
        updateUserList();
    });

    socket.on('send-private-message', async (data) => {
        const isTargetOnline = Object.values(activeSockets).includes(data.targetName);

        const msgObject = {
            msgId: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            senderName: data.senderName,
            targetName: data.targetName,
            message: data.message || '',
            mediaType: data.mediaType,
            mediaUrl: data.mediaUrl || null,
            replyTo: data.replyTo || null,
            status: isTargetOnline ? 'delivered' : 'sent',
            time: data.clientTime || getFormattedTime()
        };

        if (isDbConnected) {
            await MessageModel.create(msgObject);
        } else {
            memoryChatHistory.push(msgObject);
        }

        io.to(data.targetName).emit('receive-private-message', msgObject);
        io.to(data.senderName).emit('receive-private-message', msgObject);
    });

    socket.on('mark-messages-read', async (data) => {
        const { readerName, senderName } = data;
        let updatedIds = [];

        if (isDbConnected) {
            const unreadMsgs = await MessageModel.find({ senderName, targetName: readerName, status: { $ne: 'read' } });
            updatedIds = unreadMsgs.map(m => m.msgId);
            await MessageModel.updateMany({ senderName, targetName: readerName }, { status: 'read' });
        } else {
            memoryChatHistory.forEach(m => {
                if (m.senderName === senderName && m.targetName === readerName && m.status !== 'read') {
                    m.status = 'read';
                    updatedIds.push(m.msgId);
                }
            });
        }

        if (updatedIds.length > 0) {
            io.to(senderName).emit('messages-read-status-updated', { readerName, updatedIds });
            io.to(readerName).emit('messages-read-status-updated', { readerName, updatedIds });
        }
    });

    socket.on('delete-message-everyone', async (data) => {
        if (isDbConnected) {
            await MessageModel.deleteOne({ msgId: data.msgId });
        } else {
            memoryChatHistory = memoryChatHistory.filter(m => m.msgId !== data.msgId);
        }
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    socket.on('typing', (data) => {
        io.to(data.targetName).emit('user-typing-status', { fromUser: activeSockets[socket.id], isTyping: data.isTyping });
    });

    // --- Advanced WebRTC Signaling ---
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

    socket.on('disconnect', async () => {
        const username = activeSockets[socket.id];
        if (username) {
            const timeStr = `Last seen today at ${getFormattedTime()}`;

            if (isDbConnected) {
                await UserModel.findOneAndUpdate({ username }, { lastSeen: timeStr });
            } else if (memoryUsers[username]) {
                memoryUsers[username].lastSeen = timeStr;
            }

            delete activeSockets[socket.id];
            updateUserList();
        }
    });
});

async function updateUserList() {
    let rawList = [];
    if (isDbConnected) {
        rawList = await UserModel.find({ isKicked: false }).lean();
    } else {
        rawList = Object.values(memoryUsers).filter(u => !u.isKicked);
    }

    const list = rawList.map(user => ({
        ...user,
        isOnline: Object.values(activeSockets).includes(user.username)
    }));

    io.emit('update-user-list', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));
