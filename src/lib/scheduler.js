'use strict';
const cron = require('node-cron');
const { db, getSetting } = require('../db');
const { notifyAppointment, flushQueue } = require('./notify');

let running = false;

/** Find appointments entering the 24h / 2h windows and send reminders exactly once. */
async function runReminders(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  const sent = { r24: 0, r2: 0 };
  try {
    if (getSetting('reminders_enabled', '1') !== '1') return sent;
    const rows = db.prepare(`SELECT id, date, start_time, reminder_24h_sent, reminder_2h_sent FROM appointments
      WHERE status IN ('confirmed','pending') AND date BETWEEN date(?, '-1 day') AND date(?, '+2 day')
        AND (reminder_24h_sent = 0 OR reminder_2h_sent = 0)`).all(localDate(now), localDate(now));
    for (const a of rows) {
      const mins = (new Date(`${a.date}T${a.start_time}:00`) - now) / 60000;
      if (mins <= 0) continue;
      if (!a.reminder_2h_sent && mins <= 120) {
        // Claim the reminder first (idempotent even with multiple app instances).
        const claimed = db.prepare('UPDATE appointments SET reminder_2h_sent = 1, reminder_24h_sent = 1 WHERE id = ? AND reminder_2h_sent = 0').run(a.id).changes;
        if (claimed) { await notifyAppointment(a.id, 'reminder_2h'); sent.r2++; }
      } else if (!a.reminder_24h_sent && mins <= 24 * 60) {
        const claimed = db.prepare('UPDATE appointments SET reminder_24h_sent = 1 WHERE id = ? AND reminder_24h_sent = 0').run(a.id).changes;
        if (claimed) { await notifyAppointment(a.id, 'reminder_24h'); sent.r24++; }
      }
    }
    await flushQueue();
  } catch (e) {
    console.error('[scheduler]', e);
  } finally {
    running = false;
  }
  return sent;
}

/** Auto-mark yesterday's unattended confirmed appointments as no-show (optional). */
function markNoShows() {
  if (getSetting('auto_no_show', '0') !== '1') return;
  db.prepare(`UPDATE appointments SET status='no_show', updated_at=datetime('now','localtime')
              WHERE status IN ('confirmed','pending') AND date < date('now','localtime')`).run();
}

function localDate(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

function start() {
  const tz = process.env.TZ || 'Asia/Kathmandu';
  cron.schedule('*/5 * * * *', () => { runReminders(); }, { timezone: tz });
  cron.schedule('30 0 * * *', markNoShows, { timezone: tz });
  console.log(`[scheduler] reminders every 5 min (${tz})`);
}

module.exports = { start, runReminders, markNoShows };
