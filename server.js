const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// स्टेटिक फाइल्स (HTML, CSS आदि) सर्व करने के लिए
app.use(express.static('public')); // अगर आपकी एचटीएमएल public फोल्डर में है, नहीं तो इसे हटा सकते हैं या सीधे root रख सकते हैं

// कनेक्टेड यूजर्स को स्टोर करने के लिए ऑब्जेक्ट
const connectedUsers = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // यूजर रजिस्ट्रेशन
    socket.on('register-user', (data) => {
        connectedUsers[socket.id] = {
            socketId: socket.id,
            username: data.username
        };
        // सभी को अपडेटेड यूजर लिस्ट भेजें
        updateUserList();
    });

    // प्राइवेट मैसेज भेजना
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

    // टाइपिंग स्टेटस
    socket.on('typing', (data) => {
        const { targetSocketId, isTyping } = data;
        io.to(targetSocketId).emit('user-typing', {
            fromSocketId: socket.id,
            isTyping: isTyping
        });
    });

    // कॉल इनिशिएट करना (WebRTC सिगनलिंग के लिए)
    socket.on('initiate-call', (data) => {
        const { targetSocketId, callType, callerName } = data;
        io.to(targetSocketId).emit('incoming-call', {
            callerSocketId: socket.id,
            callType: callType,
            callerName: callerName
        });
    });

    // कॉल एंड करना
    socket.on('end-call', (data) => {
        const { targetSocketId } = data;
        io.to(targetSocketId).emit('call-ended');
    });

    // यूजर के डिसकनेक्ट होने पर
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
