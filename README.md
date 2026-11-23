# Physio Studio – website, patient portal & clinic management

A rebuild of **physiostudio.com.np** with the existing photos and content, plus:

| Area | What you get |
|---|---|
| **Public website** | Modern, mobile-first, SEO-ready (sitemap, schema.org `MedicalClinic`, 301 redirects from every old URL). Home, About, Services, Team, Testimonials, Blog, FAQ, Contact (+ Google Map), Privacy notice, WhatsApp chat button. |
| **Online booking** | Live slot availability per therapist/service, auto-assigns the least-busy therapist, prevents double-booking at database-transaction level, respects working hours, Saturday closure, holidays and leave. Instant confirmation + secure "manage" link so patients can reschedule/cancel without an account. |
| **Patient portal** | Self-registration (auto-links to an existing record by name + mobile), upcoming/past visits, reschedule/cancel (cut-off configurable), invoices (print/PDF), profile and reminder preferences. |
| **Admin back-office** | Dashboard, day-board schedule per therapist, phone/walk-in booking with override, check-in → complete flow, patient registry with search/archive, SOAP clinical notes (sign & lock, amendments), printable patient record. |
| **Invoices & records** | Fiscal-year numbering (e.g. `PS-208384-00001`, BS FY from Shrawan 1), line items from service catalogue, discounts, optional tax, part-payments with receipt numbers, eSewa/Khalti/Fonepay/card/cash/bank, void-with-reason (never delete), printable invoice/receipt, reports and CSV exports. |
| **CMS** | Separate content management: page text and images, services (price, duration), team (photos, bios, working hours), testimonials, blog (Markdown), FAQ, "Why us", body areas, media library, contact-form inbox, branding colours, contact details. |
| **Reminders** | Automatic **email + WhatsApp**: booking confirmation, 24-hour and 2-hour reminders, reschedule and cancellation notices. Editable message templates, delivery log, automatic retries, "send reminder now". |
| **Users** | Roles: admin, therapist, receptionist, accountant, patient, with a least-privilege permission matrix. |

## Version 3: original content, clinic photos and home slider
- **Wording from the original physiostudio.com.np:** About Us, the founder's full letter, mission and vision, all seven service descriptions, Dr. Pragya Pyakurel's biography, the "Why us" texts, all six patient reviews and the blog article (typos corrected). Two sections, the mission's "commitments" and the vision's "three pillars", are cut off mid-sentence on the old site itself, so only their opening sentences are used.
- **Clinic photos** (reception, treatment floor, exercise session, senior care) are bundled in `public/img/clinic/`, resized for the web with metadata stripped. They are used in the slider, the gallery and the About page.
- **Home page slider** (Website → Home page slider): photo, headline, text, button, a crop focus point and an optional phone-sized image per slide. It autoplays every 6.5 s with a progress bar on the active dot, and pauses on hover, on keyboard focus, when the tab is hidden, or with the pause button. It also works with arrow keys and swipe, and does not autoplay for visitors who turn off animations.
- **Brand colours** now follow the logo: gold `#f0b323` and charcoal `#2e3236`. Change them in Settings.
- **Broken images fixed:** two images the old site referenced (`about/9f30…jpg`, `about/44fb…jpg`) no longer exist on its server. The founder section now uses Dr. Pragya's portrait, and the About page uses the treatment-floor photo.
- Upgrading from v2 is automatic. Text you have already edited in the CMS is not replaced.

## Version 2: redesign and new features
- **New visual identity:** pine and marigold colours. Bricolage Grotesque for headings and Atkinson Hyperlegible for body text, chosen because it reads well for older patients. Fonts are self-hosted, so pages make no requests to Google Fonts.
- **"Where does it hurt?" body map** on the home page. Tapping an area shows what is treated, the recommended service and a "Book for knee pain" button that pre-fills the booking. Edit it in Website → Body map areas (position, text, linked service).
- **Live availability:** the hero shows the next free appointment, linking straight to that slot. An open-now/closed status is computed from therapist hours and holidays.
- **Care plans** (Website → Care plans): pricing cards, with "Ask us" shown until a price is entered. "Start this plan" books an assessment and tags the appointment with the plan.
- **Announcement bar** (Settings → Announcement bar) with an optional link and an end date. Visitors can dismiss it.
- **Home exercise library** (Website → Exercise videos): paste a YouTube link and choose a body area. Videos load in privacy-enhanced mode only when the visitor presses play. The menu link appears once a video exists.
- **Photo gallery** with full-screen viewer (Website → Photo gallery).
- **Patient stories carousel** with star ratings and an optional Google reviews link.
- **Blog categories**, reading time and related articles.
- **FAQ search** and a **request-a-callback** form. Callback requests arrive in Messages and by email.
- **Mobile action bar** with Call, WhatsApp and Book buttons.
- **Upgrading an existing install:** new tables, columns, settings and starter content are added automatically on start-up. Content you have already edited is never overwritten.

