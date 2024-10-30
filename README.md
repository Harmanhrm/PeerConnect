# Secure Chat Rooms

A real-time chat application with secure rooms, password protection, and file sharing capabilities built with Node.js, Socket.IO, and Express.
Currently Hosted on render.com

## Features

- 🔐 Password-protected chat rooms
- 👥 Real-time user presence
- 📁 Secure file sharing
- ⏰ Auto-cleanup of inactive rooms
- 🔄 Persistent session management
- 📱 Responsive design

## Technical Requirements

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd secure-chat-rooms
```

2. Install dependencies:
```bash
npm install
```

3. Create required directories:
```bash
mkdir uploads
```

4. Start the server:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Dependencies

```json
{
  "dependencies": {
    "express": "^4.17.1",
    "socket.io": "^4.0.0",
    "multer": "^1.4.5-lts.1",
    "bcrypt": "^5.0.1",
    "cookie-parser": "^1.4.6",
    "express-session": "^1.17.2"
  }
}
```

## Features Explained

### Room Management
- Rooms are password-protected
- Rooms expire after 1 hour of inactivity
- Users must verify password to join rooms
- Room creators automatically get access
- Maximum of 100 messages per room

### File Sharing
- Supports images (JPEG, PNG, GIF), PDFs, and text files
- 5MB file size limit
- Files are stored securely with randomized names
- Files are cleaned up when rooms expire

### Security Features
- Password hashing using bcrypt
- Session-based authentication
- Secure file upload validation
- XSS protection
- CORS configuration

## Room Lifecycle

1. **Creation**: User creates room with password
2. **Active**: Users can join with password
3. **Inactive**: No users for 1 hour
4. **Cleanup**: Room and files deleted automatically

## API Endpoints

### Rooms
- `GET /api/rooms` - List all active rooms
- `POST /api/rooms` - Create new room
- `POST /api/rooms/verify` - Verify room password

### Files
- `POST /upload` - Upload file to room

## Socket Events

### Client -> Server
- `create-room` - Create new room
- `join-room` - Join existing room
- `leave-room` - Leave current room
- `chat message` - Send message in room

### Server -> Client
- `room-joined` - Successfully joined room
- `user-joined` - New user joined room
- `user-left` - User left room
- `chat message` - New message in room
- `file-shared` - File uploaded to room
- `room-deleted` - Room was deleted/expired

## Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment ('development' or 'production')

## Security Considerations

1. **Passwords**:
   - Never stored in plain text
   - Hashed using bcrypt
   - Minimum length enforced

2. **Files**:
   - Type validation
   - Size limits
   - Randomized names
   - Auto-cleanup

3. **Sessions**:
   - Secure cookie settings in production
   - 24-hour expiry
   - CSRF protection

## Known Limitations

1. No persistent storage (in-memory only)
2. Files stored locally
3. Single server setup (no clustering)
4. No user accounts/authentication

## Future Improvements

1. Add database support
2. Implement user accounts
3. Add cloud storage for files
4. Add message encryption
5. Add room admin capabilities
6. Add message search functionality
