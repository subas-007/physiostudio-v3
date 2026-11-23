'use strict';
// One session cookie per area. Staff (/admin) and patients (public site, /portal) stay signed in independently.
const PROD = process.env.NODE_ENV === 'production';

const COOKIE = {
  staff: PROD ? '__Host-ps_staff' : 'ps_staff',
  patient: PROD ? '__Host-ps_patient' : 'ps_patient',
};

module.exports = { COOKIE };
