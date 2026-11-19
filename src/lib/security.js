'use strict';
const crypto = require('crypto');

// ---------- Password hashing (scrypt, N=2^15) ----------
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A precomputed hash used to equalise timing when the user does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

/** Password policy: 10+ chars, at least 3 of 4 character classes, not a trivial password. */
function passwordProblems(pw, { email = '', name = '' } = {}) {
  const problems = [];
  if (!pw || pw.length < 10) problems.push('at least 10 characters');
  if (pw && pw.length > 128) problems.push('at most 128 characters');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw || '')).length;
  if (classes < 3) problems.push('3 of: lowercase, uppercase, number, symbol');
  const lower = (pw || '').toLowerCase();
  const banned = ['password', 'physio', 'studio', '12345678', 'qwerty', 'nepal', 'kathmandu'];
  if (banned.some((b) => lower.includes(b))) problems.push('no common words (password, physio, nepal…)');
  const local = (email.split('@')[0] || '').toLowerCase();
  if (local.length >= 4 && lower.includes(local)) problems.push('must not contain your email');
  const first = (name.split(' ')[0] || '').toLowerCase();
  if (first.length >= 4 && lower.includes(first)) problems.push('must not contain your name');
  return problems;
}

// ---------- Tokens ----------
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1e6).padStart(6, '0');
}
function verifyTotp(secret, token, window = 1) {
  if (!/^\d{6}$/.test(String(token || ''))) return false;
  const step = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) if (safeEqual(hotp(secret, step + i), token)) return true;
  return false;
}
function totpUri(secret, account, issuer = 'Physio Studio') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- At-rest encryption for secrets (TOTP seeds) ----------
function encKey() {
  const k = process.env.APP_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-only-key';
  return crypto.createHash('sha256').update(k).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
function decrypt(blob) {
  if (!blob) return null;
  const [v, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') return null;
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblems,
  randomToken, sha256, safeEqual,
  newTotpSecret, verifyTotp, totpUri, hotp,
  encrypt, decrypt,
};
