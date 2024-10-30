class SocketHandler {
  constructor(io, rooms) {
    this.io = io;
    this.rooms = rooms;
    this.setupSocketEvents();
  }

  setupSocketEvents() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      socket.on('join-room', (data) => this.handleJoinRoom(socket, data));
      socket.on('leave-room', (data) => this.handleLeaveRoom(socket, data));
      socket.on('chat message', (data) => this.handleChatMessage(socket, data));
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  handleJoinRoom(socket, { roomId, username }) {
    const room = this.rooms.get(roomId);
    if (!room || !room.authorizedUsers.has(username)) {
      return socket.emit('error', { message: 'Unauthorized' });
    }

    socket.join(roomId);
    room.addUser(socket.id, username);

    socket.emit('room-joined', {
      roomId,
      users: Array.from(room.users.values()).map(u => u.username),
      messages: room.messages
    });

    this.io.to(roomId).emit('user-joined', { 
      username,
      users: Array.from(room.users.values()).map(u => u.username)
    });
  }

  handleLeaveRoom(socket, { roomId, username }) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.leaveRoom(socket, room, roomId, username);
  }

  handleChatMessage(socket, { roomId, message, username }) {
    const room = this.rooms.get(roomId);
    if (!room || !room.authorizedUsers.has(username)) return;

    const messageData = {
      type: 'message',
      content: message,
      username,
      timestamp: new Date().toISOString()
    };

    room.addMessage(messageData);
    this.io.to(roomId).emit('chat message', messageData);
  }

  handleDisconnect(socket) {
    // Find all rooms this socket is in
    for (const [roomId, room] of this.rooms.entries()) {
      const username = room.getUsername(socket.id);
      if (username) {
        room.removeUser(socket.id);
        
        // Notify others in the room
        this.io.to(roomId).emit('user-left', {
          username,
          users: Array.from(room.users.values()).map(u => u.username)
        });

        // Start cleanup timer if room is empty
        if (room.users.size === 0) {
          room.startCleanupTimer(() => this.cleanupRoom(roomId));
        }
      }
    }
    console.log('User disconnected:', socket.id);
  }

  leaveRoom(socket, room, roomId, username) {
    socket.leave(roomId);
    room.removeUser(socket.id);
    
    this.io.to(roomId).emit('user-left', {
      username,
      users: Array.from(room.users.values()).map(u => u.username)
    });
    socket.emit('room-left');

    if (room.users.size === 0) {
      room.startCleanupTimer(() => this.cleanupRoom(roomId));
    }
  }

  cleanupRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.clearCleanupTimeout();
      this.rooms.delete(roomId);
      this.io.emit('room-deleted', { roomId });
    }
  }
}

module.exports = SocketHandler;