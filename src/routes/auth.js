'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSetting } = require('../db');
const sec = require('../lib/security');
const { audit, STAFF_ROLES } = require('../lib/middleware');
const { clean, isEmail, isPhone, isDate } = require('../lib/util');
const { createPatient } = require('../lib/booking');
const { sendStaffEmail } = require('../lib/notify');

const router = express.Router();
const limiter = (max, windowMin) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).render('public/error', { title: 'Too many attempts', message: 'Too many attempts from your network. Please wait a few minutes and try again.' }),
});
const loginLimiter = limiter(Number(process.env.LOGIN_RATE_LIMIT || 10), 15);
const mfaLimiter = limiter(10, 15);
const registerLimiter = limiter(5, 60);
const resetLimiter = limiter(5, 60);

const MAX_FAILED = 5;
const LOCK_MIN = 15;

function safeReturn(url, fallback) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : fallback;
}
function homeFor(user) { return STAFF_ROLES.includes(user.role) ? '/admin' : '/portal'; }

function completeLogin(req, res, user, msg) {
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = user.id;
    req.session.mfaPassed = true;
    req.session.lastSeen = Date.now();
    if (msg) req.session.flash = [{ type: 'success', msg }];
    db.prepare("UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=datetime('now','localtime') WHERE id=?").run(user.id);
    req.user = user;
    audit(req, 'auth.login_success', 'user', user.id);
    const needs2fa = STAFF_ROLES.includes(user.role) && !user.totp_enabled && getSetting('require_staff_2fa', '1') === '1';
    req.session.save(() => res.redirect(needs2fa ? '/admin/account/2fa?required=1' : safeReturn(returnTo, homeFor(user))));
  });
}

// ---------- Login ----------
router.get(['/login', '/staff/login'], (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  res.render('auth/login', { title: 'Sign in', staff: req.path.startsWith('/staff'), email: '' });
});

router.post(['/login', '/staff/login'], loginLimiter, (req, res) => {
  const email = clean(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || '').slice(0, 200);
  const staff = req.path.startsWith('/staff');
  const fail = (msg = 'Incorrect email or password.') => res.status(401).render('auth/login', { title: 'Sign in', staff, email, error: msg });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) { sec.verifyPassword(password, sec.DUMMY_HASH); audit(req, 'auth.login_failed', null, null, { email }); return fail(); }
  // Compare inside SQLite: locked_until is written with SQLite's localtime, so JS Date parsing can disagree with it.
  const locked = user.locked_until && db.prepare("SELECT ? > datetime('now','localtime') AS locked").get(user.locked_until).locked === 1;
  if (locked) {
    audit(req, 'auth.login_locked', 'user', user.id);
    return fail(`Account temporarily locked after repeated failures. Try again after ${LOCK_MIN} minutes or reset your password.`);
  }
  if (!user.is_active || !sec.verifyPassword(password, user.password_hash)) {
    const n = user.failed_logins + 1;
    if (n >= MAX_FAILED) {
      db.prepare(`UPDATE users SET failed_logins=0, locked_until=datetime('now','localtime','+${LOCK_MIN} minutes') WHERE id=?`).run(user.id);
      audit(req, 'auth.account_locked', 'user', user.id);
    } else db.prepare('UPDATE users SET failed_logins=? WHERE id=?').run(n, user.id);
    audit(req, 'auth.login_failed', 'user', user.id);
    return fail();
  }
  if (user.totp_enabled) {
    const rt = req.session.returnTo;
    req.session.regenerate(() => {
      req.session.pendingUserId = user.id;
      req.session.pendingAt = Date.now();
      req.session.returnTo = safeReturn(rt, null);
      req.session.save(() => res.redirect('/login/2fa'));
    });
    return;
  }
  completeLogin(req, res, user);
});

router.get('/login/2fa', (req, res) => {
  if (!req.session.pendingUserId) return res.redirect('/login');
  res.render('auth/2fa', { title: 'Two-factor verification' });
});
router.post('/login/2fa', mfaLimiter, (req, res) => {
  const id = req.session.pendingUserId;
  if (!id || Date.now() - (req.session.pendingAt || 0) > 5 * 60 * 1000) { req.flash('error', 'Verification timed out. Please sign in again.'); return res.redirect('/login'); }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const secret = user && sec.decrypt(user.totp_secret);
  if (!secret || !sec.verifyTotp(secret, clean(req.body.code, 10).replace(/\s/g, ''))) {
    req.user = user; audit(req, 'auth.mfa_failed', 'user', id); req.user = null;
    return res.status(401).render('auth/2fa', { title: 'Two-factor verification', error: 'That code is not valid. Check your authenticator app and try again.' });
  }
  completeLogin(req, res, user);
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  req.session.destroy(() => { res.clearCookie(process.env.NODE_ENV === 'production' ? '__Host-ps.sid' : 'ps.sid'); res.redirect('/'); });
});

