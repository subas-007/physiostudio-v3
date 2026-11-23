'use strict';
/* Why-us icons must be files that ship with the project, not links to the old site. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-why-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.ADMIN_PASSWORD = `Pw-${crypto.randomBytes(18).toString('base64url')}-9!`;
process.env.SESSION_SECRET = crypto.randomBytes(24).toString('base64url');

const { db } = require('../src/db');
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('every why-us icon is a project icon file that exists', () => {
  require('../src/seed').seed();
  const rows = db.prepare('SELECT title, icon FROM why_us ORDER BY sort_order, id').all();
  assert.equal(rows.length, 8);
  for (const r of rows) {
    assert.match(r.icon, /^\/static\/img\/n-[a-z]+\.svg$/, `${r.title}: uses a project icon`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', r.icon.replace('/static/', ''))), `${r.title}: file exists`);
  }
});
