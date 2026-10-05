const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const connectedUsers = {};
const MASTER_ADMIN_CODE = "pranav123"; // मुख्य मास्टर एडमिन पासवर्ड (तुम्हारा परमानेंट कोड)
let currentRoomCode = "1234";          // डायनेमिक रूम कोड जिसे एडमिन बदल सकता है

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // लॉगिन और कोड वेरिफिकेशन
    socket.on('login-attempt', (data) => {
        const { username, inputCode } = data;
        let isAdmin = false;

        // अगर मास्टर एडमिन कोड डाला है तो एडमिन बन जाएगा
        if (inputCode === MASTER_ADMIN_CODE) {
            isAdmin = true;
        } 
        // अगर करंट एक्टिव रूम कोड डाला है तो नॉर्मल यूजर के रूप में अंदर आ जाएगा
        else if (inputCode === currentRoomCode) {
            isAdmin = false;
        } 
        else {
            return socket.emit('login-failed', 'Incorrect Code! Please enter the correct admin or room code.');
        }

        connectedUsers[socket.id] = {
            socketId: socket.id,
            username: username,
            isAdmin: isAdmin
        };

        socket.emit('login-success', { isAdmin });
        updateUserList();
    });

    // एडमिन द्वारा नया रूम कोड सेट करना
    socket.on('set-room-code', (data) => {
        if (connectedUsers[socket.id] && connectedUsers[socket.id].isAdmin) {
            if (data.newCode) {
                currentRoomCode = data.newCode;
                console.log(`Room code updated to: ${currentRoomCode}`);
            }
        }
    });

    socket.on('send-private-message', (data) => {
        const { targetSocketId, message, senderName, mediaType, mediaUrl } = data;
        io.to(targetSocketId).emit('receive-private-message', {
            senderName: senderName,
            message: message,
            mediaType: mediaType,
            mediaUrl: mediaUrl,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('typing', (data) => {
        const { targetSocketId, isTyping } = data;
        io.to(targetSocketId).emit('user-typing', {
            fromSocketId: socket.id,
            isTyping: isTyping
        });
    });

    socket.on('initiate-call', (data) => {
        const { targetSocketId, callType, callerName } = data;
        io.to(targetSocketId).emit('incoming-call', {
            callerSocketId: socket.id,
            callType: callType,
            callerName: callerName
        });
    });

    socket.on('end-call', (data) => {
        const { targetSocketId } = data;
        io.to(targetSocketId).emit('call-ended');
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete connectedUsers[socket.id];
        updateUserList();
    });
});

function updateUserList() {
    const usersArray = Object.values(connectedUsers);
    io.emit('update-user-list', usersArray);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
