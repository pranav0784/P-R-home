const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '/')));

const connectedUsers = {};

io.on('connection', (socket) => {
    // User Registration
    socket.on('register-user', ({ username }) => {
        connectedUsers[socket.id] = { socketId: socket.id, username };
        io.emit('update-user-list', Object.values(connectedUsers));
    });

    // Private Messaging
    socket.on('send-private-message', ({ targetSocketId, message, senderName, mediaType, mediaUrl }) => {
        const payload = {
            senderId: socket.id,
            senderName,
            message,
            mediaType: mediaType || 'text',
            mediaUrl: mediaUrl || null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('receive-private-message', payload);
        }
    });

    // Typing Status Event
    socket.on('typing', ({ targetSocketId, isTyping }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('user-typing', { fromSocketId: socket.id, isTyping });
        }
    });

    // Call Signaling
    socket.on('initiate-call', ({ targetSocketId, callType, callerName }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('incoming-call', { fromSocketId: socket.id, callerName, callType });
        }
    });

    socket.on('end-call', ({ targetSocketId }) => {
        if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
            io.to(targetSocketId).emit('call-ended');
        }
    });

    socket.on('disconnect', () => {
        delete connectedUsers[socket.id];
        io.emit('update-user-list', Object.values(connectedUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
