'use strict';
/** Live, data-driven bits of the public site: open-now status, next free appointment, reading time. */
const { db, getSetting } = require('../db');
const { todayStr, addDays, toMin, nowTime, fmtTime, DAYS } = require('./util');
const { availableSlots, clinicClosed } = require('./booking');

/** Clinic opening window for a date = earliest start / latest finish across bookable therapists. */
function hoursFor(date) {
  if (clinicClosed(date)) return null;
  const wd = new Date(date + 'T00:00:00').getDay();
  const r = db.prepare('SELECT MIN(h.start_time) open, MAX(h.end_time) close FROM staff_hours h JOIN staff s ON s.id = h.staff_id WHERE s.is_bookable = 1 AND h.weekday = ?').get(wd);
  return r && r.open ? r : null;
}

function clinicStatus(now = new Date()) {
  const today = todayStr(now);
  const t = toMin(nowTime(now));
  const h = hoursFor(today);
  if (h && t >= toMin(h.open) && t < toMin(h.close)) return { open: true, text: `Open now, until ${fmtTime(h.close)}` };
  for (let i = h && t < toMin(h.open) ? 0 : 1; i <= 14; i++) {
    const d = addDays(today, i);
    const hh = hoursFor(d);
    if (hh) {
      const day = i === 0 ? 'today' : i === 1 ? 'tomorrow' : DAYS[new Date(d + 'T00:00:00').getDay()];
      return { open: false, text: `Closed now, opens ${day} at ${fmtTime(hh.open)}` };
    }
  }
  return { open: false, text: 'Closed' };
}

let cache = { at: 0, value: null };
/** Earliest bookable slot in the next 14 days for the default (first bookable) service. Cached 60 s. */
function nextAvailable() {
  if (Date.now() - cache.at < 60000) return cache.value;
  let value = null;
  const svc = db.prepare('SELECT id, title FROM services WHERE is_bookable = 1 ORDER BY sort_order, id LIMIT 1').get();
  if (svc) {
    for (let i = 0; i < 14 && !value; i++) {
      const date = addDays(todayStr(), i);
      const slot = availableSlots(date, svc.id)[0];
      if (slot) {
        const staff = db.prepare('SELECT full_name FROM staff WHERE id = ?').get(slot.staff[0]);
        value = { date, time: slot.time, serviceId: svc.id, staffName: staff ? staff.full_name : '',
          dayLabel: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) };
      }
    }
  }
  cache = { at: Date.now(), value };
  return value;
}
nextAvailable.reset = () => { cache = { at: 0, value: null }; };

const readingTime = (text) => Math.max(1, Math.round(String(text || '').split(/\s+/).length / 200));

/** Accepts a YouTube URL or bare id; returns the 11-char id or ''. */
function youtubeId(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : '';
}

function announcement() {
  if (getSetting('announcement_enabled', '0') !== '1') return null;
  const text = getSetting('announcement_text', '');
  const until = getSetting('announcement_until', '');
  if (!text || (until && until < todayStr())) return null;
  const link = getSetting('announcement_link', '');
  return { text, link: /^\/(?!\/)|^https:\/\//.test(link) ? link : '' };
}

module.exports = { clinicStatus, nextAvailable, readingTime, youtubeId, announcement, hoursFor };
