const path = require('path');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ALLOWED_PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ALLOWED_CV_EXTS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);
const ALLOWED_CV_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]);

const DANGEROUS_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.php', '.phtml', '.js', '.html', '.htm', '.svg', '.vbs', '.jar', '.dll'
]);

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

    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    // Strictly reject any dangerous executable, script, or SVG/HTML formats
    if (DANGEROUS_EXTS.has(ext) || mime.includes('javascript') || mime.includes('html') || mime.includes('svg')) {
      return cb(new Error('Invalid file: Executables and scripts are strictly forbidden.'), false);
    }

    if (file.fieldname === 'photo') {
      if (!ALLOWED_PHOTO_EXTS.has(ext) || !ALLOWED_PHOTO_MIMES.has(mime)) {
        return cb(new Error('Invalid photo format. Only JPG, JPEG, PNG, and WEBP images are allowed.'), false);
      }
      return cb(null, true);
    }

    if (file.fieldname === 'cv') {
      if (!ALLOWED_CV_EXTS.has(ext) || !ALLOWED_CV_MIMES.has(mime)) {
        return cb(new Error('Invalid CV format. Only PDF, DOC, DOCX, and image documents are allowed.'), false);
      }
      return cb(null, true);
    }

    // Default fallback for other file fields: only allow safe images
    if (!ALLOWED_PHOTO_EXTS.has(ext) || !ALLOWED_PHOTO_MIMES.has(mime)) {
      return cb(new Error('Invalid file format. Only safe image files (JPG, PNG, WEBP) are allowed.'), false);
    }

    cb(null, true);
  }
});

module.exports = upload;