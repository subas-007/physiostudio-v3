'use strict';
const express = require('express');
const { db } = require('../../db');
const { audit, requirePerm } = require('../../lib/middleware');
const { clean, isDate, todayStr, paginate } = require('../../lib/util');
const billing = require('../../lib/billing');

const router = express.Router();
const METHODS = ['cash', 'card', 'esewa', 'khalti', 'fonepay', 'bank', 'other'];
const svcList = () => db.prepare('SELECT id, title, price FROM services ORDER BY sort_order').all();

router.get('/', requirePerm('invoices.view'), (req, res) => {
  const f = { status: ['unpaid', 'partial', 'paid', 'void'].includes(req.query.status) ? req.query.status : '', from: isDate(req.query.from) ? req.query.from : '', to: isDate(req.query.to) ? req.query.to : '', q: clean(req.query.q, 80) };
  const where = ['1=1']; const args = [];
  if (f.status) { where.push('i.status = ?'); args.push(f.status); }
  if (f.from) { where.push('i.issue_date >= ?'); args.push(f.from); }
  if (f.to) { where.push('i.issue_date <= ?'); args.push(f.to); }
  if (f.q) { where.push('(i.invoice_no LIKE ? OR p.full_name LIKE ? OR p.phone LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  const sql = `FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${sql}`).get(...args).n;
  const sums = db.prepare(`SELECT COALESCE(SUM(CASE WHEN i.status!='void' THEN i.total END),0) billed, COALESCE(SUM(CASE WHEN i.status!='void' THEN i.amount_paid END),0) paid ${sql}`).get(...args);
  const pg = paginate(total, req.query.page, 30);
  const rows = db.prepare(`SELECT i.*, p.full_name patient_name, p.patient_code ${sql} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...args, pg.per, pg.offset);
  res.render('admin/invoices', { title: 'Invoices', rows, f, pg, sums });
});

router.get('/new', requirePerm('invoices.manage'), (req, res) => {
  let patient = null, appointment = null, items = [];
  if (/^\d+$/.test(req.query.appointment || '')) {
    appointment = require('../../lib/booking').getAppointment(req.query.appointment);
    if (appointment) {
      const existing = db.prepare("SELECT id FROM invoices WHERE appointment_id = ? AND status != 'void'").get(appointment.id);
      if (existing) { req.flash('info', 'This appointment already has an invoice.'); return res.redirect(`/admin/invoices/${existing.id}`); }
      patient = db.prepare('SELECT id, full_name, phone, patient_code FROM patients WHERE id = ?').get(appointment.patient_id);
      items = [{ service_id: appointment.service_id, description: `${appointment.service_title} – ${appointment.date}`, qty: 1, unit_price: appointment.service_price }];
    }
  } else if (/^\d+$/.test(req.query.patient || '')) {
    patient = db.prepare('SELECT id, full_name, phone, patient_code FROM patients WHERE id = ?').get(req.query.patient);
  }
  res.render('admin/invoice-new', { title: 'New invoice', patient, appointment, items, services: svcList(), today: todayStr(), METHODS });
});

router.post('/new', requirePerm('invoices.manage'), (req, res) => {
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const desc = arr(req.body.item_description), qty = arr(req.body.item_qty), price = arr(req.body.item_price), sid = arr(req.body.item_service);
  const items = desc.map((d, i) => ({ description: clean(d, 200), qty: qty[i], unit_price: price[i], service_id: /^\d+$/.test(sid[i] || '') ? Number(sid[i]) : null }));
  try {
    const id = billing.createInvoice({
      patientId: Number(req.body.patient_id), appointmentId: /^\d+$/.test(req.body.appointment_id || '') ? Number(req.body.appointment_id) : null,
      items, discount: Number(req.body.discount) || 0, notes: clean(req.body.notes, 1000),
      issueDate: isDate(req.body.issue_date) ? req.body.issue_date : todayStr(), dueDate: isDate(req.body.due_date) ? req.body.due_date : null, userId: req.user.id,
    });
    audit(req, 'invoice.create', 'invoice', id);
    const payNow = Number(req.body.pay_amount) || 0;
    if (payNow > 0) {
      const receipt = billing.recordPayment({ invoiceId: id, amount: payNow, method: METHODS.includes(req.body.pay_method) ? req.body.pay_method : 'cash', reference: clean(req.body.pay_reference, 100), userId: req.user.id });
      audit(req, 'payment.create', 'invoice', id, { receipt, amount: payNow });
    }
    req.flash('success', 'Invoice created.');
    res.redirect(`/admin/invoices/${id}`);
  } catch (e) {
    if (!e.userMessage) throw e;
    req.flash('error', e.userMessage);
    res.redirect('/admin/invoices/new' + (req.body.patient_id ? `?patient=${Number(req.body.patient_id)}` : ''));
  }
});

router.get('/:id', requirePerm('invoices.view'), (req, res, next) => {
  const inv = billing.getInvoice(req.params.id);
  if (!inv) return next();
  audit(req, 'invoice.view', 'invoice', inv.id);
  res.render('admin/invoice', { title: inv.invoice_no, inv, METHODS });
});

router.get('/:id/print', requirePerm('invoices.view'), (req, res, next) => {
  const inv = billing.getInvoice(req.params.id);
  if (!inv) return next();
  audit(req, 'invoice.print', 'invoice', inv.id);
  res.render('admin/invoice-print', { layout: false, title: inv.invoice_no, inv, backUrl: `/admin/invoices/${inv.id}` });
});

router.post('/:id/pay', requirePerm('invoices.manage'), (req, res) => {
  try {
    const receipt = billing.recordPayment({ invoiceId: Number(req.params.id), amount: Number(req.body.amount), method: METHODS.includes(req.body.method) ? req.body.method : 'cash', reference: clean(req.body.reference, 100), userId: req.user.id });
    audit(req, 'payment.create', 'invoice', Number(req.params.id), { receipt, amount: Number(req.body.amount) });
    req.flash('success', `Payment recorded – receipt ${receipt}.`);
  } catch (e) { if (!e.userMessage) throw e; req.flash('error', e.userMessage); }
  res.redirect(`/admin/invoices/${req.params.id}`);
});

router.post('/:id/void', requirePerm('invoices.void'), (req, res, next) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return next();
  const reason = clean(req.body.reason, 300);
  if (!reason) { req.flash('error', 'A reason is required to void an invoice.'); return res.redirect(`/admin/invoices/${inv.id}`); }
  if (inv.amount_paid > 0) { req.flash('error', 'This invoice has payments. Record a refund outside the system and ask an admin, or issue a credit on a new invoice.'); return res.redirect(`/admin/invoices/${inv.id}`); }
  db.prepare("UPDATE invoices SET status='void', void_reason=? WHERE id=?").run(reason, inv.id);
  audit(req, 'invoice.void', 'invoice', inv.id, { reason });
  req.flash('success', 'Invoice voided.');
  res.redirect(`/admin/invoices/${inv.id}`);
});

module.exports = router;
