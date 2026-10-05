// server.js - Complete Express + Socket.io Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static assets from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Active sockets map
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`[Quantum Core] New Node Connected: ${socket.id}`);

  // Handle User Connection
  socket.on('register_alien_user', (userData) => {
    const username = userData.username || 'Alien-X99';
    connectedUsers.set(socket.id, username);

    socket.emit('system_notification', {
      msg: `Connected to Quantum Cyber Mesh as ${username}`
    });

    io.emit('network_status_update', {
      onlineCount: connectedUsers.size
    });
  });

  // Handle Real-Time Messaging
  socket.on('send_quantum_message', (payload) => {
    const messageData = {
      id: 'msg_' + Date.now(),
      sender: payload.sender || 'Alien-User',
      text: payload.text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: payload.type || 'text',
      attachment: payload.attachment || null,
      linkData: payload.linkData || null
    };

    io.emit('receive_quantum_message', messageData);
  });

  // Handle Typing Indicators
  socket.on('typing_start', () => {
    socket.broadcast.emit('alien_typing', { isTyping: true });
  });

  socket.on('typing_stop', () => {
    socket.broadcast.emit('alien_typing', { isTyping: false });
  });

  // Handle Disconnection
  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    io.emit('network_status_update', {
      onlineCount: connectedUsers.size
    });
    console.log(`[Quantum Core] Node Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🛸 Alien Quantum Server Running On: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
