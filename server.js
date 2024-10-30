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
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const session = require('express-session');

// Initialize express middleware
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// Secure file upload configuration
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function(req, file, cb) {
    // Add timestamp to prevent filename collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Whitelist of allowed file types
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, PDFs, and text files are allowed.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Enhanced Room class with password protection
class Room {
  constructor(id, passwordHash, createdBy) {
    this.id = id;
    this.passwordHash = passwordHash;
    this.createdBy = createdBy;
    this.users = new Map(); // socketId -> {username, avatar}
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.cleanupTimeout = null;
    this.authorizedUsers = new Set(); // Set of usernames who know the password
  }

  async verifyPassword(password) {
    return await bcrypt.compare(password, this.passwordHash);
  }

  addUser(socketId, username, avatar = null) {
    this.users.set(socketId, { username, avatar });
    this.updateActivity();
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }
  }

  removeUser(socketId) {
    const userData = this.users.get(socketId);
    this.users.delete(socketId);
    this.updateActivity();
    return userData?.username;
  }

  authorizeUser(username) {
    this.authorizedUsers.add(username);
  }

  isUserAuthorized(username) {
    return this.authorizedUsers.has(username);
  }

  updateActivity() {
    this.lastActivity = new Date();
  }

  getUsername(socketId) {
    return this.users.get(socketId)?.username;
  }

  getUserCount() {
    return this.users.size;
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(user => user.username);
  }

  addMessage(message) {
    this.messages.push({
      ...message,
      timestamp: new Date()
    });
    this.updateActivity();
    // Keep only last 100 messages
    if (this.messages.length > 100) {
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
    }, 3600000); // 1 hour
  }

  cleanup() {
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
    }
  }
}

// Room and session management
const rooms = new Map(); // roomId -> Room instance
const userSessions = new Map(); // sessionId -> {username, authorizedRooms}

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// API Routes
app.get('/api/rooms', (req, res) => {
  const userSession = userSessions.get(req.sessionID);
  const authorizedRooms = userSession?.authorizedRooms || [];
  
  const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
    id: roomId,
    userCount: room.getUserCount(),
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    isAuthorized: authorizedRooms.includes(roomId),
    createdBy: room.createdBy
  }));
  
  res.json(roomList);
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { roomId, password, username } = req.body;
    
    if (!roomId || !password || !username) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (rooms.has(roomId)) {
      return res.status(400).json({ error: 'Room already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const room = new Room(roomId, passwordHash, username);
    rooms.set(roomId, room);
    
    // Authorize creator
    room.authorizeUser(username);
    
    // Update session
    let userSession = userSessions.get(req.sessionID);
    if (!userSession) {
      userSession = { username, authorizedRooms: [] };
      userSessions.set(req.sessionID, userSession);
    }
    userSession.authorizedRooms.push(roomId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.post('/api/rooms/verify', async (req, res) => {
  try {
    const { roomId, password, username } = req.body;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const isValid = await room.verifyPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Authorize user
    room.authorizeUser(username);
    
    // Update session
    let userSession = userSessions.get(req.sessionID);
    if (!userSession) {
      userSession = { username, authorizedRooms: [] };
      userSessions.set(req.sessionID, userSession);
    }
    if (!userSession.authorizedRooms.includes(roomId)) {
      userSession.authorizedRooms.push(roomId);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Password verification failed' });
  }
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const roomId = req.body.roomId;
    const username = req.body.username;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (!room.isUserAuthorized(username)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileInfo = {
      type: 'file',
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: '/uploads/' + req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      username: username,
      timestamp: new Date().toISOString()
    };
    
    room.addMessage(fileInfo);
    io.to(roomId).emit('file-shared', fileInfo);
    res.json({ success: true, file: fileInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('create-room', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    if (!room || !room.isUserAuthorized(username)) {
      socket.emit('error', { message: 'Unauthorized to join room' });
      return;
    }
    handleJoinRoom(socket, roomId, username);
  });

  socket.on('join-room', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    if (!room || !room.isUserAuthorized(username)) {
      socket.emit('error', { message: 'Unauthorized to join room' });
      return;
    }
    handleJoinRoom(socket, roomId, username);
  });

  socket.on('leave-room', ({ roomId, username }) => {
    handleLeaveRoom(socket, roomId, username);
  });

  socket.on('chat message', ({ roomId, message, username }) => {
    const room = rooms.get(roomId);
    if (!room || !room.isUserAuthorized(username)) {
      return;
    }

    const messageData = {
      type: 'message',
      content: message,
      username: username,
      timestamp: new Date().toISOString()
    };

    room.addMessage(messageData);
    io.to(roomId).emit('chat message', messageData);
  });

  socket.on('disconnect', () => {
    socket.rooms.forEach(roomId => {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        const username = room.removeUser(socket.id);
        if (username) {
          io.to(roomId).emit('user-left', {
            username,
            users: room.getAllUsers()
          });
          
          if (room.getUserCount() === 0) {
            room.startCleanupTimer(cleanupRoom);
          }
        }
      }
    });
    console.log('User disconnected:', socket.id);
  });
});

// Helper functions
function handleJoinRoom(socket, roomId, username) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.join(roomId);
  room.addUser(socket.id, username);

  socket.emit('room-joined', {
    roomId,
    users: room.getAllUsers(),
    messages: room.getRecentMessages()
  });

  io.to(roomId).emit('user-joined', {
    username,
    users: room.getAllUsers()
  });
}

function handleLeaveRoom(socket, roomId, username) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.leave(roomId);
  room.removeUser(socket.id);
  
  io.to(roomId).emit('user-left', {
    username,
    users: room.getAllUsers()
  });
  
  if (room.getUserCount() === 0) {
    room.startCleanupTimer(cleanupRoom);
  }
  
  socket.emit('room-left');
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.cleanup();
    rooms.delete(roomId);
    io.emit('room-deleted', { roomId });
    
    // Clean up uploaded files
    const uploadsDir = './uploads';
    fs.readdir(uploadsDir, (err, files) => {
      if (err) return;
      files.forEach(file => {
        fs.unlink(path.join(uploadsDir, file), err => {
          if (err) console.error('Error deleting file:', err);
        });
      });
    });
  }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});