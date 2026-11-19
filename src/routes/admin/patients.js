'use strict';
const express = require('express');
const { db } = require('../../db');
const { audit, requirePerm, can } = require('../../lib/middleware');
const { clean, isDate, isPhone, isEmail, paginate } = require('../../lib/util');
const booking = require('../../lib/booking');
const sec = require('../../lib/security');
const { sendStaffEmail } = require('../../lib/notify');

const router = express.Router();

const FIELDS = ['full_name', 'gender', 'date_of_birth', 'phone', 'whatsapp', 'email', 'address', 'occupation', 'emergency_contact_name',
  'emergency_contact_phone', 'referred_by', 'medical_history', 'allergies', 'current_medications'];
function readForm(body) {
  const f = {};
  for (const k of FIELDS) f[k] = clean(body[k], ['medical_history', 'current_medications', 'allergies'].includes(k) ? 4000 : 300);
  f.email = f.email.toLowerCase();
  f.notify_email = body.notify_email ? 1 : 0;
  f.notify_whatsapp = body.notify_whatsapp ? 1 : 0;
  f.consent_treatment = body.consent_treatment ? 1 : 0;
  f.consent_communication = body.consent_communication ? 1 : 0;
  return f;
}
function validate(f) {
  const e = [];
  if (f.full_name.length < 2) e.push('Full name is required.');
  if (!isPhone(f.phone)) e.push('A valid mobile number is required.');
  if (f.email && !isEmail(f.email)) e.push('Email is not valid.');
  if (f.date_of_birth && !isDate(f.date_of_birth)) e.push('Date of birth is not valid.');
  return e;
}

