'use strict';
const express = require('express');
const { db } = require('../../db');
const { audit, requirePerm } = require('../../lib/middleware');
const { clean, isDate, isTime, isPhone, isEmail, todayStr, addDays, paginate } = require('../../lib/util');
const booking = require('../../lib/booking');
const { notifyAppointment } = require('../../lib/notify');

const router = express.Router();
const STATUSES = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'];
const services = () => db.prepare('SELECT id, title, duration_min, price FROM services WHERE is_bookable = 1 ORDER BY sort_order').all();
const staff = () => db.prepare('SELECT id, full_name FROM staff WHERE is_bookable = 1 ORDER BY sort_order').all();

router.get('/', requirePerm('appointments.view'), (req, res) => {
  const view = req.query.view === 'list' ? 'list' : 'day';
  const date = isDate(req.query.date) ? req.query.date : todayStr();
  if (view === 'day') {
    const rows = db.prepare(`SELECT a.*, p.full_name patient_name, p.phone patient_phone, sv.title service_title
      FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN services sv ON sv.id=a.service_id
      WHERE a.date = ? AND a.status != 'cancelled' ORDER BY a.start_time`).all(date);
    const cols = db.prepare('SELECT id, full_name FROM staff WHERE is_bookable = 1 OR id IN (SELECT staff_id FROM appointments WHERE date = ?) ORDER BY sort_order').all(date);
    const closed = booking.clinicClosed(date);
    return res.render('admin/appointments-day', { title: 'Schedule', date, rows, cols, closed, prev: addDays(date, -1), next: addDays(date, 1) });
  }
  const f = {
    from: isDate(req.query.from) ? req.query.from : todayStr(), to: isDate(req.query.to) ? req.query.to : addDays(todayStr(), 30),
    status: STATUSES.includes(req.query.status) ? req.query.status : '', staff_id: /^\d+$/.test(req.query.staff_id || '') ? req.query.staff_id : '', q: clean(req.query.q, 80),
  };
  const where = ['a.date BETWEEN ? AND ?']; const args = [f.from, f.to];
  if (f.status) { where.push('a.status = ?'); args.push(f.status); }
  if (f.staff_id) { where.push('a.staff_id = ?'); args.push(f.staff_id); }
  if (f.q) { where.push('(p.full_name LIKE ? OR p.phone LIKE ? OR a.ref LIKE ? OR p.patient_code LIKE ?)'); args.push(...Array(4).fill(`%${f.q}%`)); }
  const total = db.prepare(`SELECT COUNT(*) n FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE ${where.join(' AND ')}`).get(...args).n;
  const pg = paginate(total, req.query.page, 30);
  const rows = db.prepare(`SELECT a.*, p.full_name patient_name, p.phone patient_phone, s.full_name staff_name, sv.title service_title
    FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id
    WHERE ${where.join(' AND ')} ORDER BY a.date, a.start_time LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset);
  res.render('admin/appointments-list', { title: 'Appointments', rows, f, pg, staffList: staff(), STATUSES });
});

router.get('/new', requirePerm('appointments.manage'), (req, res) => {
  const patient = /^\d+$/.test(req.query.patient || '') ? db.prepare('SELECT id, full_name, phone, patient_code FROM patients WHERE id = ?').get(req.query.patient) : null;
  res.render('admin/appointment-new', { title: 'New appointment', services: services(), staffList: staff(), patient,
    f: { date: isDate(req.query.date) ? req.query.date : todayStr(), staff_id: req.query.staff || '', time: isTime(req.query.time) ? req.query.time : '' } });
});

router.post('/new', requirePerm('appointments.manage'), async (req, res) => {
  const f = {
    patient_id: clean(req.body.patient_id, 10), service_id: clean(req.body.service_id, 10), staff_id: clean(req.body.staff_id, 10),
    date: clean(req.body.date, 10), time: clean(req.body.time, 5), complaint: clean(req.body.complaint, 1000), source: ['admin', 'phone', 'walk_in'].includes(req.body.source) ? req.body.source : 'admin',
    full_name: clean(req.body.full_name, 120), phone: clean(req.body.phone, 20), email: clean(req.body.email, 190).toLowerCase(),
    override: req.body.override === '1' && ['admin', 'receptionist'].includes(req.user.role), notify: req.body.notify === '1',
  };
  const fail = (msg) => res.status(400).render('admin/appointment-new', { title: 'New appointment', services: services(), staffList: staff(), patient: f.patient_id ? db.prepare('SELECT id, full_name, phone, patient_code FROM patients WHERE id = ?').get(f.patient_id) : null, f, error: msg });
  let patientId = /^\d+$/.test(f.patient_id) ? Number(f.patient_id) : null;
  if (!patientId) {
    if (f.full_name.length < 2 || !isPhone(f.phone)) return fail('Choose an existing patient, or enter a new patient\'s name and mobile number.');
    if (f.email && !isEmail(f.email)) return fail('Email address is not valid.');
    const p = booking.findOrCreatePatient({ full_name: f.full_name, phone: f.phone, email: f.email });
    patientId = p.id;
    audit(req, 'patient.create', 'patient', p.id, { via: 'appointment' });
  }
  try {
    const { appointment, manageToken } = booking.createAppointment({
      patientId, serviceId: Number(f.service_id), staffId: f.staff_id ? Number(f.staff_id) : null, date: f.date, time: f.time,
      complaint: f.complaint, source: f.source, createdBy: req.user.id, skipAvailability: f.override, staffMode: true,
    });
    audit(req, 'appointment.create', 'appointment', appointment.id, { override: f.override });
    if (f.notify) notifyAppointment(appointment, 'confirmed', manageToken).catch(console.error);
    req.flash('success', `Appointment ${appointment.ref} booked.`);
    res.redirect(`/admin/appointments/${appointment.id}`);
  } catch (e) { if (!e.userMessage) throw e; fail(e.userMessage); }
});

router.get('/:id', requirePerm('appointments.view'), (req, res, next) => {
  const a = booking.getAppointment(req.params.id);
  if (!a) return next();
  audit(req, 'appointment.view', 'appointment', a.id);
  const invoice = db.prepare("SELECT id, invoice_no, status, total FROM invoices WHERE appointment_id = ? AND status != 'void'").get(a.id);
  const notes = db.prepare('SELECT n.*, u.full_name author FROM clinical_notes n JOIN users u ON u.id=n.author_id WHERE appointment_id = ?').all(a.id);
  const notifs = db.prepare('SELECT * FROM notifications WHERE appointment_id = ? ORDER BY id DESC').all(a.id);
  res.render('admin/appointment', { title: `Appointment ${a.ref}`, a, invoice, notes, notifs, STATUSES, staffList: staff() });
});

router.post('/:id/status', requirePerm('appointments.manage'), async (req, res, next) => {
  const a = booking.getAppointment(req.params.id);
  if (!a) return next();
  const status = req.body.status;
  if (!STATUSES.includes(status)) return res.redirect(`/admin/appointments/${a.id}`);
  const reason = clean(req.body.reason, 300);
  db.prepare("UPDATE appointments SET status=?, cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END, updated_at=datetime('now','localtime') WHERE id=?").run(status, status, reason || 'Cancelled by clinic', a.id);
  audit(req, 'appointment.status', 'appointment', a.id, { from: a.status, to: status, reason });
  if (req.body.notify === '1' && (status === 'confirmed' || status === 'cancelled')) notifyAppointment(a.id, status).catch(console.error);
  req.flash('success', `Status changed to ${status.replace('_', ' ')}.`);
  res.redirect(req.body.back === 'day' ? `/admin/appointments?date=${a.date}` : `/admin/appointments/${a.id}`);
});

router.post('/:id/reschedule', requirePerm('appointments.manage'), async (req, res, next) => {
  const a = booking.getAppointment(req.params.id);
  if (!a) return next();
  try {
    const force = req.body.override === '1' && ['admin', 'receptionist'].includes(req.user.role);
    const na = booking.rescheduleAppointment(a.id, { date: clean(req.body.date, 10), time: clean(req.body.time, 5), staffId: req.body.staff_id ? Number(req.body.staff_id) : null, force, staffMode: true });
    audit(req, 'appointment.reschedule', 'appointment', a.id, { from: `${a.date} ${a.start_time}`, to: `${na.date} ${na.start_time}`, force });
    if (req.body.notify === '1') notifyAppointment(na, 'rescheduled').catch(console.error);
    req.flash('success', 'Appointment rescheduled.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); }
  res.redirect(`/admin/appointments/${a.id}`);
});

router.post('/:id/remind', requirePerm('appointments.manage'), async (req, res, next) => {
  const a = booking.getAppointment(req.params.id);
  if (!a) return next();
  await notifyAppointment(a, 'reminder_24h');
  audit(req, 'appointment.remind_manual', 'appointment', a.id);
  req.flash('success', 'Reminder sent (see delivery log below).');
  res.redirect(`/admin/appointments/${a.id}`);
});

router.post('/:id/note', requirePerm('appointments.manage'), (req, res) => {
  db.prepare("UPDATE appointments SET internal_note=?, updated_at=datetime('now','localtime') WHERE id=?").run(clean(req.body.internal_note, 2000) || null, req.params.id);
  audit(req, 'appointment.note', 'appointment', Number(req.params.id));
  req.flash('success', 'Note saved.');
  res.redirect(`/admin/appointments/${req.params.id}`);
});

module.exports = router;
