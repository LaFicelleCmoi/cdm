/* ===================================================================
   COMPETITION — bascule globale CDM 2026 ⇄ Ligue des Nations 2026-27.
   Résolution du mode (le premier qui répond gagne) :
     1. ?comp=wc|ldn dans l'URL   (pratique pour OBS : stockage séparé)
     2. localStorage 'competitionMode' (choix du toggle, partagé entre pages)
     3. auto par date : LdN après la finale CDM (20/07/2026)
   Expose window.COMP = { mode:'wc'|'ldn', slug, auto, set(mode) }.
   Si la page pose une ancre <div id="comp-toggle">, injecte le toggle
   pilule 🏆/🇪🇺 (même famille visuelle que le sélecteur FR/EN).
   À charger AVANT i18n.js (libellés traduits au premier apply)
   et AVANT les scripts de page (qui lisent COMP.slug).
   =================================================================== */
(function () {
  'use strict';
  var KEY = 'competitionMode';
  var WC_LIVE_END = Date.UTC(2026, 6, 20); // après la finale CDM → auto LdN

  var qp = null;
  try { qp = new URLSearchParams(location.search).get('comp'); } catch (e) {}
  if (qp !== 'wc' && qp !== 'ldn') qp = null;
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  if (stored !== 'wc' && stored !== 'ldn') stored = null;

  var auto = Date.now() >= WC_LIVE_END ? 'ldn' : 'wc';
  var mode = qp || stored || auto;

  function set(m) {
    if ((m !== 'wc' && m !== 'ldn') || m === mode) return;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    // retire un éventuel ?comp= (il primerait sur le nouveau choix) puis recharge
    var href = location.href;
    try { var u = new URL(location.href); u.searchParams.delete('comp'); href = u.href; } catch (e) {}
    if (href === location.href) location.reload();
    else location.href = href;
  }

  window.COMP = {
    mode: mode,
    slug: mode === 'ldn' ? 'uefa.nations' : 'fifa.world',
    auto: auto,
    set: set
  };

  /* ---- UI (uniquement si la page pose l'ancre #comp-toggle) ---- */
  function injectStyle() {
    if (document.getElementById('comp-toggle-style')) return;
    var s = document.createElement('style');
    s.id = 'comp-toggle-style';
    s.textContent = [
      '.comp-toggle { position: fixed; top: 18px; left: 138px; z-index: 60; display: inline-flex; align-items: stretch; padding: 4px;',
      '  background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.12); border-radius: 30px;',
      '  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }',
      '.comp-toggle .comp-opt { position: relative; z-index: 1; flex: 1 1 0; border: none; background: transparent;',
      '  color: var(--muted, #8a9bb0); font-family: inherit; font-weight: 800; font-size: 0.72em; letter-spacing: 0.05em; text-transform: uppercase;',
      '  padding: 6px 13px; border-radius: 24px; cursor: pointer; transition: color 0.3s; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }',
      '.comp-toggle .comp-opt .co-ico { font-size: 1.05em; }',
      '.comp-toggle .comp-opt.active { color: #000; }',
      '.comp-toggle .comp-slider { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px);',
      '  background: var(--gold, #fbc531); border-radius: 24px; z-index: 0; box-shadow: 0 0 16px rgba(251,197,49,0.4);',
      '  transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }',
      '.comp-toggle[data-comp="ldn"] .comp-slider { transform: translateX(100%); }',
      '@media (max-width: 600px) { .comp-toggle { top: 58px; left: 14px; } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildToggle() {
    var tg = document.getElementById('comp-toggle');
    if (!tg) return;
    injectStyle();
    tg.classList.add('comp-toggle');
    tg.dataset.comp = mode;
    tg.setAttribute('role', 'group');
    tg.setAttribute('aria-label', 'Compétition');
    tg.innerHTML = '<span class="comp-slider"></span>' +
      '<button class="comp-opt' + (mode === 'wc' ? ' active' : '') + '" data-comp="wc" type="button" title="Coupe du Monde 2026" data-i18n-title="comp_tg_wc_tip"><span class="co-ico">🏆</span><span data-i18n="comp_tg_wc">CDM</span></button>' +
      '<button class="comp-opt' + (mode === 'ldn' ? ' active' : '') + '" data-comp="ldn" type="button" title="Ligue des Nations 2026-27" data-i18n-title="comp_tg_ldn_tip"><span class="co-ico">🇪🇺</span><span data-i18n="comp_tg_ldn">Nations</span></button>';
    tg.addEventListener('click', function (e) {
      var b = e.target.closest('.comp-opt');
      if (b) set(b.dataset.comp);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildToggle);
  else buildToggle();
})();