// ---------- Patient self-registration ----------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  res.render('auth/register', { title: 'Create your patient account', f: {} });
});
router.post('/register', registerLimiter, (req, res) => {
  const f = {
    full_name: clean(req.body.full_name, 120), email: clean(req.body.email, 190).toLowerCase(), phone: clean(req.body.phone, 20),
    gender: clean(req.body.gender, 20), date_of_birth: clean(req.body.date_of_birth, 10), whatsapp: clean(req.body.whatsapp, 20),
  };
  const pw = String(req.body.password || '');
  const errors = [];
  if (f.full_name.length < 2) errors.push('Enter your full name.');
  if (!isEmail(f.email)) errors.push('Enter a valid email address.');
  if (!isPhone(f.phone)) errors.push('Enter a valid mobile number.');
  if (f.date_of_birth && !isDate(f.date_of_birth)) errors.push('Enter a valid date of birth.');
  if (pw !== req.body.password2) errors.push('Passwords do not match.');
  const pp = sec.passwordProblems(pw, { email: f.email, name: f.full_name });
  if (pp.length) errors.push('Password needs: ' + pp.join(', ') + '.');
  if (!req.body.consent_treatment) errors.push('Please accept the privacy notice to continue.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) errors.push('An account with this email already exists. Try signing in or resetting your password.');
  if (errors.length) return res.status(400).render('auth/register', { title: 'Create your patient account', f, errors });

  const tx = db.transaction(() => {
    const uid = db.prepare("INSERT INTO users(email, phone, full_name, password_hash, role) VALUES (?,?,?,?, 'patient')").run(f.email, f.phone, f.full_name, sec.hashPassword(pw)).lastInsertRowid;
    // Link to an existing patient record (same name + phone, not yet linked) or create a new one.
    const digits = f.phone.replace(/\D/g, '').slice(-10);
    const existing = db.prepare("SELECT id FROM patients WHERE user_id IS NULL AND lower(full_name)=lower(?) AND substr(replace(replace(replace(phone,'+',''),'-',''),' ',''), -10) = ?").get(f.full_name, digits);
    if (existing) db.prepare("UPDATE patients SET user_id=?, email=COALESCE(email, ?), consent_communication=?, updated_at=datetime('now','localtime') WHERE id=?").run(uid, f.email, req.body.consent_communication ? 1 : 0, existing.id);
    else createPatient({ ...f, user_id: uid, consent_treatment: 1, consent_communication: !!req.body.consent_communication });
    return db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  });
  const user = tx();
  req.user = user; audit(req, 'auth.register', 'user', user.id);
  completeLogin(req, res, user, 'Welcome! Your patient account is ready.');
});

// ---------- Password reset ----------
router.get('/forgot', (req, res) => res.render('auth/forgot', { title: 'Reset password' }));
router.post('/forgot', resetLimiter, async (req, res) => {
  const email = clean(req.body.email, 190).toLowerCase();
  const user = isEmail(email) && db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email);
  if (user) {
    const token = sec.randomToken(32);
    db.prepare("INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES (?,?, datetime('now','localtime','+30 minutes'))").run(user.id, sec.sha256(token));
    const link = `${(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/reset/${token}`;
    await sendStaffEmail(user.email, 'Reset your Physio Studio password', `Hello ${user.full_name},\n\nUse this link within 30 minutes to set a new password:\n${link}\n\nIf you did not request this, ignore this email – your password will not change.`);
    if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) console.log(`[dev] password reset link for ${email}: ${link}`);
    req.user = user; audit(req, 'auth.reset_requested', 'user', user.id); req.user = null;
  }
  // Same response either way (no account enumeration).
  res.render('auth/forgot', { title: 'Reset password', sent: true });
});

function findReset(token) {
  return db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now','localtime')").get(sec.sha256(String(token || '')));
}
router.get('/reset/:token', (req, res) => {
  if (!findReset(req.params.token)) return res.render('public/error', { title: 'Link expired', message: 'This reset link is invalid or has expired. Please request a new one.' });
  res.render('auth/reset', { title: 'Choose a new password', token: req.params.token });
});
router.post('/reset/:token', resetLimiter, (req, res) => {
  const r = findReset(req.params.token);
  if (!r) return res.render('public/error', { title: 'Link expired', message: 'This reset link is invalid or has expired.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id);
  const pw = String(req.body.password || '');
  const pp = sec.passwordProblems(pw, { email: user.email, name: user.full_name });
  if (pw !== req.body.password2) pp.push('passwords must match');
  if (pp.length) return res.status(400).render('auth/reset', { title: 'Choose a new password', token: req.params.token, error: 'Password needs: ' + pp.join(', ') + '.' });
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL, must_change_password=0, updated_at=datetime('now','localtime') WHERE id=?").run(sec.hashPassword(pw), user.id);
    db.prepare("UPDATE password_resets SET used_at=datetime('now','localtime') WHERE user_id=? AND used_at IS NULL").run(user.id);
    // Invalidate every existing session for this user.
    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(user.id);
  })();
  req.user = user; audit(req, 'auth.password_reset', 'user', user.id); req.user = null;
  req.flash('success', 'Password updated. Please sign in.');
  res.redirect(STAFF_ROLES.includes(user.role) ? '/staff/login' : '/login');
});

module.exports = router;
