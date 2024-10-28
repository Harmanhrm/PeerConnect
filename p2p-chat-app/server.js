const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// Set up file storage
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Track active rooms and users
const rooms = new Map();

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// API endpoint to get available rooms
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.keys()).map(roomId => ({
    id: roomId,
    userCount: rooms.get(roomId).size
  }));
  res.json(roomList);
});

// Handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
  if (req.file) {
    const roomId = req.body.roomId;
    io.to(roomId).emit('file-shared', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: '/uploads/' + req.file.filename
    });
    res.json({ success: true });
  }
});

// Handle socket connections
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Handle room creation and joining
  socket.on('create-room', ({ roomId, username }) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    joinRoom(socket, roomId, username);
  });

  socket.on('join-room', ({ roomId, username }) => {
    if (!rooms.has(roomId)) {
      socket.emit('room-not-found');
      return;
    }
    joinRoom(socket, roomId, username);
  });

  function joinRoom(socket, roomId, username) {
    socket.join(roomId);
    rooms.get(roomId).add(username);
    
    // Notify room of new user
    io.to(roomId).emit('user-joined', {
      username,
      users: Array.from(rooms.get(roomId))
    });
    
    // Send current users to new joiner
    socket.emit('room-joined', {
      roomId,
      users: Array.from(rooms.get(roomId))
    });
  }

  socket.on('chat message', ({ roomId, message, username }) => {
    io.to(roomId).emit('chat message', {
      message,
      username,
      timestamp: new Date().toLocaleTimeString()
    });
  });
  
  socket.on('leave-room', ({ roomId, username }) => {
    socket.leave(roomId);
    if (rooms.has(roomId)) {
      rooms.get(roomId).delete(username);
      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
      }
      io.to(roomId).emit('user-left', {
        username,
        users: Array.from(rooms.get(roomId) || [])
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});