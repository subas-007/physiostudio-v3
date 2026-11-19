'use strict';
const express = require('express');
const { db } = require('../../db');
const { audit, requirePerm } = require('../../lib/middleware');
const { isDate, todayStr, toCsv } = require('../../lib/util');

const router = express.Router();
router.use(requirePerm('reports.view'));

function range(q) {
  const t = todayStr();
  return { from: isDate(q.from) ? q.from : t.slice(0, 8) + '01', to: isDate(q.to) ? q.to : t };
}

router.get('/', (req, res) => {
  const r = range(req.query);
  const billed = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(discount),0) discount FROM invoices WHERE status != 'void' AND issue_date BETWEEN ? AND ?").get(r.from, r.to);
  const collected = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE substr(paid_at,1,10) BETWEEN ? AND ?').get(r.from, r.to).v;
  const outstanding = db.prepare("SELECT COALESCE(SUM(total-amount_paid),0) v FROM invoices WHERE status IN ('unpaid','partial')").get().v;
  const byMethod = db.prepare('SELECT method, COUNT(*) n, SUM(amount) v FROM payments WHERE substr(paid_at,1,10) BETWEEN ? AND ? GROUP BY method ORDER BY v DESC').all(r.from, r.to);
  const byService = db.prepare(`SELECT COALESCE(s.title, ii.description) label, SUM(ii.qty) qty, SUM(ii.line_total) v FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN services s ON s.id=ii.service_id
    WHERE i.status != 'void' AND i.issue_date BETWEEN ? AND ? GROUP BY label ORDER BY v DESC LIMIT 15`).all(r.from, r.to);
  const appt = db.prepare(`SELECT status, COUNT(*) n FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status`).all(r.from, r.to);
  const byTherapist = db.prepare(`SELECT COALESCE(st.full_name,'Unassigned') name, COUNT(*) n, SUM(a.status='completed') done, SUM(a.status='no_show') noshow FROM appointments a LEFT JOIN staff st ON st.id=a.staff_id
    WHERE a.date BETWEEN ? AND ? AND a.status != 'cancelled' GROUP BY name ORDER BY n DESC`).all(r.from, r.to);
  const daily = db.prepare('SELECT substr(paid_at,1,10) d, SUM(amount) v FROM payments WHERE substr(paid_at,1,10) BETWEEN ? AND ? GROUP BY d ORDER BY d').all(r.from, r.to);
  const sources = db.prepare('SELECT source, COUNT(*) n FROM appointments WHERE date BETWEEN ? AND ? GROUP BY source').all(r.from, r.to);
  res.render('admin/reports', { title: 'Reports', r, billed, collected, outstanding, byMethod, byService, appt, byTherapist, daily, sources });
});

const EXPORTS = {
  invoices: {
    sql: `SELECT i.*, p.full_name, p.patient_code FROM invoices i JOIN patients p ON p.id=i.patient_id WHERE i.issue_date BETWEEN ? AND ? ORDER BY i.id`,
    cols: [['invoice_no', 'Invoice'], ['issue_date', 'Date'], ['patient_code', 'Patient ID'], ['full_name', 'Patient'], ['subtotal', 'Subtotal'], ['discount', 'Discount'], ['tax_amount', 'Tax'], ['total', 'Total'], ['amount_paid', 'Paid'], ['status', 'Status'], ['void_reason', 'Void reason']],
  },
  payments: {
    sql: `SELECT pm.*, i.invoice_no, p.full_name, u.full_name received_by_name FROM payments pm JOIN invoices i ON i.id=pm.invoice_id JOIN patients p ON p.id=i.patient_id LEFT JOIN users u ON u.id=pm.received_by WHERE substr(pm.paid_at,1,10) BETWEEN ? AND ? ORDER BY pm.id`,
    cols: [['receipt_no', 'Receipt'], ['paid_at', 'Paid at'], ['invoice_no', 'Invoice'], ['full_name', 'Patient'], ['amount', 'Amount'], ['method', 'Method'], ['reference', 'Reference'], ['received_by_name', 'Received by']],
  },
  appointments: {
    sql: `SELECT a.*, p.full_name, p.patient_code, s.full_name staff_name, sv.title service FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN services sv ON sv.id=a.service_id WHERE a.date BETWEEN ? AND ? ORDER BY a.date, a.start_time`,
    cols: [['ref', 'Ref'], ['date', 'Date'], ['start_time', 'Start'], ['end_time', 'End'], ['patient_code', 'Patient ID'], ['full_name', 'Patient'], ['staff_name', 'Therapist'], ['service', 'Service'], ['status', 'Status'], ['source', 'Source']],
  },
};

router.get('/export/:type.csv', (req, res, next) => {
  const ex = EXPORTS[req.params.type];
  if (!ex) return next();
  const r = range(req.query);
  const rows = db.prepare(ex.sql).all(r.from, r.to);
  audit(req, 'report.export', null, null, { type: req.params.type, ...r, rows: rows.length });
  res.set('Content-Disposition', `attachment; filename="physiostudio-${req.params.type}-${r.from}_${r.to}.csv"`);
  res.type('text/csv').send('﻿' + toCsv(rows, ex.cols.map(([key, label]) => ({ key, label }))));
});

module.exports = router;
