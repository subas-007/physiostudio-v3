'use strict';
const { db, nextCounter, getSetting } = require('../db');
const { toMin, fromMin, todayStr, nowTime, isDate, isTime, addDays } = require('./util');
const { randomToken, sha256 } = require('./security');

const ACTIVE = "('pending','confirmed','checked_in','completed')";

function clinicClosed(date) {
  return !!db.prepare('SELECT 1 FROM staff_leave WHERE staff_id IS NULL AND date = ?').get(date);
}

/**
 * Compute free slots for a date.
 * Returns [{ time:'09:00', end:'09:45', staff:[ids…] }]
 */
function availableSlots(date, serviceId, staffId = null, { ignoreAppointmentId = null, staffMode = false } = {}) {
  if (!isDate(date)) return [];
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
  if (!service) return [];
  const duration = service.duration_min || 45;
  const step = parseInt(getSetting('slot_step_min', '15'), 10) || 15;
  // Staff (reception) can book right up to 'now' and further ahead than patients.
  const leadMin = staffMode ? 0 : parseInt(getSetting('booking_lead_min', '60'), 10) || 0;
  const horizon = staffMode ? 365 : parseInt(getSetting('booking_horizon_days', '60'), 10) || 60;
  const today = todayStr();
  if (date < today || date > addDays(today, horizon)) return [];
  if (clinicClosed(date)) return [];

  const weekday = new Date(date + 'T00:00:00').getDay();
  const staffList = staffId
    ? db.prepare('SELECT id FROM staff WHERE id = ? AND is_bookable = 1').all(staffId)
    : db.prepare('SELECT id FROM staff WHERE is_bookable = 1 ORDER BY sort_order').all();

  const minStart = date === today ? toMin(nowTime()) + leadMin : 0;
  const slots = new Map();

  for (const { id } of staffList) {
    if (db.prepare('SELECT 1 FROM staff_leave WHERE staff_id = ? AND date = ?').get(id, date)) continue;
    const hours = db.prepare('SELECT start_time, end_time FROM staff_hours WHERE staff_id = ? AND weekday = ?').all(id, weekday);
    const busy = db.prepare(`SELECT start_time, end_time FROM appointments WHERE staff_id = ? AND date = ? AND status IN ${ACTIVE} AND id IS NOT ?`)
      .all(id, date, ignoreAppointmentId).map((a) => [toMin(a.start_time), toMin(a.end_time)]);
    for (const h of hours) {
      const open = toMin(h.start_time), close = toMin(h.end_time);
      let t = Math.ceil(Math.max(open, minStart) / step) * step;
      for (; t + duration <= close; t += step) {
        const end = t + duration;
        if (busy.some(([s, e]) => t < e && end > s)) continue;
        const key = fromMin(t);
        if (!slots.has(key)) slots.set(key, { time: key, end: fromMin(end), staff: [] });
        slots.get(key).staff.push(id);
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function newRef() {
  // Short, unguessable-enough human reference (not a secret; the manage token is).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = require('crypto').randomBytes(6);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `PS-${s}`;
}

/**
 * Create a booking atomically. Re-checks availability inside the transaction to prevent double booking.
 * Returns { appointment, manageToken } or throws Error with .userMessage
 */
const createAppointment = db.transaction((opts) => {
  const { patientId, serviceId, date, time, staffId = null, source = 'web', complaint = '', createdBy = null, status } = opts;
  if (!isDate(date) || !isTime(time)) throw userErr('Please choose a valid date and time.');
  const service = db.prepare('SELECT * FROM services WHERE id = ? AND is_bookable = 1').get(serviceId);
  if (!service) throw userErr('Please choose a service.');

  let assigned = staffId ? Number(staffId) : null;
  if (opts.skipAvailability) {
    if (!assigned) throw userErr('Please choose a therapist.');
  } else {
    const slot = availableSlots(date, serviceId, staffId, { staffMode: !!opts.staffMode }).find((s) => s.time === time);
    if (!slot) throw userErr('Sorry, that time was just taken or is no longer available. Please pick another slot.');
    if (!assigned) {
      // Load-balance: the therapist with the fewest appointments that day.
      assigned = slot.staff
        .map((id) => ({ id, n: db.prepare(`SELECT COUNT(*) n FROM appointments WHERE staff_id = ? AND date = ? AND status IN ${ACTIVE}`).get(id, date).n }))
        .sort((a, b) => a.n - b.n)[0].id;
    }
  }
  const end = fromMin(toMin(time) + service.duration_min);
  const autoConfirm = getSetting('auto_confirm_online', '1') === '1';
  const finalStatus = status || (source === 'admin' || source === 'phone' || source === 'walk_in' || autoConfirm ? 'confirmed' : 'pending');
  const manageToken = randomToken(24);

  // Pre-mark reminders that would fire immediately (booked inside the reminder window).
  const startsInMin = (new Date(`${date}T${time}:00`) - Date.now()) / 60000;
  const r24 = startsInMin <= 26 * 60 ? 1 : 0;
  const r2 = startsInMin <= 2.5 * 60 ? 1 : 0;

  let ref;
  do { ref = newRef(); } while (db.prepare('SELECT 1 FROM appointments WHERE ref = ?').get(ref));
  const info = db.prepare(`INSERT INTO appointments(ref, patient_id, staff_id, service_id, date, start_time, end_time, status, source, complaint, manage_token_hash, reminder_24h_sent, reminder_2h_sent, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, patientId, assigned, serviceId, date, time, end, finalStatus, source, complaint || null, sha256(manageToken), r24, r2, createdBy);
  return { appointment: getAppointment(info.lastInsertRowid), manageToken };
});

const rescheduleAppointment = db.transaction((id, { date, time, staffId = null, force = false, staffMode = false }) => {
  const a = getAppointment(id);
  if (!a) throw userErr('Appointment not found.');
  if (['cancelled', 'completed', 'no_show'].includes(a.status)) throw userErr('This appointment can no longer be changed.');
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(a.service_id);
  let assigned = staffId ? Number(staffId) : a.staff_id;
  if (!force) {
    const slot = availableSlots(date, a.service_id, staffId || null, { ignoreAppointmentId: id, staffMode }).find((s) => s.time === time);
    if (!slot) throw userErr('That time is not available.');
    if (!slot.staff.includes(assigned)) assigned = slot.staff[0];
  }
  const end = fromMin(toMin(time) + service.duration_min);
  const startsInMin = (new Date(`${date}T${time}:00`) - Date.now()) / 60000;
  db.prepare(`UPDATE appointments SET date=?, start_time=?, end_time=?, staff_id=?, reminder_24h_sent=?, reminder_2h_sent=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(date, time, end, assigned, startsInMin <= 26 * 60 ? 1 : 0, startsInMin <= 2.5 * 60 ? 1 : 0, id);
  return getAppointment(id);
});

function getAppointment(id) {
  return db.prepare(`SELECT a.*, p.full_name AS patient_name, p.phone AS patient_phone, p.email AS patient_email, p.whatsapp AS patient_whatsapp,
      p.patient_code, p.notify_email, p.notify_whatsapp, p.consent_communication,
      s.full_name AS staff_name, sv.title AS service_title, sv.price AS service_price, sv.duration_min, pk.title AS package_title
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN staff s ON s.id = a.staff_id
    LEFT JOIN services sv ON sv.id = a.service_id
    LEFT JOIN packages pk ON pk.id = a.package_id
    WHERE a.id = ?`).get(id);
}

/** Can a patient still self-cancel? (cut-off hours before start) */
function patientCanChange(a) {
  if (!['pending', 'confirmed'].includes(a.status)) return false;
  const cutoff = parseInt(getSetting('cancel_cutoff_hours', '3'), 10) || 0;
  return new Date(`${a.date}T${a.start_time}:00`) - Date.now() > cutoff * 3600 * 1000;
}

/** Find an existing patient by phone/email or create one. */
function findOrCreatePatient({ full_name, phone, email, whatsapp, gender, date_of_birth, consent_communication }) {
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  let p = db.prepare("SELECT * FROM patients WHERE substr(replace(replace(replace(phone,'+',''),'-',''),' ',''), -10) = ? AND lower(full_name) = lower(?)").get(digits, full_name);
  if (!p && email) p = db.prepare('SELECT * FROM patients WHERE email = ? AND lower(full_name) = lower(?)').get(email, full_name);
  if (p) {
    db.prepare("UPDATE patients SET email = COALESCE(NULLIF(?, ''), email), whatsapp = COALESCE(NULLIF(?, ''), whatsapp), updated_at = datetime('now','localtime') WHERE id = ?").run(email || '', whatsapp || '', p.id);
    return db.prepare('SELECT * FROM patients WHERE id = ?').get(p.id);
  }
  return createPatient({ full_name, phone, email, whatsapp, gender, date_of_birth, consent_communication });
}

function createPatient(f) {
  const code = `PSP-${String(nextCounter('patient')).padStart(5, '0')}`;
  const info = db.prepare(`INSERT INTO patients(patient_code, user_id, full_name, gender, date_of_birth, phone, whatsapp, email, address, occupation,
      emergency_contact_name, emergency_contact_phone, referred_by, medical_history, allergies, current_medications,
      consent_treatment, consent_communication, consent_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CASE WHEN ? THEN datetime('now','localtime') END)`).run(
    code, f.user_id || null, f.full_name, f.gender || null, f.date_of_birth || null, f.phone, f.whatsapp || null, f.email || null,
    f.address || null, f.occupation || null, f.emergency_contact_name || null, f.emergency_contact_phone || null, f.referred_by || null,
    f.medical_history || null, f.allergies || null, f.current_medications || null,
    f.consent_treatment ? 1 : 0, f.consent_communication ? 1 : 0, f.consent_communication ? 1 : 0,
  );
  return db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
}

function userErr(msg) { const e = new Error(msg); e.userMessage = msg; return e; }

module.exports = { availableSlots, createAppointment, rescheduleAppointment, getAppointment, patientCanChange, findOrCreatePatient, createPatient, clinicClosed, userErr, ACTIVE };
