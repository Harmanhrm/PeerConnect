const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const FileService = require('./FileService');
const SocketHandler = require('./SocketHandler');
const Room = require('./Room');

// Initialize express app and server
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Initialize storage
const rooms = new Map();
const fileService = new FileService();

// Middleware setup - ORDER IS IMPORTANT
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
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


app.get('/api/rooms', (req, res) => {
    try {
        const roomList = Array.from(rooms.entries()).map(([roomId, room]) => ({
            id: roomId,
            userCount: room.users.size,
            createdAt: room.createdAt,
            lastActivity: room.lastActivity,
            isAuthorized: room.authorizedUsers.has(req.session?.username),
            createdBy: room.createdBy
        }));
        
        res.json(roomList);
    } catch (error) {
        console.error('Error in /api/rooms:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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
      
      const room = new Room(roomId, password, username);
      await room.setPassword(password); 
      room.authorizeUser(username); 
      rooms.set(roomId, room);
      
      res.json({ success: true });
  } catch (error) {
      console.error('Error in POST /api/rooms:', error);
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

      room.authorizeUser(username);
      res.json({ success: true });
  } catch (error) {
      console.error('Error in /api/rooms/verify:', error);
      res.status(500).json({ error: 'Password verification failed' });
  }
});

// File upload endpoint
app.post('/upload', fileService.upload.single('file'), (req, res) => {
    try {
        fileService.handleUpload(req, res, rooms, io);
    } catch (error) {
        console.error('Error in /upload:', error);
        res.status(500).json({ error: 'File upload failed' });
    }
});

// Static file serving - Must come AFTER API routes
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Initialize socket handler
new SocketHandler(io, rooms);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});