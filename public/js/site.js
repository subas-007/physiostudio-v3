/* Physio Studio – shared front-end behaviour (no inline scripts; CSP-friendly) */
(function () {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Mobile nav
  const toggle = $('[data-nav-toggle]');
  if (toggle) toggle.addEventListener('click', () => {
    const nav = $('#mainnav');
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // Announcement bar (dismiss for this browser session)
  const ann = $('[data-announce]');
  if (ann) {
    const key = 'ps-announce:' + ann.textContent.trim().slice(0, 60);
    try { if (sessionStorage.getItem(key)) ann.hidden = true; } catch (e) { /* storage unavailable */ }
    const close = $('[data-announce-close]', ann);
    if (close) close.addEventListener('click', () => { ann.hidden = true; try { sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ } });
  }

  // Body map: hotspots and chips select an area panel
  const finder = $('[data-finder]');
  if (finder) {
    const select = (id, focusPanel) => {
      $$('[data-area]', finder).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.area === id)));
      $$('[data-panel]', finder).forEach((p) => { p.hidden = p.dataset.panel !== id; });
      if (focusPanel && window.matchMedia('(max-width: 640px)').matches) {
        const p = $(`[data-panel="${id}"]`, finder);
        if (p) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    finder.addEventListener('click', (e) => { const b = e.target.closest('[data-area]'); if (b) select(b.dataset.area, true); });
    // One orchestrated moment: hotspots pulse twice when the body map first scrolls into view.
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { finder.classList.add('is-ready'); io.disconnect(); } }, { threshold: 0.4 });
      io.observe(finder);
    } else finder.classList.add('is-ready');
  }

  // Home slider: crossfade, autoplay with visible progress, pause control, keyboard and swipe.
  const slider = $('[data-slider]');
  if (slider) {
    const slides = $$('[data-slide]', slider), dots = $$('[data-slide-to]', slider), pauseBtn = $('[data-slide-pause]', slider);
    const MS = 6500;
    slider.style.setProperty('--slide-ms', MS + 'ms');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = 0, timer = null, userPaused = reduce, hoverPaused = false;
    const show = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => {
        const on = k === i;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-hidden', String(!on));
        $$('a, button', s).forEach((el) => { if (on) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', '-1'); });
      });
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
      restart();
    };
    const playing = () => !userPaused && !hoverPaused && !document.hidden && slides.length > 1;
    const restart = () => {
      clearTimeout(timer);
      slider.dataset.playing = 'false';
      if (!playing()) return;
      void slider.offsetWidth; // restart the progress animation
      slider.dataset.playing = 'true';
      timer = setTimeout(() => show(i + 1), MS);
    };
    const setPaused = (p) => {
      userPaused = p;
      if (pauseBtn) { pauseBtn.setAttribute('aria-label', p ? 'Play slideshow' : 'Pause slideshow'); pauseBtn.textContent = p ? '▶' : '❚❚'; }
      restart();
    };
    dots.forEach((d) => d.addEventListener('click', () => show(Number(d.dataset.slideTo))));
    const prev = $('[data-slide-prev]', slider), next = $('[data-slide-next]', slider);
    if (prev) prev.addEventListener('click', () => show(i - 1));
    if (next) next.addEventListener('click', () => show(i + 1));
    if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!userPaused));
    slider.addEventListener('mouseenter', () => { hoverPaused = true; restart(); });
    slider.addEventListener('mouseleave', () => { hoverPaused = false; restart(); });
    slider.addEventListener('focusin', () => { hoverPaused = true; restart(); });
    slider.addEventListener('focusout', (e) => { if (!slider.contains(e.relatedTarget)) { hoverPaused = false; restart(); } });
    slider.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
    document.addEventListener('visibilitychange', restart);
    let x0 = null;
    slider.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
    setPaused(userPaused);
  }

  // Patient stories carousel
  const track = $('[data-carousel]');
  if (track) {
    const step = () => { const card = track.firstElementChild; return card ? card.getBoundingClientRect().width + 24 : 320; };
    const prev = $('[data-carousel-prev]'), next = $('[data-carousel-next]');
    if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    if (next) next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
    const sync = () => {
      if (prev) prev.disabled = track.scrollLeft < 4;
      if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    };
    track.addEventListener('scroll', sync, { passive: true }); sync();
  }

  // Gallery lightbox (native <dialog>)
  const box = $('[data-lightbox]');
  if (box && typeof box.showModal === 'function') {
    const img = $('[data-lightbox-img]', box), cap = $('[data-lightbox-cap]', box);
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-lightbox-src]');
      if (!t) return;
      img.src = t.dataset.lightboxSrc; img.alt = t.dataset.lightboxCaption || ''; cap.textContent = t.dataset.lightboxCaption || '';
      box.showModal();
    });
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  }

  // Exercise videos: load YouTube (privacy-enhanced) only when pressed
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-video]');
    if (!b || !/^[\w-]{11}$/.test(b.dataset.video)) return;
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${b.dataset.video}?autoplay=1&rel=0`;
    f.title = b.dataset.title || 'Exercise video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    const wrap = document.createElement('div'); wrap.className = 'video-frame'; wrap.appendChild(f);
    b.replaceWith(wrap);
  });

  // FAQ search
  const q = $('[data-faq-search]');
  if (q) {
    const items = $$('[data-faq] details'), empty = $('[data-faq-empty]');
    q.addEventListener('input', () => {
      const term = q.value.trim().toLowerCase();
      let shown = 0;
      items.forEach((d) => { const hit = !term || d.textContent.toLowerCase().includes(term); d.hidden = !hit; if (hit) shown++; if (term && hit) d.open = true; if (!term) d.open = false; });
      if (empty) empty.hidden = shown > 0;
    });
  }

  // Confirmation prompts on destructive forms
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  }, true);

  // ---------- Booking slot picker ----------
  const fmt = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  $$('[data-booking]').forEach((form) => {
    const service = $('[data-service]', form), staff = $('[data-staff]', form), date = $('[data-date]', form);
    const time = $('[data-time]', form), box = $('[data-slots]', form), submit = $('[data-submit]', form);
    const override = $('[data-override]', form), overrideTime = $('[data-override-time]', form);
    const ignore = form.getAttribute('data-ignore');
    if (!service || !date || !box) return;
    let ctrl;

    async function load() {
      const sid = service.value, d = date.value;
      if (!sid || !d) { box.innerHTML = '<p class="muted">Choose a treatment and a date to see free times.</p>'; return; }
      box.innerHTML = '<p class="muted">Loading available times…</p>';
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      const q = new URLSearchParams({ date: d, service_id: sid, staff_id: staff ? staff.value : '' });
      if (ignore) q.set('ignore', ignore);
      try {
        const r = await fetch('/api/slots?' + q, { signal: ctrl.signal, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        const data = await r.json();
        render(data);
      } catch (err) { if (err.name !== 'AbortError') box.innerHTML = '<p class="muted">Could not load times. Please call us to book.</p>'; }
    }

    function render(data) {
      box.innerHTML = '';
      if (data.closed) { box.innerHTML = '<p class="muted">The clinic is closed on this day. Please choose another date.</p>'; time.value = ''; return; }
      if (!data.slots.length) { box.innerHTML = '<p class="muted">No free times on this day. Try another date or therapist.</p>'; time.value = ''; return; }
      const groups = [['Morning', (h) => h < 12], ['Afternoon', (h) => h >= 12 && h < 16], ['Evening', (h) => h >= 16]];
      let found = false;
      groups.forEach(([label, test]) => {
        const items = data.slots.filter((s) => test(Number(s.time.slice(0, 2))));
        if (!items.length) return;
        const g = document.createElement('div'); g.className = 'slot-group'; g.textContent = label; box.appendChild(g);
        items.forEach((s) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'slot'; b.textContent = fmt(s.time); b.dataset.time = s.time;
          b.setAttribute('aria-pressed', String(s.time === time.value));
          if (s.time === time.value) found = true;
          b.addEventListener('click', () => {
            $$('.slot', box).forEach((x) => x.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            time.value = s.time;
            if (override) override.checked = false;
          });
          box.appendChild(b);
        });
      });
      if (!found && !(override && override.checked)) time.value = '';
    }

    [service, staff, date].forEach((el) => el && el.addEventListener('change', load));
    if (overrideTime) overrideTime.addEventListener('change', () => { if (override) override.checked = true; time.value = overrideTime.value; $$('.slot', box).forEach((x) => x.setAttribute('aria-pressed', 'false')); });
    if (override) override.addEventListener('change', () => { if (override.checked && overrideTime && overrideTime.value) time.value = overrideTime.value; });

    form.addEventListener('submit', (e) => {
      if (override && override.checked && overrideTime && overrideTime.value) time.value = overrideTime.value;
      if (!time.value) {
        e.preventDefault();
        box.insertAdjacentHTML('afterbegin', '<p class="alert alert-error">Please pick a time.</p>');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (submit) { submit.disabled = true; submit.textContent = 'Please wait…'; }
    });
    load();
  });
})();
