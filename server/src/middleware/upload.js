const multer = require("multer");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — matches the note on the grievance photo-upload step

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(new Error("केवल JPG, PNG, WEBP या HEIC फोटो स्वीकार की जाती है / Only JPG, PNG, WEBP or HEIC photos are accepted"));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 5 },
});

module.exports = upload;
