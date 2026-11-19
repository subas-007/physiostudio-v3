'use strict';
/**
 * Patient notifications over Email (SMTP) and WhatsApp (Meta WhatsApp Cloud API or Twilio).
 * Every message is written to the `notifications` table first (outbox pattern), then delivered;
 * failures are retried by the scheduler up to MAX_ATTEMPTS.
 */
const nodemailer = require('nodemailer');
const { db, getSetting } = require('../db');
const { fmtDate, fmtTime, toE164 } = require('./util');

const MAX_ATTEMPTS = 3;
let transporter = null;

function mailer() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      requireTLS: String(process.env.SMTP_SECURE || 'false') !== 'true',
    });
  }
  return transporter;
}

const DEFAULT_TEMPLATES = {
  booking_received: 'Namaste {name}, we have received your appointment request at {clinic} for {service} on {date} at {time}. We will confirm shortly. Ref: {ref}',
  confirmed: 'Namaste {name}, your appointment at {clinic} is CONFIRMED for {date} at {time} with {therapist} ({service}). Ref: {ref}. Manage: {link}',
  reminder_24h: 'Reminder: {name}, you have a physiotherapy appointment tomorrow, {date} at {time} with {therapist} at {clinic}. Please wear comfortable clothing. To reschedule call {phone} or visit {link}',
  reminder_2h: 'Hi {name}, see you soon! Your appointment at {clinic} starts at {time} today. Address: {address}. Call {phone} if you are running late.',
  rescheduled: 'Namaste {name}, your appointment at {clinic} has been moved to {date} at {time} with {therapist}. Ref: {ref}',
  cancelled: 'Namaste {name}, your appointment at {clinic} on {date} at {time} has been cancelled. To book again visit {site} or call {phone}.',
};
const SUBJECTS = {
  booking_received: 'We received your appointment request',
  confirmed: 'Your appointment is confirmed',
  reminder_24h: 'Reminder: your appointment is tomorrow',
  reminder_2h: 'Your appointment is in 2 hours',
  rescheduled: 'Your appointment has been rescheduled',
  cancelled: 'Your appointment has been cancelled',
};

function vars(a, manageToken) {
  const site = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    name: a.patient_name.split(' ')[0],
    full_name: a.patient_name,
    date: fmtDate(a.date),
    time: fmtTime(a.start_time),
    therapist: a.staff_name || 'our physiotherapist',
    service: a.service_title || 'Physiotherapy',
    ref: a.ref,
    clinic: getSetting('clinic_name', 'Physio Studio'),
    phone: getSetting('phone_primary', ''),
    address: getSetting('address', ''),
    site,
    link: manageToken ? `${site}/appointment/manage/${a.ref}?t=${manageToken}` : `${site}/portal`,
  };
}
const render = (tpl, v) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ''));

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function emailHtml(text, v) {
  const brand = getSetting('brand_color', '#0f766e');
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:${brand};color:#fff;padding:20px 28px;font-size:20px;font-weight:600">${escapeHtml(v.clinic)}</td></tr>
  <tr><td style="padding:28px;font-size:15px;line-height:1.6">${escapeHtml(text).replace(/\n/g, '<br>')}
    <table style="margin:20px 0;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 16px 4px 0;color:#64748b">Date</td><td><b>${escapeHtml(v.date)}</b></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#64748b">Time</td><td><b>${escapeHtml(v.time)}</b></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#64748b">Therapist</td><td>${escapeHtml(v.therapist)}</td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#64748b">Reference</td><td>${escapeHtml(v.ref)}</td></tr>
    </table>
    <a href="${escapeHtml(v.link)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">View or manage appointment</a>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#64748b">${escapeHtml(v.address)} · ${escapeHtml(v.phone)}<br>You receive this because you booked with us. Reply STOP or ask reception to opt out.</td></tr>
  </table></td></tr></table></body></html>`;
}

// ---------- Channel adapters ----------
async function sendEmail(to, subject, text, html) {
  const t = mailer();
  if (!t) return { skipped: true, error: 'SMTP not configured' };
  const info = await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
  return { id: info.messageId };
}

async function sendWhatsApp(to, kind, text, v) {
  const provider = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();
  const e164 = toE164(to, getSetting('country_code', '977'));
  if (provider === 'meta') {
    // Business-initiated messages need a pre-approved template. Map kind -> template name via env, e.g.
    // WA_TEMPLATE_REMINDER_24H=appointment_reminder (body params: {{1}} name, {{2}} date, {{3}} time, {{4}} therapist)
    const tpl = process.env[`WA_TEMPLATE_${kind.toUpperCase()}`];
    const url = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}/${process.env.META_WA_PHONE_NUMBER_ID}/messages`;
    const body = tpl
      ? { messaging_product: 'whatsapp', to: e164.replace('+', ''), type: 'template',
          template: { name: tpl, language: { code: process.env.WA_TEMPLATE_LANG || 'en' },
            components: [{ type: 'body', parameters: [v.name, v.date, v.time, v.therapist].map((t) => ({ type: 'text', text: String(t) })) }] } }
      : { messaging_product: 'whatsapp', to: e164.replace('+', ''), type: 'text', text: { body: text } };
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.META_WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Meta WA ${r.status}: ${(j.error && j.error.message) || 'error'}`);
    return { id: j.messages && j.messages[0] && j.messages[0].id };
  }
  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const form = new URLSearchParams({ From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, To: `whatsapp:${e164}`, Body: text });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64') },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twilio ${r.status}: ${j.message || 'error'}`);
    return { id: j.sid };
  }
  return { skipped: true, error: 'WhatsApp provider not configured' };
}

