const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const LOGO_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'logos');
if (!fs.existsSync(LOGO_STORAGE_DIR)) fs.mkdirSync(LOGO_STORAGE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_STORAGE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

const logoUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — logos should be small
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted.'));
    }
    cb(null, true);
  },
});

/** POST /api/templates/upload-logo — FR-008: upload custom logos/signature images. */
function handleLogoUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded (field name must be "logo").' });
  }

  // Store a relative path — not an absolute URL with a hostname — so it resolves
  // correctly in every environment (local dev, staging, production).
  const publicUrl = `/uploads/logos/${req.file.filename}`;

  return res.status(201).json({
    success: true,
    message: 'Logo uploaded successfully.',
    data: { url: publicUrl, filename: req.file.filename },
  });
}

// ---------------------------------------------------------------------------
// User profile photos (sidebar user-menu "Change photo") — same disk-storage
// pattern as logos above, but in its own directory since these are personal
// account assets, not template branding assets.
// ---------------------------------------------------------------------------
const AVATAR_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'avatars');
if (!fs.existsSync(AVATAR_STORAGE_DIR)) fs.mkdirSync(AVATAR_STORAGE_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_STORAGE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — profile photos should be small
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted.'));
    }
    cb(null, true);
  },
});

module.exports = {
  logoUpload,
  handleLogoUpload,
  LOGO_STORAGE_DIR,
  avatarUpload,
  AVATAR_STORAGE_DIR,
};
