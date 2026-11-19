/* Physio Studio – admin UI behaviour */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const tgl = $('[data-sidebar-toggle]');
  if (tgl) tgl.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => el.form.submit()));
  $$('[data-select-all]').forEach((el) => el.addEventListener('focus', () => el.select()));

  // ---------- Patient picker with autocomplete ----------
  $$('[data-patient-picker]').forEach((root) => {
    const input = $('[data-patient-search]', root), list = $('[data-ac]', root), id = $('[data-patient-id]', root);
    const picked = $('[data-picked]', root), label = $('[data-picked-label]', root), wrap = $('[data-search-wrap]', root), clear = $('[data-clear]', root);
    let timer, items = [], idx = -1;
    function choose(p) {
      id.value = p.id; label.textContent = `${p.full_name} · ${p.patient_code} · ${p.phone}`;
      picked.hidden = false; wrap.hidden = true; list.hidden = true;
    }
    if (clear) clear.addEventListener('click', () => { id.value = ''; picked.hidden = true; wrap.hidden = false; if (input) input.focus(); });
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      timer = setTimeout(async () => {
        const r = await fetch('/admin/patients/search.json?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
        items = await r.json(); idx = -1;
        list.innerHTML = items.length ? items.map((p, i) => `<li role="option" data-i="${i}"><strong>${esc(p.full_name)}</strong> <small>${esc(p.patient_code)} · ${esc(p.phone)}</small></li>`).join('') : '<li class="muted">No match – fill in the new patient fields below.</li>';
        list.hidden = false;
      }, 200);
    });
    list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(items[Number(li.dataset.i)]); });
    input.addEventListener('keydown', (e) => {
      const lis = $$('li[data-i]', list);
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, lis.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); choose(items[idx]); return; }
      lis.forEach((li, i) => li.setAttribute('aria-selected', String(i === idx)));
    });
  });

  // ---------- Invoice line items ----------
  const inv = $('[data-invoice]');
  if (inv) {
    const tbody = $('[data-items]', inv);
    const money = (n) => (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function recalc() {
      let sub = 0;
      $$('[data-item]', tbody).forEach((row) => {
        const q = parseFloat($('[data-item-qty]', row).value) || 0, p = parseFloat($('[data-item-price]', row).value) || 0;
        $('[data-item-total]', row).textContent = money(q * p); sub += q * p;
      });
      const disc = Math.min(sub, parseFloat($('[data-discount]', inv).value) || 0);
      const taxEl = $('[data-tax]', inv); const rate = parseFloat(taxEl.dataset.rate) || 0;
      const tax = (sub - disc) * rate / 100;
      $('[data-subtotal]', inv).textContent = money(sub); taxEl.textContent = money(tax);
      $('[data-total]', inv).textContent = money(sub - disc + tax);
      inv.dataset.total = (sub - disc + tax).toFixed(2);
    }
    function wire(row) {
      const sel = $('[data-item-service]', row);
      sel.addEventListener('change', () => {
        const o = sel.selectedOptions[0];
        if (o && o.dataset.price) { $('[data-item-price]', row).value = o.dataset.price; $('[data-item-desc]', row).value = o.dataset.title; }
        recalc();
      });
      $('[data-remove-item]', row).addEventListener('click', () => { if ($$('[data-item]', tbody).length > 1) { row.remove(); recalc(); } });
    }
    $$('[data-item]', tbody).forEach(wire);
    $('[data-add-item]', inv).addEventListener('click', () => {
      const tpl = $('[data-item]', tbody).cloneNode(true);
      $$('input', tpl).forEach((i) => { i.value = i.hasAttribute('data-item-qty') ? '1' : ''; });
      $('select', tpl).value = '';
      tbody.appendChild(tpl); wire(tpl); recalc();
    });
    inv.addEventListener('input', recalc);
    const full = $('[data-pay-full]', inv);
    if (full) full.addEventListener('click', () => { recalc(); $('[data-pay-amount]', inv).value = inv.dataset.total; });
    recalc();
  }
})();
