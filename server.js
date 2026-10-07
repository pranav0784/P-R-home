const express = require('http');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

let users = {}; // username -> { socketId, avatarUrl, isAdmin, isOnline, lastSeen }
let messages = []; // all messages history
let masterPasscode = 'guddu05';
let activePasscode = masterPasscode;

io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('login-attempt', (data) => {
        let { username, inputCode, avatarUrl } = data;
        username = username ? username.trim() : '';

        if (!username) {
            socket.emit('login-failed', 'Username cannot be empty!');
            return;
        }

        const isAdmin = (inputCode === masterPasscode || inputCode === activePasscode);

        // If user already exists, update their socket & online status
        if (users[username]) {
            users[username].socketId = socket.id;
            users[username].isOnline = true;
            if (avatarUrl) users[username].avatarUrl = avatarUrl;
        } else {
            users[username] = {
                socketId: socket.id,
                avatarUrl: avatarUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
                isAdmin: isAdmin,
                isOnline: true,
                lastSeen: null
            };
        }

        currentUsername = username;
        socket.join(username);

        socket.emit('login-success', {
            username: username,
            avatarUrl: users[username].avatarUrl,
            isAdmin: users[username].isAdmin
        });

        socket.emit('load-chat-history', messages);
        broadcastUserList();
    });

    socket.on('update-avatar', (data) => {
        if (users[data.username]) {
            users[data.username].avatarUrl = data.newAvatarUrl;
            broadcastUserList();
        }
    });

    socket.on('generate-new-code', () => {
        const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
        activePasscode = randomCode;
        socket.emit('code-updated', { newCode: activePasscode });
    });

    socket.on('set-custom-code', (data) => {
        if (data.newCode) {
            activePasscode = data.newCode;
            socket.emit('code-updated', { newCode: activePasscode });
        }
    });

    socket.on('remove-user-by-admin', (data) => {
        const target = users[data.targetUsername];
        if (target) {
            io.to(target.socketId).emit('kicked-by-admin', 'You have been removed by the Admin.');
            delete users[data.targetUsername];
            broadcastUserList();
        }
    });

    socket.on('request-user-list', () => {
        broadcastUserList();
    });

    socket.on('send-private-message', (msgObj) => {
        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36.2);
        const fullMsg = {
            msgId: msgId,
            senderName: msgObj.senderName,
            targetName: msgObj.targetName,
            message: msgObj.message || '',
            mediaType: msgObj.mediaType || 'text',
            mediaUrl: msgObj.mediaUrl || null,
            isViewOnce: msgObj.isViewOnce || false,
            isOpened: false,
            replyTo: msgObj.replyTo || null,
            time: msgObj.clientTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
            isDelivered: true,
            isRead: false
        };

        messages.push(fullMsg);

        io.to(msgObj.targetName).emit('receive-private-message', fullMsg);
        io.to(msgObj.senderName).emit('receive-private-message', fullMsg);
    });

    socket.on('mark-messages-read', (data) => {
        messages.forEach(m => {
            if (m.senderName === data.senderName && m.targetName === data.readerName) {
                m.isRead = true;
            }
        });
        io.to(data.senderName).emit('messages-read-update', { readerName: data.readerName });
    });

    socket.on('delete-message-everyone', (data) => {
        messages = messages.filter(m => m.msgId !== data.msgId);
        io.emit('message-deleted-everyone', { msgId: data.msgId });
    });

    socket.on('mark-viewonce-opened', (data) => {
        const msg = messages.find(m => m.msgId === data.msgId);
        if (msg) {
            msg.isOpened = true;
            io.to(msg.senderName).emit('viewonce-opened-update', { msgId: data.msgId });
            io.to(msg.targetName).emit('viewonce-opened-update', { msgId: data.msgId });
        }
    });

    socket.on('typing', (data) => {
        io.to(data.targetName).emit('user-typing-status', { fromUser: currentUsername, isTyping: data.isTyping });
    });

    socket.on('wb-draw-data', (data) => {
        io.to(data.targetName).emit('wb-draw-receive', {
            senderName: currentUsername,
            x0: data.x0, y0: data.y0, x1: data.x1, y1: data.y1,
            color: data.color, size: data.size
        });
    });

    socket.on('wb-clear-data', (data) => {
        io.to(data.targetName).emit('wb-clear-receive', { senderName: currentUsername });
    });

    // WebRTC Call Signaling
    socket.on('call-user', (data) => {
        io.to(data.targetName).emit('incoming-call', { fromUser: currentUsername, offer: data.offer, isVideo: data.isVideo });
    });

    socket.on('call-ringing', (data) => {
        io.to(data.targetName).emit('call-ringing-received');
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
        if (currentUsername && users[currentUsername]) {
            users[currentUsername].isOnline = false;
            users[currentUsername].lastSeen = 'Last seen ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
            broadcastUserList();
        }
    });
});

function broadcastUserList() {
    const list = Object.keys(users).map(name => ({
        username: name,
        avatarUrl: users[name].avatarUrl,
        isAdmin: users[name].isAdmin,
        isOnline: users[name].isOnline,
        lastSeen: users[name].lastSeen
    }));
    io.emit('update-user-list', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
