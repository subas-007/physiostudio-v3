'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../db');

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const CMS_DIR = path.join(UPLOAD_ROOT, 'cms');
fs.mkdirSync(CMS_DIR, { recursive: true });

// Raster images only; SVG is rejected because it can carry script.
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.slice(0, 4).toString() === 'GIF8' },
];

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10, fields: 120 },
});

/** Validate magic bytes and persist with a random name. Returns public path or throws. */
function saveImage(file, userId, alt = '') {
  if (!file) return null;
  const sig = SIGNATURES.find((s) => s.test(file.buffer));
  if (!sig) { const e = new Error('Only JPG, PNG, WEBP or GIF images are allowed.'); e.userMessage = e.message; throw e; }
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${sig.ext}`;
  fs.writeFileSync(path.join(CMS_DIR, name), file.buffer, { mode: 0o640 });
  const publicPath = `/uploads/cms/${name}`;
  db.prepare('INSERT INTO media(path, original_name, mime, size, alt, uploaded_by) VALUES (?,?,?,?,?,?)')
    .run(publicPath, String(file.originalname || '').slice(0, 200), sig.mime, file.size, alt || null, userId || null);
  return publicPath;
}

module.exports = { memory, saveImage, UPLOAD_ROOT };
