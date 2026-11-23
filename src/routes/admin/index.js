'use strict';
const express = require('express');
const { db } = require('../../db');
const { audit, requireStaff, requirePerm, can } = require('../../lib/middleware');
const { todayStr } = require('../../lib/util');
const { COOKIE } = require('../../lib/sessions');

const router = express.Router();
// Sign out of the staff area only. Declared before the staff guard so signing out is never redirected.
router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  req.session.destroy(() => { res.clearCookie(COOKIE.staff); res.redirect('/'); });
});
router.use(requireStaff);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.unread = db.prepare('SELECT COUNT(*) n FROM messages WHERE is_read = 0').get().n;
  res.locals.myStaff = db.prepare('SELECT * FROM staff WHERE user_id = ?').get(req.user.id) || null;
  next();
});

router.get('/', requirePerm('dashboard.view'), (req, res) => {
  const today = todayStr();
  const month = today.slice(0, 7);
  const mine = req.user.role === 'therapist' && res.locals.myStaff ? res.locals.myStaff.id : null;
  const todays = db.prepare(`SELECT a.*, p.full_name patient_name, p.phone patient_phone, p.patient_code, s.full_name staff_name, sv.title service_title
    FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id
    WHERE a.date = ? ${mine ? 'AND a.staff_id = ' + Number(mine) : ''} ORDER BY a.start_time`).all(today);
  const stats = {
    today: todays.filter((a) => !['cancelled'].includes(a.status)).length,
    pending: db.prepare("SELECT COUNT(*) n FROM appointments WHERE status='pending' AND date >= ?").get(today).n,
    upcomingWeek: db.prepare("SELECT COUNT(*) n FROM appointments WHERE status IN ('pending','confirmed') AND date BETWEEN ? AND date(?, '+7 day')").get(today, today).n,
    newPatients: db.prepare("SELECT COUNT(*) n FROM patients WHERE substr(created_at,1,7) = ?").get(month).n,
    totalPatients: db.prepare('SELECT COUNT(*) n FROM patients WHERE is_archived = 0').get().n,
    failedNotifications: db.prepare("SELECT COUNT(*) n FROM notifications WHERE status='failed' AND created_at >= datetime('now','localtime','-7 day')").get().n,
  };
  if (can(req.user, 'invoices.view')) {
    stats.collectedToday = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE substr(paid_at,1,10) = ?').get(today).v;
    stats.collectedMonth = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE substr(paid_at,1,7) = ?').get(month).v;
    stats.outstanding = db.prepare("SELECT COALESCE(SUM(total - amount_paid),0) v FROM invoices WHERE status IN ('unpaid','partial')").get().v;
  }
  // 14-day appointment trend for the sparkline
  const trend = db.prepare(`SELECT date, COUNT(*) n FROM appointments WHERE date BETWEEN date(?, '-13 day') AND ? AND status NOT IN ('cancelled') GROUP BY date`).all(today, today);
  res.render('admin/dashboard', { title: 'Dashboard', todays, stats, trend, mine });
});

router.use('/appointments', require('./appointments'));
router.use('/patients', require('./patients'));
router.use('/invoices', require('./invoices'));
router.use('/reports', require('./reports'));
router.use('/cms', require('./cms'));
router.use('/', require('./system'));

module.exports = router;
