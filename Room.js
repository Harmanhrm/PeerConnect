const bcrypt = require('bcrypt');

class Room {
  constructor(id, password, createdBy) {
    this.id = id;
    this.createdBy = createdBy;
    this.users = new Map(); // socketId -> {username}
    this.messages = [];
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.cleanupTimeout = null;
    this.authorizedUsers = new Set();
    
    // Hash the password when creating the room
    this.setPassword(password);
  }

  async setPassword(password) {
    this.passwordHash = await bcrypt.hash(password, 10);
  }

  async verifyPassword(password) {
    return await bcrypt.compare(password, this.passwordHash);
  }

  authorizeUser(username) {
    if (!username) return false;
    this.authorizedUsers.add(username);
    return true;
  }

  isUserAuthorized(username) {
    return this.authorizedUsers.has(username);
  }

  addUser(socketId, username) {
    if (!this.isUserAuthorized(username)) return false;
    this.users.set(socketId, { username });
    this.updateActivity();
    this.clearCleanupTimeout();
    return true;
  }

  removeUser(socketId) {
    const userData = this.users.get(socketId);
    this.users.delete(socketId);
    this.updateActivity();
    return userData?.username;
  }

  getUsername(socketId) {
    return this.users.get(socketId)?.username;
  }

  updateActivity() {
    this.lastActivity = new Date();
  }

  addMessage(message) {
    this.messages.push({ ...message, timestamp: new Date() });
    this.updateActivity();
    if (this.messages.length > 100) this.messages.shift();
  }

  getMessages() {
    return this.messages;
  }

  getUserCount() {
    return this.users.size;
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(user => user.username);
  }

  clearCleanupTimeout() {
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }
  }

  startCleanupTimer(callback) {
    this.clearCleanupTimeout();
    this.cleanupTimeout = setTimeout(() => {
      if (this.users.size === 0) callback(this.id);
    }, 3600000); // 1 hour
  }

  cleanup() {
    this.clearCleanupTimeout();
    this.users.clear();
    this.messages = [];
    this.authorizedUsers.clear();
  }
}

module.exports = Room;