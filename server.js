const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Static Front-End Files
app.use(express.static(path.join(__dirname, '/')));

// Active Connected Users Tracker
// Format: { socketId: { username, userId } }
const connectedUsers = {};

io.on('connection', (socket) => {
    console.log(`[CONNECTED] User socket connected: ${socket.id}`);

    // 1. User Registration on Login
    socket.on('register-user', ({ username, userId }) => {
        connectedUsers[socket.id] = {
            socketId: socket.id,
            username: username,
            userId: userId || socket.id
        };

        // Broadcast updated online user list to everyone
        io.emit('update-user-list', Object.values(connectedUsers));
        console.log(`[REGISTERED] ${username} (${socket.id})`);
    });

    // 2. One-to-One Private Messaging
    socket.on('send-private-message', ({ targetSocketId, message, senderName, mediaType, mediaUrl }) => {
        const payload = {
            senderId: socket.id,
            senderName: senderName,
            message: message,
            mediaType: mediaType || 'text', // 'text', 'image', 'sticker'
            mediaUrl: mediaUrl || null,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Send to targeted recipient
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('receive-private-message', payload);
        } else {
            socket.emit('error-msg', { text: 'User is offline or unavailable.' });
        }
    });

    // 3. One-to-One Audio / Video Call Signaling (WebRTC)
    socket.on('initiate-call', ({ targetSocketId, offerSignal, callType, callerName }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('incoming-call', {
                fromSocketId: socket.id,
                callerName: callerName,
                callType: callType, // 'audio' or 'video'
                signal: offerSignal
            });
        }
    });

    socket.on('answer-call', ({ targetSocketId, answerSignal }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('call-accepted', {
                signal: answerSignal,
                fromSocketId: socket.id
            });
        }
    });

    socket.on('reject-call', ({ targetSocketId }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('call-rejected', {
                fromSocketId: socket.id
            });
        }
    });

    socket.on('end-call', ({ targetSocketId }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('call-ended');
        }
    });

    // 4. Handle Disconnection
    socket.on('disconnect', () => {
        if (connectedUsers[socket.id]) {
            console.log(`[DISCONNECTED] ${connectedUsers[socket.id].username}`);
            delete connectedUsers[socket.id];
            // Notify remaining users
            io.emit('update-user-list', Object.values(connectedUsers));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` Quantum Server running on port ${PORT}`);
    console.log(`=========================================`);
});
