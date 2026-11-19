# Security operations checklist
- [ ] `.env` mode 600; `SESSION_SECRET` and `APP_ENCRYPTION_KEY` are long random values stored in your password manager.
- [ ] Node listens on 127.0.0.1 only; firewall allows 22/80/443 (`ufw`); SSH key-only, fail2ban.
- [ ] TLS via certbot with auto-renew; test on ssllabs.com (target A+).
- [ ] Unattended security upgrades on; `npm audit` monthly.
- [ ] Nightly encrypted off-site backups; test a restore quarterly.
- [ ] Review Admin → Audit log weekly (filter `failed`, `forbidden`, `export`).
- [ ] Remove leavers immediately (untick Active: their sessions end at once).
- [ ] Every staff account has 2FA (Admin → Staff users, 2FA column).
- [ ] Annual VA/PT of the site; keep a record of processing activities.