## Security controls
- Passwords: scrypt (N=2^15), 10+ characters with complexity rules, banned-word list; lockout after 5 failures (15 min), plus IP rate-limiting on login, 2FA, registration, reset, booking and contact.
- **Mandatory TOTP 2FA for all staff** (Google/Microsoft Authenticator); secrets AES-256-GCM encrypted at rest. Forced password change on first login. Keep `APP_ENCRYPTION_KEY` unchanged: if it changes, two-factor secrets can't be read. To recover one account, run `npm run reset-2fa -- email@domain` on the server; the account sets two-factor up again at its next sign-in.
- Sessions: server-side SQLite store, `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production, regenerated on login, idle timeout (30 min staff / 60 min patients), all sessions killed on password reset/deactivation.
- CSRF tokens on every state-changing request; strict CSP (no inline script or style, self-hosted fonts, YouTube only via youtube-nocookie on click), HSTS, `frame-ancestors 'none'`, nosniff, Referrer/Permissions-Policy.
- All output HTML-escaped; admin Markdown sanitised (stored-XSS defence); uploads verified by magic bytes (SVG rejected), random file names, 5 MB cap.
- Parameterised SQL everywhere; CSV formula-injection guard on exports.
- **Append-only audit log** (DB triggers block UPDATE/DELETE): logins, failures, lockouts, every patient-record view/search/export, edits, invoice voids, permission denials.
- Signed clinical notes are immutable at the DB level; amendments keep the original.
- No account enumeration on password reset; reset tokens hashed, 30-min expiry, single use. Guest "manage" tokens hashed.
- Privacy notice and recorded consent (treatment and messaging) aligned with Nepal's Individual Privacy Act, 2075.

## Run locally
```bash
npm install
cp .env.example .env        # set NODE_ENV=development for local http
npm start                   # first run seeds content and prints the admin password
# http://localhost:3000   staff: http://localhost:3000/staff/login
npm test                    # 18 end-to-end tests
```
Without SMTP/WhatsApp configured, messages are logged as "skipped" and printed to the console (dry run).

## Production deployment (Ubuntu VPS, ~2 GB RAM is plenty)
```bash
sudo useradd -r -m -d /opt/physiostudio physiostudio
sudo mkdir -p /var/lib/physiostudio/{data,uploads} && sudo chown -R physiostudio /var/lib/physiostudio
# copy the project to /opt/physiostudio, then as the physiostudio user:
npm ci --omit=dev && cp .env.example .env && nano .env      # set secrets, BASE_URL, SMTP, WhatsApp
sudo cp deploy/physiostudio.service /etc/systemd/system/ && sudo systemctl enable --now physiostudio
sudo journalctl -u physiostudio | grep -A3 "INITIAL ADMIN"       # one-time admin password
sudo cp deploy/nginx.conf /etc/nginx/sites-available/physiostudio && sudo ln -s ../sites-available/physiostudio /etc/nginx/sites-enabled/
sudo certbot --nginx -d physiostudio.com.np -d www.physiostudio.com.np
sudo -u physiostudio env DATA_DIR=/var/lib/physiostudio/data UPLOAD_DIR=/var/lib/physiostudio/uploads ./scripts/import-legacy-assets.sh
```
Docker alternative: `docker compose up -d --build` (put Nginx/Caddy with TLS in front).

**Run the photo import before you point DNS at the new server.** The importer downloads the images from the current site; once the domain moves, the old host may not be reachable.

Backups: `scripts/backup.sh` (online SQLite snapshot + uploads, optional GPG encryption, 30-day retention). Schedule it nightly and copy it off-site. Also back up `.env`: without `APP_ENCRYPTION_KEY`, staff 2FA must be reset.

## Setting up reminders
**Email:** any SMTP provider. With Gmail/Workspace, turn on 2-Step Verification and create an App Password. For better deliverability use a domain address with SPF, DKIM and DMARC.

**WhatsApp (recommended: Meta WhatsApp Cloud API):**
1. Create a Meta Business account → developers.facebook.com → app → add *WhatsApp*.
2. Register the clinic's business number. It cannot be in use on the WhatsApp phone app at the same time, so a dedicated number is best.
3. Create **message templates** (category *Utility*) with 4 body variables, e.g. `appointment_reminder`: "Namaste {{1}}, this is a reminder of your appointment at Physio Studio on {{2}} at {{3}} with {{4}}. Reply or call 9767231155 to reschedule." Wait for approval.
4. Create a permanent System User token. Put `WHATSAPP_PROVIDER=meta`, the phone-number ID, the token and the template names in `.env`, then restart.
5. Admin → Settings → *Send a test message*.

Business-initiated WhatsApp messages must use approved templates, so the in-app editable texts apply to email and Twilio. For Meta, the wording lives in the approved template.

## After launch, please review
- **Testimonials** now carry the patients' original words and are published. Confirm each patient is still happy to be featured, and untick any who are not.
- **People in photos:** the exercise-session and senior-care photos show identifiable people. Keep written consent on file from everyone shown.
- **Logo:** the old site only has a 93×90 px logo. Ask your designer for an SVG or a 600 px PNG and upload it in Settings so it looks sharp on phones.
- **Prices** are placeholders (Rs. 1,500 per service). Set real prices and durations under Website → Services.
- Service descriptions, FAQ answers, About/Founder text and the blog post were re-written from the old site's content. Proof-read them, and add NHPC numbers and bios for each therapist.
- Care plans show "Ask us" until you enter prices; add your geriatric package tiers there.
- Add exercise videos and clinic photos; check each body-map area's text and linked service.
- Add your PAN/VAT number, Facebook/Instagram links and real logo colours in Settings.
- Create staff users (Admin → Staff users) and link each therapist to their profile.
