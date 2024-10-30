const multer = require('multer');
const path = require('path');
const fs = require('fs');

class FileService {
  constructor() {
    this.createUploadsDir();
    this.upload = this.configureMulter();
  }

  createUploadsDir() {
    if (!fs.existsSync('./uploads')) {
      fs.mkdirSync('./uploads');
    }
  }

  configureMulter() {
    const storage = multer.diskStorage({
      destination: './uploads/',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
      }
    });

    return multer({
      storage,
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
        cb(null, allowedTypes.includes(file.mimetype));
      },
      limits: { fileSize: 5 * 1024 * 1024 }
    });
  }

  handleUpload(req, res, rooms, io) {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { roomId, username } = req.body;
    const room = rooms.get(roomId);

    if (!room || !room.authorizedUsers.has(username)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileInfo = {
      type: 'file',
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: '/uploads/' + req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      username,
      timestamp: new Date().toISOString()
    };

    room.addMessage(fileInfo);
    io.to(roomId).emit('file-shared', fileInfo);
    res.json({ success: true, file: fileInfo });
  }
}
module.exports = FileService;