// ---------- Outbox ----------
async function deliver(row) {
  const a = row.appointment_id ? require('./booking').getAppointment(row.appointment_id) : null;
  const v = a ? vars(a, row._token) : {};
  const text = render(getSetting(`tpl_${row.kind}`, DEFAULT_TEMPLATES[row.kind] || ''), v);
  try {
    const res = row.channel === 'email'
      ? await sendEmail(row.recipient, `${SUBJECTS[row.kind] || 'Update'} – ${v.clinic}`, text, emailHtml(text, v))
      : await sendWhatsApp(row.recipient, row.kind, text, v);
    if (res.skipped) {
      db.prepare("UPDATE notifications SET status='skipped', error=?, attempts=attempts+1 WHERE id=?").run(res.error, row.id);
      if (process.env.NODE_ENV !== 'production') console.log(`[notify:dry-run] ${row.channel} -> ${row.recipient}: ${text}`);
    } else {
      db.prepare("UPDATE notifications SET status='sent', provider_id=?, sent_at=datetime('now','localtime'), attempts=attempts+1, error=NULL WHERE id=?").run(res.id || null, row.id);
    }
  } catch (err) {
    const attempts = row.attempts + 1;
    db.prepare('UPDATE notifications SET status=?, attempts=?, error=? WHERE id=?').run(attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', attempts, String(err.message).slice(0, 500), row.id);
    console.error(`[notify] ${row.channel} #${row.id} failed: ${err.message}`);
  }
}

/**
 * Queue and send a notification for an appointment on every channel the patient opted into.
 * manageToken (optional) is embedded in the link only for the immediate send; it is never stored.
 */
async function notifyAppointment(appointmentOrId, kind, manageToken = null) {
  const a = typeof appointmentOrId === 'object' ? appointmentOrId : require('./booking').getAppointment(appointmentOrId);
  if (!a) return;
  const channels = [];
  if (getSetting('notify_email_enabled', '1') === '1' && a.notify_email && a.patient_email) channels.push(['email', a.patient_email]);
  if (getSetting('notify_whatsapp_enabled', '1') === '1' && a.notify_whatsapp && (a.patient_whatsapp || a.patient_phone)) channels.push(['whatsapp', a.patient_whatsapp || a.patient_phone]);
  for (const [channel, recipient] of channels) {
    const info = db.prepare('INSERT INTO notifications(appointment_id, patient_id, channel, kind, recipient) VALUES (?,?,?,?,?)').run(a.id, a.patient_id, channel, kind, recipient);
    const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
    row._token = manageToken;
    await deliver(row);
  }
}

/** Retry queued notifications (called by the scheduler). */
async function flushQueue() {
  const rows = db.prepare(`SELECT * FROM notifications WHERE status='queued' AND attempts > 0 AND attempts < ? ORDER BY id LIMIT 50`).all(MAX_ATTEMPTS);
  for (const r of rows) await deliver(r);
}

/** Staff email (password resets, contact-form alerts). */
async function sendStaffEmail(to, subject, text) {
  try { return await sendEmail(to, subject, text, `<pre style="font-family:inherit">${escapeHtml(text)}</pre>`); }
  catch (e) { console.error('[mail]', e.message); return { error: e.message }; }
}

module.exports = { notifyAppointment, flushQueue, sendStaffEmail, sendWhatsApp, DEFAULT_TEMPLATES, render, vars };
