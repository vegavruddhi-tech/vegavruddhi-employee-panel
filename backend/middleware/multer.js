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

const upload = multer({ storage });  // 🔥 THIS LINE WAS MISSING

module.exports = upload;