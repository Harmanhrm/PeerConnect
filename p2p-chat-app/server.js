const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// Set up file storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Improved room management with auto-cleanup
class Room {
  constructor(id) {
    this.id = id;
    this.users = new Map(); // socketId -> username
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.cleanupTimeout = null;
  }

  addUser(socketId, username) {
    this.users.set(socketId, username);
    this.updateActivity();
    // Clear any existing cleanup timeout
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }
  }

  removeUser(socketId) {
    const username = this.users.get(socketId);
    this.users.delete(socketId);
    this.updateActivity();
    return username;
  }

  updateActivity() {
    this.lastActivity = new Date();
  }

  getUsername(socketId) {
    return this.users.get(socketId);
  }

  getUserCount() {
    return this.users.size;
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  addMessage(message) {
    this.messages.push(message);
    this.updateActivity();
    if (this.messages.length > 50) {
      this.messages.shift();
    }
  }

  getRecentMessages() {
    return this.messages;
  }

  startCleanupTimer(callback) {
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
    }
    this.cleanupTimeout = setTimeout(() => {
      if (this.users.size === 0) {
        callback(this.id);
      }
    }, 60000); // 1 minute
  }

  cleanup() {
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
    }
  }
}

// Track active rooms
const rooms = new Map(); // roomId -> Room instance

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// API endpoint to get available rooms
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    id: roomId,
    userCount: room.getUserCount(),
    createdAt: room.createdAt,
    lastActivity: room.lastActivity
  }));
  res.json(roomList);
});

// Handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    const roomId = req.body.roomId;
    const fileInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: '/uploads/' + req.file.filename,
      timestamp: new Date().toISOString()
    };
    
    if (rooms.has(roomId)) {
      rooms.get(roomId).addMessage({
        type: 'file',
        ...fileInfo
      });
      io.to(roomId).emit('file-shared', fileInfo);
    }
    res.json({ success: true });
  }
});

// Function to handle room cleanup
function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.cleanup();
    rooms.delete(roomId);
    io.emit('room-deleted', { roomId });
    console.log(`Room ${roomId} has been cleaned up due to inactivity`);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('create-room', ({ roomId, username }) => {
    // Prevent username being used as room ID
    if (!roomId || roomId.trim() === username.trim()) {
      socket.emit('creation-error', { message: 'Please enter a valid room ID different from your username' });
      return;
    }
    
    if (rooms.has(roomId)) {
      socket.emit('creation-error', { message: 'Room ID already exists' });
      return;
    }
    
    const room = new Room(roomId);
    rooms.set(roomId, room);
    handleJoinRoom(socket, roomId, username);
  });

  socket.on('join-room', ({ roomId, username }) => {
    if (!rooms.has(roomId)) {
      socket.emit('room-not-found');
      return;
    }
    handleJoinRoom(socket, roomId, username);
  });

  socket.on('leave-room', ({ roomId, username }) => {
    handleLeaveRoom(socket, roomId, username);
  });

  socket.on('chat message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (room) {
      const username = room.getUsername(socket.id);
      const messageData = {
        type: 'message',
        message,
        username,
        timestamp: new Date().toLocaleTimeString()
      };
      room.addMessage(messageData);
      io.to(roomId).emit('chat message', messageData);
    }
  });

  socket.on('disconnect', () => {
    // Handle disconnection for all rooms this socket was in
    socket.rooms.forEach(roomId => {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        const username = room.removeUser(socket.id);
        if (username) {
          io.to(roomId).emit('user-left', {
            username,
            users: room.getAllUsers()
          });
          
          // Start cleanup timer if room is empty
          if (room.getUserCount() === 0) {
            room.startCleanupTimer(cleanupRoom);
          }
        }
      }
    });
    console.log('User disconnected:', socket.id);
  });
});

function handleJoinRoom(socket, roomId, username) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.join(roomId);
  room.addUser(socket.id, username);

  socket.emit('recent messages', room.getRecentMessages());
  
  io.to(roomId).emit('user-joined', {
    username,
    users: room.getAllUsers()
  });
  
  socket.emit('room-joined', {
    roomId,
    users: room.getAllUsers()
  });
}

function handleLeaveRoom(socket, roomId, username) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (!username) return;

  socket.leave(roomId);
  
  io.to(roomId).emit('user-left', {
    username,
    users: room.getAllUsers()
  });
  
  // Start cleanup timer if room is empty
  if (room.getUserCount() === 0) {
    room.startCleanupTimer(cleanupRoom);
  }
  
  socket.emit('room-left');
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});