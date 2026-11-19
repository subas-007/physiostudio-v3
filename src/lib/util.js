'use strict';
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); };
const localDateTime = (date, time) => new Date(`${date}T${time}:00`);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
const money = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80) || 'item';
}

/** Normalise Nepali phone numbers to E.164 (+977…). */
function toE164(phone, cc = '977') {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith(cc)) return '+' + p;
  if (p.startsWith('0')) p = p.slice(1);
  return `+${cc}${p}`;
}
const isEmail = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(s || ''));
const isPhone = (s) => /^\+?[\d\s-]{7,16}$/.test(String(s || ''));
const clean = (s, max = 2000) => String(s == null ? '' : s).trim().slice(0, max);

const SANITIZE = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'blockquote', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'title', 'rel', 'target'], img: ['src', 'alt', 'title', 'loading'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
  },
};
/** Render admin-authored Markdown to sanitised HTML (defence-in-depth against stored XSS). */
const md = (src) => sanitizeHtml(marked.parse(String(src || ''), { async: false }), SANITIZE);

function paginate(total, page, per = 25) {
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  return { page: p, pages, per, offset: (p - 1) * per, total };
}

function csvEscape(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV/formula injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows, cols) => [cols.map((c) => csvEscape(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n');

function ageFrom(dob) {
  if (!isDate(dob)) return '';
  const d = new Date(dob + 'T00:00:00'), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

module.exports = {
  pad, todayStr, nowTime, toMin, fromMin, addDays, localDateTime, isDate, isTime, DAYS,
  fmtDate, fmtTime, money, round2, slugify, toE164, isEmail, isPhone, clean, md, paginate, toCsv, ageFrom,
};
