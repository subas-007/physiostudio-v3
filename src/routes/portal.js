'use strict';
const express = require('express');
const { db } = require('../db');
const { audit, requirePatient } = require('../lib/middleware');
const { clean, isPhone, isDate } = require('../lib/util');
const booking = require('../lib/booking');
const { getInvoice } = require('../lib/billing');
const { notifyAppointment } = require('../lib/notify');
const sec = require('../lib/security');

const router = express.Router();
router.use(requirePatient);
router.use((req, res, next) => {
  req.patient = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(req.user.id);
  if (!req.patient) return res.render('public/error', { title: 'No patient record', message: 'Your account is not linked to a patient record yet. Please contact reception.' });
  res.locals.patient = req.patient;
  res.locals.layout = 'layouts/portal';
  next();
});

router.get('/', (req, res) => {
  const pid = req.patient.id;
  const upcoming = db.prepare(`SELECT a.*, s.full_name staff_name, sv.title service_title FROM appointments a LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id
    WHERE a.patient_id=? AND a.status IN ('pending','confirmed','checked_in') AND a.date >= date('now','localtime') ORDER BY a.date, a.start_time`).all(pid);
  const past = db.prepare(`SELECT a.*, s.full_name staff_name, sv.title service_title FROM appointments a LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id
    WHERE a.patient_id=? AND NOT (a.status IN ('pending','confirmed','checked_in') AND a.date >= date('now','localtime')) ORDER BY a.date DESC, a.start_time DESC LIMIT 30`).all(pid);
  const invoices = db.prepare("SELECT * FROM invoices WHERE patient_id=? AND status != 'draft' ORDER BY issue_date DESC, id DESC").all(pid);
  res.render('portal/home', { title: 'My portal', upcoming: upcoming.map((a) => ({ ...a, canChange: booking.patientCanChange(a) })), past, invoices });
});

router.post('/appointments/:id/cancel', async (req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?').get(req.params.id, req.patient.id);
  if (!a || !booking.patientCanChange(a)) { req.flash('error', 'This appointment can no longer be cancelled online – please call us.'); return res.redirect('/portal'); }
  db.prepare("UPDATE appointments SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?").run('Cancelled by patient (portal): ' + clean(req.body.reason, 300), a.id);
  audit(req, 'appointment.cancel_by_patient', 'appointment', a.id);
  notifyAppointment(a.id, 'cancelled').catch(console.error);
  req.flash('success', `Appointment ${a.ref} cancelled.`);
  res.redirect('/portal');
});

router.get('/appointments/:id/reschedule', (req, res, next) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?').get(req.params.id, req.patient.id);
  if (!a) return next();
  if (!booking.patientCanChange(a)) { req.flash('error', 'This appointment can no longer be changed online.'); return res.redirect('/portal'); }
  const { todayStr, addDays } = require('../lib/util');
  res.render('portal/reschedule', { title: 'Reschedule', a: booking.getAppointment(a.id), minDate: todayStr(), maxDate: addDays(todayStr(), 60) });
});
router.post('/appointments/:id/reschedule', async (req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?').get(req.params.id, req.patient.id);
  if (!a || !booking.patientCanChange(a)) { req.flash('error', 'This appointment can no longer be changed online.'); return res.redirect('/portal'); }
  try {
    const na = booking.rescheduleAppointment(a.id, { date: clean(req.body.date, 10), time: clean(req.body.time, 5) });
    audit(req, 'appointment.reschedule_by_patient', 'appointment', a.id);
    notifyAppointment(na, 'rescheduled').catch(console.error);
    req.flash('success', 'Appointment moved.');
    res.redirect('/portal');
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); res.redirect(`/portal/appointments/${a.id}/reschedule`); }
});

router.get('/invoices/:id', (req, res, next) => {
  const inv = getInvoice(req.params.id);
  if (!inv || inv.patient_id !== req.patient.id || inv.status === 'draft') return next();
  audit(req, 'invoice.view_by_patient', 'invoice', inv.id);
  res.render('admin/invoice-print', { layout: false, title: inv.invoice_no, inv, backUrl: '/portal' });
});

router.get('/profile', (req, res) => res.render('portal/profile', { title: 'My details', f: req.patient }));
router.post('/profile', (req, res) => {
  const f = {
    phone: clean(req.body.phone, 20), whatsapp: clean(req.body.whatsapp, 20), address: clean(req.body.address, 300),
    date_of_birth: clean(req.body.date_of_birth, 10), gender: clean(req.body.gender, 20),
    emergency_contact_name: clean(req.body.emergency_contact_name, 120), emergency_contact_phone: clean(req.body.emergency_contact_phone, 20),
    notify_email: req.body.notify_email ? 1 : 0, notify_whatsapp: req.body.notify_whatsapp ? 1 : 0,
  };
  const errors = [];
  if (!isPhone(f.phone)) errors.push('Enter a valid mobile number.');
  if (f.date_of_birth && !isDate(f.date_of_birth)) errors.push('Enter a valid date of birth.');
  if (errors.length) return res.status(400).render('portal/profile', { title: 'My details', f: { ...req.patient, ...f }, errors });
  db.prepare(`UPDATE patients SET phone=?, whatsapp=?, address=?, date_of_birth=?, gender=?, emergency_contact_name=?, emergency_contact_phone=?,
    notify_email=?, notify_whatsapp=?, consent_communication=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(f.phone, f.whatsapp || null, f.address || null, f.date_of_birth || null, f.gender || null, f.emergency_contact_name || null, f.emergency_contact_phone || null,
      f.notify_email, f.notify_whatsapp, f.notify_email || f.notify_whatsapp ? 1 : 0, req.patient.id);
  audit(req, 'patient.update_by_self', 'patient', req.patient.id);
  req.flash('success', 'Your details have been saved.');
  res.redirect('/portal/profile');
});

router.post('/password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!sec.verifyPassword(String(req.body.current || ''), u.password_hash)) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/portal/profile'); }
  const pw = String(req.body.password || '');
  const pp = sec.passwordProblems(pw, { email: u.email, name: u.full_name });
  if (pw !== req.body.password2) pp.push('passwords must match');
  if (pp.length) { req.flash('error', 'New password needs: ' + pp.join(', ') + '.'); return res.redirect('/portal/profile'); }
  db.prepare("UPDATE users SET password_hash=?, updated_at=datetime('now','localtime') WHERE id=?").run(sec.hashPassword(pw), u.id);
  audit(req, 'auth.password_changed', 'user', u.id);
  req.flash('success', 'Password changed.');
  res.redirect('/portal/profile');
});

module.exports = router;
