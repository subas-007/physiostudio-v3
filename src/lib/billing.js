'use strict';
const { db, nextCounter, getSetting } = require('../db');
const { round2, todayStr } = require('./util');
const { userErr } = require('./booking');

/**
 * Nepal fiscal year runs Shrawan 1 – Ashadh end (≈ mid-July to mid-July).
 * Label in Bikram Sambat, e.g. 2083/84. Cut-over day is configurable (setting fy_start_mmdd, default 07-17).
 */
function fiscalYear(dateStr = todayStr()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [fm, fd] = getSetting('fy_start_mmdd', '07-17').split('-').map(Number);
  const afterStart = m > fm || (m === fm && d >= fd);
  const bsStart = (afterStart ? y : y - 1) + 57;
  return `${bsStart}/${String((bsStart + 1) % 100).padStart(2, '0')}`;
}

function nextInvoiceNo(dateStr) {
  const fy = fiscalYear(dateStr);
  const n = nextCounter(`invoice:${fy}`);
  return `${getSetting('invoice_prefix', 'PS')}-${fy.replace('/', '')}-${String(n).padStart(5, '0')}`;
}
function nextReceiptNo(dateStr) {
  const fy = fiscalYear(dateStr);
  const n = nextCounter(`receipt:${fy}`);
  return `RC-${fy.replace('/', '')}-${String(n).padStart(5, '0')}`;
}

function computeTotals(items, discount, taxRate) {
  const lines = items.map((it) => {
    const qty = Math.max(0, Number(it.qty) || 0);
    const unit = Math.max(0, Number(it.unit_price) || 0);
    return { ...it, qty, unit_price: unit, line_total: round2(qty * unit) };
  }).filter((l) => l.description && l.qty > 0);
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const disc = Math.min(subtotal, Math.max(0, round2(discount)));
  const rate = Math.max(0, Math.min(100, Number(taxRate) || 0));
  const tax = round2((subtotal - disc) * rate / 100);
  return { lines, subtotal, discount: disc, tax_rate: rate, tax_amount: tax, total: round2(subtotal - disc + tax) };
}

const createInvoice = db.transaction(({ patientId, appointmentId = null, items, discount = 0, taxRate, notes = '', dueDate = null, issueDate = todayStr(), userId }) => {
  if (!db.prepare('SELECT 1 FROM patients WHERE id = ?').get(patientId)) throw userErr('Patient not found.');
  const rate = taxRate == null ? Number(getSetting('tax_rate', '0')) : taxRate;
  const t = computeTotals(items, discount, rate);
  if (!t.lines.length) throw userErr('Add at least one line item.');
  const no = nextInvoiceNo(issueDate);
  const info = db.prepare(`INSERT INTO invoices(invoice_no, patient_id, appointment_id, issue_date, due_date, subtotal, discount, tax_rate, tax_amount, total, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(no, patientId, appointmentId, issueDate, dueDate, t.subtotal, t.discount, t.tax_rate, t.tax_amount, t.total, t.total > 0 ? 'unpaid' : 'paid', notes || null, userId);
  const ins = db.prepare('INSERT INTO invoice_items(invoice_id, service_id, description, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)');
  for (const l of t.lines) ins.run(info.lastInsertRowid, l.service_id || null, l.description, l.qty, l.unit_price, l.line_total);
  return info.lastInsertRowid;
});

const recordPayment = db.transaction(({ invoiceId, amount, method, reference, userId }) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw userErr('Invoice not found.');
  if (inv.status === 'void') throw userErr('Cannot take payment on a void invoice.');
  const amt = round2(amount);
  const balance = round2(inv.total - inv.amount_paid);
  if (!(amt > 0)) throw userErr('Enter a payment amount greater than zero.');
  if (amt > balance + 0.001) throw userErr(`Payment exceeds the balance due (${balance}).`);
  const receipt = nextReceiptNo(todayStr());
  db.prepare('INSERT INTO payments(invoice_id, receipt_no, amount, method, reference, received_by) VALUES (?,?,?,?,?,?)').run(invoiceId, receipt, amt, method, reference || null, userId);
  const paid = round2(inv.amount_paid + amt);
  db.prepare('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?').run(paid, paid >= inv.total - 0.001 ? 'paid' : 'partial', invoiceId);
  return receipt;
});

function getInvoice(id) {
  const inv = db.prepare(`SELECT i.*, p.full_name AS patient_name, p.patient_code, p.phone AS patient_phone, p.email AS patient_email, p.address AS patient_address,
      u.full_name AS created_by_name
    FROM invoices i JOIN patients p ON p.id = i.patient_id LEFT JOIN users u ON u.id = i.created_by WHERE i.id = ?`).get(id);
  if (!inv) return null;
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(id);
  inv.payments = db.prepare('SELECT pm.*, u.full_name AS received_by_name FROM payments pm LEFT JOIN users u ON u.id = pm.received_by WHERE invoice_id = ? ORDER BY pm.id').all(id);
  inv.balance = round2(inv.total - inv.amount_paid);
  return inv;
}

module.exports = { fiscalYear, computeTotals, createInvoice, recordPayment, getInvoice };
