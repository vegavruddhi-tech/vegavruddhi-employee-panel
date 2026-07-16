const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let resource_type = 'image';

    if (
      file.mimetype === 'application/pdf' ||
      file.mimetype.includes('officedocument')
    ) {
      resource_type = 'raw'; // for CV
    }

    return {
      folder: 'employee_uploads',
      resource_type,
    };
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 3.5 * 1024 * 1024 // 3.5 MB limit per file
  },
  fileFilter: (req, file, cb) => {
    if (!file || !file.originalname) {
      return cb(new Error('Empty file'), false);
    }
    cb(null, true);
  }
});

module.exports = upload;