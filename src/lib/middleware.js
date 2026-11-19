'use strict';
const { db } = require('../db');
const { randomToken, safeEqual } = require('./security');

// ---------- Audit ----------
function audit(req, action, entity = null, entityId = null, detail = null) {
  const u = req && req.user;
  db.prepare(`INSERT INTO audit_log(user_id, user_label, ip, action, entity, entity_id, detail)
              VALUES (?,?,?,?,?,?,?)`).run(
    u ? u.id : null,
    u ? `${u.full_name} <${u.email || u.phone}> [${u.role}]` : null,
    req ? req.ip : null,
    action, entity, entityId,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000),
  );
}

// ---------- Session user loader ----------
function loadUser(req, res, next) {
  req.user = null;
  const s = req.session;
  if (s && s.userId && s.mfaPassed) {
    const u = db.prepare('SELECT id, email, phone, full_name, role, is_active, totp_enabled, must_change_password FROM users WHERE id = ?').get(s.userId);
    if (u && u.is_active) {
      // Idle timeout: staff 30 min, patients 60 min
      const idleMs = (u.role === 'patient' ? 60 : 30) * 60 * 1000;
      const now = Date.now();
      if (s.lastSeen && now - s.lastSeen > idleMs) {
        return req.session.regenerate(() => { req.flash('info', 'Your session expired. Please sign in again.'); next(); });
      }
      s.lastSeen = now;
      req.user = u;
    } else {
      s.userId = null;
    }
  }
  res.locals.user = req.user;
  next();
}

// ---------- Flash ----------
function flash(req, res, next) {
  req.flash = (type, msg) => {
    if (!req.session) return;
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, msg });
  };
  res.locals.flashes = (req.session && req.session.flash) || [];
  if (req.session) req.session.flash = [];
  next();
}

// ---------- CSRF (synchroniser token, per session) ----------
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomToken(24);
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || (req.query && req.query._csrf);
  if (!token || !safeEqual(token, req.session.csrf)) {
    audit(req, 'security.csrf_rejected', null, null, { path: req.path });
    return res.status(403).render('public/error', { layout: 'layouts/public', title: 'Session expired', message: 'Your form session expired. Please go back, refresh the page and try again.' });
  }
  next();
}

// ---------- Authorization ----------
const STAFF_ROLES = ['admin', 'therapist', 'receptionist', 'accountant'];

/** Permission matrix (least privilege). */
const PERMS = {
  'dashboard.view':        ['admin', 'therapist', 'receptionist', 'accountant'],
  'appointments.view':     ['admin', 'therapist', 'receptionist'],
  'appointments.manage':   ['admin', 'receptionist', 'therapist'],
  'patients.view':         ['admin', 'therapist', 'receptionist'],
  'patients.manage':       ['admin', 'receptionist', 'therapist'],
  'clinical.view':         ['admin', 'therapist'],
  'clinical.write':        ['admin', 'therapist'],
  'invoices.view':         ['admin', 'receptionist', 'accountant'],
  'invoices.manage':       ['admin', 'receptionist', 'accountant'],
  'invoices.void':         ['admin', 'accountant'],
  'reports.view':          ['admin', 'accountant'],
  'cms.manage':            ['admin', 'receptionist'],
  'messages.view':         ['admin', 'receptionist'],
  'users.manage':          ['admin'],
  'settings.manage':       ['admin'],
  'audit.view':            ['admin'],
  'notifications.view':    ['admin', 'receptionist'],
};
const can = (user, perm) => !!user && (PERMS[perm] || []).includes(user.role);

function requireStaff(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/staff/login');
  }
  if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).render('public/error', { layout: 'layouts/public', title: 'Forbidden', message: 'This area is for clinic staff only.' });
  if (!req.path.startsWith('/account')) {
    if (req.user.must_change_password) return res.redirect('/admin/account?force=1');
    if (!req.user.totp_enabled && require('../db').getSetting('require_staff_2fa', '1') === '1') return res.redirect('/admin/account/2fa?required=1');
  }
  res.locals.can = (p) => can(req.user, p);
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.user, perm)) {
      audit(req, 'security.forbidden', null, null, { perm, path: req.originalUrl });
      return res.status(403).render('admin/forbidden', { layout: 'layouts/admin', title: 'Not allowed', perm });
    }
    next();
  };
}

function requirePatient(req, res, next) {
  if (!req.user || req.user.role !== 'patient') {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

module.exports = { audit, loadUser, flash, csrf, requireStaff, requirePerm, requirePatient, can, PERMS, STAFF_ROLES };
