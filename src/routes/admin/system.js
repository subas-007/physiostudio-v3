'use strict';
/** Users, settings, holidays, notification log, audit log and the signed-in user's own account (password, 2FA). */
const express = require('express');
const QRCode = require('qrcode');
const { db, getSetting, setSetting } = require('../../db');
const { audit, requirePerm, STAFF_ROLES } = require('../../lib/middleware');
const { clean, isEmail, isDate, paginate } = require('../../lib/util');
const sec = require('../../lib/security');
const notify = require('../../lib/notify');
const { runReminders } = require('../../lib/scheduler');
const { memory, saveImage } = require('../../lib/upload');

const router = express.Router();
const ROLES = ['admin', 'therapist', 'receptionist', 'accountant'];

// =============== Users ===============
router.get('/users', requirePerm('users.manage'), (req, res) => {
  const rows = db.prepare(`SELECT u.*, s.full_name staff_profile FROM users u LEFT JOIN staff s ON s.user_id = u.id WHERE u.role != 'patient' ORDER BY u.is_active DESC, u.full_name`).all();
  const patientAccounts = db.prepare("SELECT COUNT(*) n FROM users WHERE role='patient'").get().n;
  res.render('admin/users', { title: 'Staff users', rows, patientAccounts });
});
router.get('/users/new', requirePerm('users.manage'), (req, res) => res.render('admin/user-form', { title: 'New staff user', f: { role: 'receptionist', is_active: 1 }, ROLES, staffProfiles: staffProfiles(null), isNew: true }));
router.post('/users/new', requirePerm('users.manage'), (req, res) => {
  const f = { full_name: clean(req.body.full_name, 120), email: clean(req.body.email, 190).toLowerCase(), phone: clean(req.body.phone, 20), role: ROLES.includes(req.body.role) ? req.body.role : 'receptionist', staff_id: clean(req.body.staff_id, 10) };
  const errors = [];
  if (f.full_name.length < 2) errors.push('Name is required.');
  if (!isEmail(f.email)) errors.push('A valid email is required.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) errors.push('That email is already in use.');
  if (errors.length) return res.status(400).render('admin/user-form', { title: 'New staff user', f, ROLES, staffProfiles: staffProfiles(null), isNew: true, errors });
  const temp = tempPassword();
  const id = db.prepare('INSERT INTO users(email, phone, full_name, password_hash, role, must_change_password) VALUES (?,?,?,?,?,1)').run(f.email, f.phone || null, f.full_name, sec.hashPassword(temp), f.role).lastInsertRowid;
  linkStaff(id, f.staff_id);
  audit(req, 'user.create', 'user', id, { role: f.role });
  req.session.oneTimeSecret = { label: `Temporary password for ${f.email}`, value: temp };
  res.redirect(`/admin/users/${id}`);
});
router.get('/users/:id', requirePerm('users.manage'), (req, res, next) => {
  const f = db.prepare("SELECT u.*, s.id staff_id FROM users u LEFT JOIN staff s ON s.user_id = u.id WHERE u.id = ? AND u.role != 'patient'").get(req.params.id);
  if (!f) return next();
  const secret = req.session.oneTimeSecret; delete req.session.oneTimeSecret;
  const activity = db.prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 25').all(f.id);
  res.render('admin/user-form', { title: f.full_name, f, ROLES, staffProfiles: staffProfiles(f.id), isNew: false, secret, activity });
});
router.post('/users/:id', requirePerm('users.manage'), (req, res, next) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'patient'").get(req.params.id);
  if (!u) return next();
  const role = ROLES.includes(req.body.role) ? req.body.role : u.role;
  const active = req.body.is_active ? 1 : 0;
  if (u.id === req.user.id && (role !== 'admin' || !active)) { req.flash('error', 'You cannot demote or deactivate your own account.'); return res.redirect(`/admin/users/${u.id}`); }
  if (u.role === 'admin' && (role !== 'admin' || !active) && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND is_active=1").get().n <= 1) { req.flash('error', 'At least one active admin is required.'); return res.redirect(`/admin/users/${u.id}`); }
  db.prepare("UPDATE users SET full_name=?, phone=?, role=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?").run(clean(req.body.full_name, 120) || u.full_name, clean(req.body.phone, 20) || null, role, active, u.id);
  linkStaff(u.id, clean(req.body.staff_id, 10));
  if (!active) killSessions(u.id);
  audit(req, 'user.update', 'user', u.id, { role, active });
  req.flash('success', 'User saved.');
  res.redirect(`/admin/users/${u.id}`);
});
router.post('/users/:id/reset-password', requirePerm('users.manage'), (req, res) => {
  const temp = tempPassword();
  db.prepare("UPDATE users SET password_hash=?, must_change_password=1, failed_logins=0, locked_until=NULL WHERE id=? AND role != 'patient'").run(sec.hashPassword(temp), req.params.id);
  killSessions(Number(req.params.id));
  audit(req, 'user.reset_password', 'user', Number(req.params.id));
  req.session.oneTimeSecret = { label: 'New temporary password', value: temp };
  res.redirect(`/admin/users/${req.params.id}`);
});
router.post('/users/:id/reset-2fa', requirePerm('users.manage'), (req, res) => {
  db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(req.params.id);
  killSessions(Number(req.params.id));
  audit(req, 'user.reset_2fa', 'user', Number(req.params.id));
  req.flash('success', 'Two-factor authentication reset. The user will be asked to set it up again at next sign-in.');
  res.redirect(`/admin/users/${req.params.id}`);
});
router.post('/users/:id/unlock', requirePerm('users.manage'), (req, res) => {
  db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?').run(req.params.id);
  audit(req, 'user.unlock', 'user', Number(req.params.id));
  req.flash('success', 'Account unlocked.');
  res.redirect(`/admin/users/${req.params.id}`);
});

function staffProfiles(userId) { return db.prepare('SELECT id, full_name, user_id FROM staff WHERE user_id IS NULL OR user_id = ? ORDER BY sort_order').all(userId); }
function linkStaff(userId, staffId) {
  db.prepare('UPDATE staff SET user_id = NULL WHERE user_id = ?').run(userId);
  if (/^\d+$/.test(staffId || '')) db.prepare('UPDATE staff SET user_id = ? WHERE id = ? AND user_id IS NULL').run(userId, staffId);
}
function tempPassword() { return sec.randomToken(9) + '-' + Math.floor(Math.random() * 90 + 10) + 'Aa'; }
function killSessions(userId) { db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(userId); }

// =============== Settings ===============
const SETTING_GROUPS = [
  ['Clinic details', [
    ['clinic_name', 'Clinic name'], ['tagline', 'Tagline'], ['phone_primary', 'Primary phone'], ['phone_secondary', 'Secondary phone'],
    ['whatsapp_number', 'WhatsApp number (click-to-chat button)'], ['email', 'Public email'], ['address', 'Address'], ['hours_text', 'Opening hours text'],
    ['map_query', 'Google Maps search text'], ['facebook_url', 'Facebook URL'], ['instagram_url', 'Instagram URL'], ['tiktok_url', 'TikTok URL'],
    ['brand_color', 'Brand colour (#hex)'], ['accent_color', 'Accent colour (#hex)'], ['meta_description', 'SEO description', 'textarea'],
  ]],
  ['Announcement bar', [
    ['announcement_enabled', 'Show the announcement bar at the top of every page', 'bool'], ['announcement_text', 'Announcement text'],
    ['announcement_link', 'Link (a page like /packages, or https://…)'], ['announcement_until', 'Hide automatically after (YYYY-MM-DD, optional)'],
    ['google_reviews_url', 'Google reviews link (shown with testimonials)'],
  ]],
  ['Online booking', [
    ['slot_step_min', 'Slot interval (minutes)'], ['booking_lead_min', 'Minimum notice for online booking (minutes)'], ['booking_horizon_days', 'How far ahead patients can book (days)'],
    ['cancel_cutoff_hours', 'Patients can cancel/reschedule up to (hours before)'], ['auto_confirm_online', 'Auto-confirm online bookings', 'bool'], ['auto_no_show', 'Auto-mark past unattended appointments as no-show', 'bool'],
  ]],
  ['Billing', [
    ['invoice_prefix', 'Invoice number prefix'], ['pan_vat_no', 'PAN / VAT number'], ['tax_label', 'Tax label'], ['tax_rate', 'Default tax rate (%)'],
    ['fy_start_mmdd', 'Fiscal year starts (MM-DD, AD) – Shrawan 1'], ['invoice_footer', 'Invoice footer note', 'textarea'],
  ]],
  ['Reminders & messages', [
    ['reminders_enabled', 'Automatic reminders (24 h and 2 h before)', 'bool'], ['notify_email_enabled', 'Email channel enabled', 'bool'], ['notify_whatsapp_enabled', 'WhatsApp channel enabled', 'bool'],
    ...Object.keys(notify.DEFAULT_TEMPLATES).map((k) => [`tpl_${k}`, `Message: ${k.replace(/_/g, ' ')}`, 'textarea', notify.DEFAULT_TEMPLATES[k]]),
  ]],
  ['Security', [['require_staff_2fa', 'Require two-factor authentication for all staff', 'bool']]],
];
router.get('/settings', requirePerm('settings.manage'), (req, res) => {
  res.render('admin/settings', { title: 'Settings', groups: SETTING_GROUPS, channels: { smtp: !!process.env.SMTP_HOST, wa: process.env.WHATSAPP_PROVIDER || '' } });
});
router.post('/settings', requirePerm('settings.manage'), (req, res) => {
  const changed = [];
  for (const [, items] of SETTING_GROUPS) for (const [key, , type, def] of items) {
    let v = type === 'bool' ? (req.body[key] ? '1' : '0') : clean(req.body[key], type === 'textarea' ? 2000 : 300);
    if (['brand_color', 'accent_color'].includes(key) && !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
    if (['slot_step_min', 'booking_lead_min', 'booking_horizon_days', 'cancel_cutoff_hours', 'tax_rate'].includes(key) && !/^\d+(\.\d+)?$/.test(v)) continue;
    if (key === 'fy_start_mmdd' && !/^\d{2}-\d{2}$/.test(v)) continue;
    if (/_url$/.test(key) && v && !/^https:\/\//.test(v)) continue;
    if (key === 'announcement_link' && v && !/^\/(?!\/)|^https:\/\//.test(v)) continue;
    if (key === 'announcement_until' && v && !isDate(v)) continue;
    if (def && v === def) v = '';
    if (getSetting(key, '') !== v) { setSetting(key, v); changed.push(key); }
  }
  audit(req, 'settings.update', 'settings', null, { changed });
  req.flash('success', changed.length ? 'Settings saved.' : 'No changes.');
  res.redirect('/admin/settings');
});
// The logo is an uploaded image (same checks as the media library), not a typed path.
router.post('/settings/logo', requirePerm('settings.manage'), memory.single('logo'), (req, res) => {
  try {
    const p = saveImage(req.file, req.user.id, 'Clinic logo');
    if (!p) throw Object.assign(new Error('Choose an image.'), { userMessage: 'Choose an image.' });
    setSetting('logo', p);
    audit(req, 'settings.logo_update', 'settings', null, { path: p });
    req.flash('success', 'Logo updated.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); }
  res.redirect('/admin/settings');
});
router.post('/settings/test-notification', requirePerm('settings.manage'), async (req, res) => {
  const to = clean(req.body.to, 190);
  const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'email';
  // Fake appointment-shaped data for template rendering
  const fake = { id: null, ref: 'PS-TEST01', date: new Date().toISOString().slice(0, 10), start_time: '10:00', patient_name: 'Test Patient', staff_name: 'Pragya Pyakurel', service_title: 'Physiotherapy', patient_id: null };
  const v = notify.vars(fake);
  const text = notify.render(getSetting('tpl_reminder_24h', notify.DEFAULT_TEMPLATES.reminder_24h), v);
  let result;
  try {
    if (channel === 'email') result = await notify.sendStaffEmail(to, 'Physio Studio – test message', text);
    else {
      result = await notify.sendWhatsApp(to, 'reminder_24h', text, v);
    }
  } catch (e) { result = { error: e.message }; }
  audit(req, 'settings.test_notification', null, null, { channel, ok: !(result && (result.error || result.skipped)) });
  if (result && (result.error || result.skipped)) req.flash('error', `Test ${channel} not sent: ${result.error || 'not configured'}`);
  else req.flash('success', `Test ${channel} sent to ${to}.`);
  res.redirect('/admin/settings');
});
router.post('/settings/run-reminders', requirePerm('settings.manage'), async (req, res) => {
  const r = await runReminders();
  audit(req, 'settings.run_reminders', null, null, r);
  req.flash('success', `Reminder run complete: ${r.r24 || 0} day-before and ${r.r2 || 0} two-hour reminders sent.`);
  res.redirect('/admin/logs/notifications');
});

// =============== Holidays / leave ===============
router.get('/holidays', requirePerm('settings.manage'), (req, res) => {
  const rows = db.prepare("SELECT l.*, s.full_name FROM staff_leave l LEFT JOIN staff s ON s.id = l.staff_id WHERE l.date >= date('now','localtime','-30 day') ORDER BY l.date").all();
  res.render('admin/holidays', { title: 'Holidays & leave', rows, staffList: db.prepare('SELECT id, full_name FROM staff ORDER BY sort_order').all() });
});
router.post('/holidays', requirePerm('settings.manage'), (req, res) => {
  const date = clean(req.body.date, 10), to = clean(req.body.to, 10) || date;
  if (!isDate(date) || !isDate(to) || to < date) { req.flash('error', 'Choose a valid date range.'); return res.redirect('/admin/holidays'); }
  const staffId = /^\d+$/.test(req.body.staff_id || '') ? Number(req.body.staff_id) : null;
  const ins = db.prepare('INSERT INTO staff_leave(staff_id, date, reason) VALUES (?,?,?)');
  let d = new Date(date + 'T00:00:00'); let n = 0;
  while (n < 60) {
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (local > to) break;
    ins.run(staffId, local, clean(req.body.reason, 200));
    d.setDate(d.getDate() + 1); n++;
  }
  const clash = db.prepare(`SELECT COUNT(*) n FROM appointments WHERE date BETWEEN ? AND ? AND status IN ('pending','confirmed') ${staffId ? 'AND staff_id = ' + staffId : ''}`).get(date, to).n;
  audit(req, 'holiday.create', 'staff_leave', null, { date, to, staffId });
  req.flash(clash ? 'error' : 'success', clash ? `Saved. Note: ${clash} existing appointment(s) fall on these dates – reschedule them from the Schedule.` : 'Saved.');
  res.redirect('/admin/holidays');
});
router.post('/holidays/:id/delete', requirePerm('settings.manage'), (req, res) => {
  db.prepare('DELETE FROM staff_leave WHERE id = ?').run(req.params.id);
  audit(req, 'holiday.delete', 'staff_leave', Number(req.params.id));
  res.redirect('/admin/holidays');
});

// =============== Logs ===============
router.get('/logs/notifications', requirePerm('notifications.view'), (req, res) => {
  const status = ['queued', 'sent', 'failed', 'skipped'].includes(req.query.status) ? req.query.status : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM notifications ${status ? 'WHERE status = ?' : ''}`).get(...(status ? [status] : [])).n;
  const pg = paginate(total, req.query.page, 50);
  const rows = db.prepare(`SELECT n.*, p.full_name, a.ref FROM notifications n LEFT JOIN patients p ON p.id = n.patient_id LEFT JOIN appointments a ON a.id = n.appointment_id
    ${status ? 'WHERE n.status = ?' : ''} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(...(status ? [status] : []), pg.per, pg.offset);
  res.render('admin/notifications', { title: 'Message delivery log', rows, pg, status });
});
router.get('/logs/audit', requirePerm('audit.view'), (req, res) => {
  const q = clean(req.query.q, 80);
  const from = isDate(req.query.from) ? req.query.from : '';
  const where = []; const args = [];
  if (q) { where.push('(action LIKE ? OR user_label LIKE ? OR entity LIKE ? OR ip LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  if (from) { where.push('at >= ?'); args.push(from); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM audit_log ${w}`).get(...args).n;
  const pg = paginate(total, req.query.page, 100);
  const rows = db.prepare(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset);
  res.render('admin/audit', { title: 'Audit log', rows, pg, q, from });
});

// =============== My account ===============
router.get('/account', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('admin/account', { title: 'My account', me, force: req.query.force === '1' });
});
router.post('/account/password', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!sec.verifyPassword(String(req.body.current || ''), me.password_hash)) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/admin/account'); }
  const pw = String(req.body.password || '');
  const pp = sec.passwordProblems(pw, { email: me.email, name: me.full_name });
  if (pw !== req.body.password2) pp.push('passwords must match');
  if (sec.verifyPassword(pw, me.password_hash)) pp.push('must differ from the current password');
  if (pp.length) { req.flash('error', 'New password needs: ' + pp.join(', ') + '.'); return res.redirect('/admin/account' + (me.must_change_password ? '?force=1' : '')); }
  db.prepare("UPDATE users SET password_hash=?, must_change_password=0, updated_at=datetime('now','localtime') WHERE id=?").run(sec.hashPassword(pw), me.id);
  // End other sessions for this user, keep the current one.
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ? AND sid != ?").run(me.id, req.sessionID);
  audit(req, 'auth.password_changed', 'user', me.id);
  req.flash('success', 'Password changed.');
  const need2fa = !me.totp_enabled && getSetting('require_staff_2fa', '1') === '1';
  res.redirect(need2fa ? '/admin/account/2fa?required=1' : '/admin');
});
router.get('/account/2fa', async (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (me.totp_enabled) return res.render('admin/2fa', { title: 'Two-factor authentication', enabled: true });
  if (!req.session.totpSetup) req.session.totpSetup = sec.newTotpSecret();
  const uri = sec.totpUri(req.session.totpSetup, me.email, getSetting('clinic_name', 'Physio Studio'));
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  res.render('admin/2fa', { title: 'Set up two-factor authentication', enabled: false, qr, secret: req.session.totpSetup, required: req.query.required === '1' });
});
router.post('/account/2fa/enable', (req, res) => {
  const secret = req.session.totpSetup;
  if (!secret || !sec.verifyTotp(secret, clean(req.body.code, 10).replace(/\s/g, ''))) { req.flash('error', 'That code did not match. Make sure your phone\'s time is correct and try again.'); return res.redirect('/admin/account/2fa'); }
  db.prepare('UPDATE users SET totp_secret=?, totp_enabled=1 WHERE id=?').run(sec.encrypt(secret), req.user.id);
  delete req.session.totpSetup;
  audit(req, 'auth.2fa_enabled', 'user', req.user.id);
  req.flash('success', 'Two-factor authentication is on. You will need your authenticator app at each sign-in.');
  res.redirect('/admin');
});
router.post('/account/2fa/disable', (req, res) => {
  if (getSetting('require_staff_2fa', '1') === '1') { req.flash('error', 'Two-factor authentication is mandatory for staff. Ask an admin to reset it if you changed phones.'); return res.redirect('/admin/account/2fa'); }
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!sec.verifyPassword(String(req.body.current || ''), me.password_hash)) { req.flash('error', 'Password incorrect.'); return res.redirect('/admin/account/2fa'); }
  db.prepare('UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?').run(me.id);
  audit(req, 'auth.2fa_disabled', 'user', me.id);
  req.flash('success', 'Two-factor authentication turned off.');
  res.redirect('/admin/account');
});

module.exports = router;
module.exports.STAFF_ROLES = STAFF_ROLES;