router.get('/', requirePerm('patients.view'), (req, res) => {
  const q = clean(req.query.q, 80);
  const archived = req.query.archived === '1' ? 1 : 0;
  const where = ['is_archived = ?']; const args = [archived];
  if (q) { where.push('(full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR patient_code LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  const total = db.prepare(`SELECT COUNT(*) n FROM patients WHERE ${where.join(' AND ')}`).get(...args).n;
  const pg = paginate(total, req.query.page, 30);
  const rows = db.prepare(`SELECT p.*, (SELECT MAX(date) FROM appointments WHERE patient_id = p.id AND status='completed') last_visit,
      (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) visits
    FROM patients p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset);
  if (q) audit(req, 'patient.search', 'patient', null, { q });
  res.render('admin/patients', { title: 'Patients', rows, q, pg, archived });
});

router.get('/search.json', requirePerm('patients.view'), (req, res) => {
  const q = clean(req.query.q, 60);
  if (q.length < 2) return res.json([]);
  res.json(db.prepare('SELECT id, full_name, phone, patient_code FROM patients WHERE is_archived = 0 AND (full_name LIKE ? OR phone LIKE ? OR patient_code LIKE ?) ORDER BY full_name LIMIT 10').all(`%${q}%`, `%${q}%`, `%${q}%`));
});

router.get('/new', requirePerm('patients.manage'), (req, res) => res.render('admin/patient-form', { title: 'New patient', f: { notify_email: 1, notify_whatsapp: 1 }, isNew: true }));
router.post('/new', requirePerm('patients.manage'), (req, res) => {
  const f = readForm(req.body);
  const errors = validate(f);
  if (errors.length) return res.status(400).render('admin/patient-form', { title: 'New patient', f, isNew: true, errors });
  const p = booking.createPatient(f);
  db.prepare('UPDATE patients SET notify_email=?, notify_whatsapp=? WHERE id=?').run(f.notify_email, f.notify_whatsapp, p.id);
  audit(req, 'patient.create', 'patient', p.id);
  req.flash('success', `Patient ${p.patient_code} registered.`);
  res.redirect(`/admin/patients/${p.id}`);
});

router.get('/:id', requirePerm('patients.view'), (req, res, next) => {
  const p = db.prepare('SELECT p.*, u.email AS portal_email, u.is_active AS portal_active FROM patients p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(req.params.id);
  if (!p) return next();
  audit(req, 'patient.view', 'patient', p.id);
  const appts = db.prepare(`SELECT a.*, s.full_name staff_name, sv.title service_title FROM appointments a LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id
    WHERE patient_id = ? ORDER BY date DESC, start_time DESC`).all(p.id);
  const notes = can(req.user, 'clinical.view')
    ? db.prepare('SELECT n.*, u.full_name author FROM clinical_notes n JOIN users u ON u.id = n.author_id WHERE patient_id = ? ORDER BY n.id DESC').all(p.id) : null;
  const invoices = can(req.user, 'invoices.view') ? db.prepare('SELECT * FROM invoices WHERE patient_id = ? ORDER BY id DESC').all(p.id) : null;
  const balance = invoices ? invoices.filter((i) => ['unpaid', 'partial'].includes(i.status)).reduce((s, i) => s + i.total - i.amount_paid, 0) : 0;
  res.render('admin/patient', { title: p.full_name, p, appts, notes, invoices, balance, tab: req.query.tab || 'overview' });
});

router.get('/:id/edit', requirePerm('patients.manage'), (req, res, next) => {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return next();
  res.render('admin/patient-form', { title: `Edit ${p.full_name}`, f: p, isNew: false });
});
router.post('/:id/edit', requirePerm('patients.manage'), (req, res, next) => {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return next();
  const f = readForm(req.body);
  const errors = validate(f);
  if (errors.length) return res.status(400).render('admin/patient-form', { title: `Edit ${p.full_name}`, f: { ...p, ...f }, isNew: false, errors });
  const changed = FIELDS.filter((k) => String(p[k] || '') !== String(f[k] || ''));
  db.prepare(`UPDATE patients SET ${FIELDS.map((k) => `${k} = ?`).join(', ')}, notify_email=?, notify_whatsapp=?, consent_treatment=?, consent_communication=?,
      consent_at = CASE WHEN ? != consent_communication OR ? != consent_treatment THEN datetime('now','localtime') ELSE consent_at END, updated_at=datetime('now','localtime') WHERE id = ?`)
    .run(...FIELDS.map((k) => f[k] || null), f.notify_email, f.notify_whatsapp, f.consent_treatment, f.consent_communication, f.consent_communication, f.consent_treatment, p.id);
  audit(req, 'patient.update', 'patient', p.id, { fields: changed });
  req.flash('success', 'Patient details saved.');
  res.redirect(`/admin/patients/${p.id}`);
});

router.post('/:id/archive', requirePerm('patients.manage'), (req, res) => {
  const v = req.body.restore === '1' ? 0 : 1;
  db.prepare("UPDATE patients SET is_archived = ?, updated_at=datetime('now','localtime') WHERE id = ?").run(v, req.params.id);
  audit(req, v ? 'patient.archive' : 'patient.restore', 'patient', Number(req.params.id));
  req.flash('success', v ? 'Patient archived.' : 'Patient restored.');
  res.redirect(`/admin/patients/${req.params.id}`);
});

// ---------- Clinical notes (SOAP) ----------
router.post('/:id/notes', requirePerm('clinical.write'), (req, res, next) => {
  const p = db.prepare('SELECT id FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return next();
  const type = ['initial_assessment', 'progress', 'discharge'].includes(req.body.note_type) ? req.body.note_type : 'progress';
  const pain = req.body.pain_score === '' || req.body.pain_score == null ? null : Math.max(0, Math.min(10, parseInt(req.body.pain_score, 10)));
  const apptId = /^\d+$/.test(req.body.appointment_id || '') && db.prepare('SELECT 1 FROM appointments WHERE id=? AND patient_id=?').get(req.body.appointment_id, p.id) ? Number(req.body.appointment_id) : null;
  const amendedFrom = /^\d+$/.test(req.body.amended_from || '') ? Number(req.body.amended_from) : null;
  const vals = ['subjective', 'objective', 'assessment', 'plan'].map((k) => clean(req.body[k], 6000) || null);
  if (vals.every((v) => !v)) { req.flash('error', 'Write at least one section of the note.'); return res.redirect(`/admin/patients/${p.id}?tab=clinical`); }
  const sign = req.body.sign === '1' ? 1 : 0;
  const id = db.prepare('INSERT INTO clinical_notes(patient_id, appointment_id, author_id, note_type, pain_score, subjective, objective, assessment, plan, is_locked, amended_from) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(p.id, apptId, req.user.id, type, Number.isNaN(pain) ? null : pain, ...vals, sign, amendedFrom).lastInsertRowid;
  audit(req, amendedFrom ? 'clinical.amend' : 'clinical.create', 'clinical_note', id, { patient: p.id, signed: !!sign });
  req.flash('success', sign ? 'Note saved and signed.' : 'Draft note saved.');
  res.redirect(`/admin/patients/${p.id}?tab=clinical`);
});
router.post('/notes/:noteId/sign', requirePerm('clinical.write'), (req, res, next) => {
  const n = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(req.params.noteId);
  if (!n) return next();
  if (n.author_id !== req.user.id && req.user.role !== 'admin') { req.flash('error', 'Only the author can sign this note.'); return res.redirect(`/admin/patients/${n.patient_id}?tab=clinical`); }
  db.prepare('UPDATE clinical_notes SET is_locked = 1 WHERE id = ?').run(n.id);
  audit(req, 'clinical.sign', 'clinical_note', n.id);
  res.redirect(`/admin/patients/${n.patient_id}?tab=clinical`);
});
router.post('/notes/:noteId/edit', requirePerm('clinical.write'), (req, res, next) => {
  const n = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(req.params.noteId);
  if (!n) return next();
  if (n.is_locked || n.author_id !== req.user.id) { req.flash('error', 'Signed notes cannot be edited – add an amendment instead.'); return res.redirect(`/admin/patients/${n.patient_id}?tab=clinical`); }
  const vals = ['subjective', 'objective', 'assessment', 'plan'].map((k) => clean(req.body[k], 6000) || null);
  db.prepare('UPDATE clinical_notes SET subjective=?, objective=?, assessment=?, plan=?, is_locked=? WHERE id=?').run(...vals, req.body.sign === '1' ? 1 : 0, n.id);
  audit(req, 'clinical.update_draft', 'clinical_note', n.id);
  res.redirect(`/admin/patients/${n.patient_id}?tab=clinical`);
});

// ---------- Portal access ----------
router.post('/:id/invite', requirePerm('patients.manage'), async (req, res, next) => {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return next();
  if (p.user_id) { req.flash('error', 'This patient already has a portal account.'); return res.redirect(`/admin/patients/${p.id}`); }
  if (!isEmail(p.email)) { req.flash('error', 'Add an email address to the patient first.'); return res.redirect(`/admin/patients/${p.id}`); }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(p.email)) { req.flash('error', 'That email is already used by another account.'); return res.redirect(`/admin/patients/${p.id}`); }
  const uid = db.prepare("INSERT INTO users(email, phone, full_name, password_hash, role) VALUES (?,?,?,?, 'patient')").run(p.email, p.phone, p.full_name, sec.hashPassword(sec.randomToken(24))).lastInsertRowid;
  db.prepare('UPDATE patients SET user_id = ? WHERE id = ?').run(uid, p.id);
  const token = sec.randomToken(32);
  db.prepare("INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES (?,?, datetime('now','localtime','+3 day'))").run(uid, sec.sha256(token));
  const link = `${(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/reset/${token}`;
  await sendStaffEmail(p.email, 'Your Physio Studio patient portal', `Namaste ${p.full_name},\n\nYour patient portal is ready. Use this link (valid for 3 days) to set your password, then view appointments, reschedule and download invoices:\n${link}\n\nPhysio Studio`);
  if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) console.log(`[dev] portal invite link for ${p.email}: ${link}`);
  audit(req, 'patient.portal_invite', 'patient', p.id);
  req.flash('success', `Portal invitation emailed to ${p.email}.`);
  res.redirect(`/admin/patients/${p.id}`);
});

// ---------- Printable full record ----------
router.get('/:id/record', requirePerm('clinical.view'), (req, res, next) => {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!p) return next();
  audit(req, 'patient.export_record', 'patient', p.id);
  const notes = db.prepare('SELECT n.*, u.full_name author FROM clinical_notes n JOIN users u ON u.id = n.author_id WHERE patient_id = ? ORDER BY n.id').all(p.id);
  const appts = db.prepare('SELECT a.*, s.full_name staff_name, sv.title service_title FROM appointments a LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id WHERE patient_id = ? ORDER BY date, start_time').all(p.id);
  res.render('admin/patient-record', { layout: false, title: `Record ${p.patient_code}`, p, notes, appts });
});

module.exports = router;
