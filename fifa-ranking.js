/* ===================================================================
   CLASSEMENT FIFA EN DIRECT — module PARTAGÉ (CDM.html + dashboard.html).
   Recalcul via la formule officielle SUM ; base = classement officiel FIFA
   du 11 juin 2026 (dernier avant la CDM). Seules les équipes qui jouent la
   CDM bougent (résultats ESPN) ; les autres restent figées → vrai rang
   mondial « top élargi ».

   API :
     FifaRanking.mount(el, { mode: 'full' | 'widget', collapsed: 10 })
       - 'full'   : onglet CDM (titre + recherche centrée + tableau complet)
       - 'widget' : dashboard (toolbar compacte, top N + « Voir tout »,
                    mise en avant de la sélection favorite)
     window.updateFifaRanking(events)  — alimente/rafraîchit (fusion par id)
     FifaRanking.rerender()            — re-render (ex. changement de favori)

   Le CSS est injecté par le module (aucune dépendance de page) ; il repose
   sur les variables du site avec repli : --font-d/--font-b/--gold/--muted.
   Perf : tout est statique/événementiel — aucune boucle, aucun backdrop-blur.
   =================================================================== */
(function () {
  'use strict';

  /* ---------------- Données de base (11 juin 2026) ---------------- */
  // [nom FR, code ISO drapeau, points au 11 juin 2026]
  const FIFA_BASE = [
    ['Argentine','ar',1877.27],['Espagne','es',1874.71],['France','fr',1870.70],
    ['Angleterre','gb-eng',1828.02],['Portugal','pt',1767.85],['Brésil','br',1765.86],
    ['Maroc','ma',1755.10],['Pays-Bas','nl',1753.57],['Belgique','be',1742.24],
    ['Allemagne','de',1735.77],['Croatie','hr',1714.87],['Italie','it',1704.73],
    ['Colombie','co',1698.35],['Mexique','mx',1687.48],['Sénégal','sn',1684.07],
    ['Uruguay','uy',1673.07],['États-Unis','us',1671.23],['Japon','jp',1661.58],
    ['Suisse','ch',1650.06],['Iran','ir',1619.58],['Danemark','dk',1619.47],
    ['Turquie','tr',1605.73],['Équateur','ec',1598.52],['Autriche','at',1597.40],
    ['Corée du Sud','kr',1591.63],['Nigéria','ng',1585.02],['Australie','au',1579.34],
    ['Algérie','dz',1571.03],['Égypte','eg',1562.37],['Canada','ca',1559.48],
    ['Norvège','no',1557.44],['Ukraine','ua',1549.29],["Côte d'Ivoire",'ci',1540.87],
    ['Panama','pa',1539.16],['Russie','ru',1529.60],['Pologne','pl',1526.18],
    ['Pays de Galles','gb-wls',1516.95],['Suède','se',1509.79],['Hongrie','hu',1506.39],
    ['Tchéquie','cz',1505.74],['Paraguay','py',1505.35],['Écosse','gb-sct',1503.34],
    ['Serbie','rs',1502.13],['Cameroun','cm',1481.24],['Tunisie','tn',1476.41],
    ['RD Congo','cd',1474.43],['Slovaquie','sk',1473.66],['Grèce','gr',1473.19],
    ['Venezuela','ve',1469.18],['Ouzbékistan','uz',1458.73]
  ];
  // ISO complémentaires : adversaires CDM hors top-50 (pour leur mini-drapeau)
  const ISO_EXTRA = { 'Irak':'iq','Ghana':'gh','Cap-Vert':'cv','Nouvelle-Zélande':'nz','Curaçao':'cw','Haïti':'ht','Arabie Saoudite':'sa','Jordanie':'jo','Qatar':'qa','Afrique du Sud':'za','Bosnie-Herzégovine':'ba' };

  const PTS0 = {}, RANK0 = {}, ISO = Object.assign({}, ISO_EXTRA);
  FIFA_BASE.forEach(function (t, i) { PTS0[t[0]] = t[2]; RANK0[t[0]] = i + 1; ISO[t[0]] = t[1]; });
  const UNK = 1440;                                   // note d'un adversaire hors base (We)
  const KO60 = { quarterfinals:1, semifinals:1, '3rd-place-match':1, final:1 }; // I=60 dès les quarts
  const We = (a, b) => 1 / (Math.pow(10, -(a - b) / 600) + 1);
  const frOf = (dn) => (window.TEAM_FR && window.TEAM_FR[dn]) || dn;
  const flag = (iso, w) => iso ? 'https://flagcdn.com/w' + w + '/' + iso + '.png' : '';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // couleur du résultat d'un point de trajectoire : victoire verte / défaite rouge /
  // nul gris (t.a.b. inclus : gagnant vert, perdant rouge) ; point de base neutre
  const resColorOf = (p) => (!p || !p.date) ? '#cfd8e0'
    : (p.soF != null && p.soAg != null) ? (p.soF > p.soAg ? '#3ee07a' : '#ff5252')
    : p.gf > p.ga ? '#3ee07a' : p.gf < p.ga ? '#ff5252' : '#9aa7b4';
  // recherche sans accents (é→e, ç→c…) : NFD puis on retire les diacritiques combinants (U+0300–U+036F)
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').split('').filter(c => { const x = c.charCodeAt(0); return x < 0x300 || x > 0x36f; }).join('').toLowerCase();
  const favName = () => { try { return localStorage.getItem('cdm2026_fav') || ''; } catch (e) { return ''; } };

  /* ---------------- État ---------------- */
  let _host = null;                    // conteneur monté
  let _opts = { mode: 'full', collapsed: 10 };
  let _all = {};                       // id -> event ESPN (fusion des rafraîchissements)
  let _lastTraj = {};                  // trajectoire des points par équipe
  let _lastList = [];                  // dernier classement calculé (pour FifaRanking.get)
  let _query = '';                     // recherche courante (persiste entre re-render)
  let _expanded = false;               // widget : top N ↔ classement complet

  window.updateFifaRanking = function (events) {
    (events || []).forEach(e => { if (e && e.id) _all[e.id] = e; });
    render();
  };

  /* ---------------- Calcul (formule SUM, chronologique) ---------------- */
  function computed() {
    const pts = Object.assign({}, PTS0);
    const traj = {};
    Object.keys(PTS0).forEach(fr => { traj[fr] = [{ date: null, pts: PTS0[fr], rank: RANK0[fr] }]; }); // départ = base 11 juin
    const done = Object.values(_all).filter(e => {
      const c = e.competitions && e.competitions[0];
      return c && c.status && c.status.type && c.status.type.state === 'post';
    }).sort((a, b) => new Date(a.date) - new Date(b.date));   // chronologique (We = points du moment)
    for (const e of done) {
      const c = e.competitions[0], cs = c.competitors || []; if (cs.length < 2) continue;
      const I = KO60[(e.season && e.season.slug)] ? 60 : 50;
      const A = cs[0], B = cs[1];
      const frA = frOf(A.team.displayName), frB = frOf(B.team.displayName);
      const sA = parseInt(A.score), sB = parseInt(B.score); if (isNaN(sA) || isNaN(sB)) continue;
      const pA = (frA in pts) ? pts[frA] : UNK, pB = (frB in pts) ? pts[frB] : UNK;
      const soA = A.shootoutScore != null ? parseInt(A.shootoutScore) : null;
      const soB = B.shootoutScore != null ? parseInt(B.shootoutScore) : null;
      let wA, wB;
      if (soA != null && soB != null) { if (soA > soB) { wA = 0.75; wB = 0.5; } else { wA = 0.5; wB = 0.75; } }
      else if (sA > sB) { wA = 1; wB = 0; } else if (sA < sB) { wA = 0; wB = 1; } else { wA = 0.5; wB = 0.5; }
      const _slug = (e.season && e.season.slug);
      if (frA in pts) pts[frA] = pA + I * (wA - We(pA, pB));
      if (frB in pts) pts[frB] = pB + I * (wB - We(pB, pA));
      // rang mondial à cet instant (après le match) : 1 + nb d'équipes devant
      const rankOf = (fr) => { const v = pts[fr]; let r = 1; for (const k in pts) { if (pts[k] > v) r++; } return r; };
      if (frA in pts) traj[frA].push({ date: e.date, pts: pts[frA], rank: rankOf(frA), opp: frB, gf: sA, ga: sB, soF: soA, soAg: soB, slug: _slug });
      if (frB in pts) traj[frB].push({ date: e.date, pts: pts[frB], rank: rankOf(frB), opp: frA, gf: sB, ga: sA, soF: soB, soAg: soA, slug: _slug });
    }
    const list = Object.keys(PTS0).map(fr => ({ fr, iso: ISO[fr], pts: pts[fr], rank0: RANK0[fr] }))
      .sort((a, b) => b.pts - a.pts);
    list.forEach((t, i) => { t.rank = i + 1; t.move = t.rank0 - t.rank; });   // move>0 = monte
    _lastTraj = traj;
    _lastList = list;
    return list;
  }

  function matchIndex() {          // dernier match joué / prochain match, par équipe
    const last = {}, next = {};
    Object.values(_all).forEach(e => {
      const c = e.competitions && e.competitions[0]; if (!c) return;
      const st = c.status && c.status.type && c.status.type.state; const cs = c.competitors || [];
      if (cs.length < 2) return;
      const info = (me, opp) => ({
        oppFr: frOf(opp.team.displayName), oppAbbr: (opp.team.abbreviation || '').toUpperCase(),
        gf: parseInt(me.score), ga: parseInt(opp.score),
        soF: me.shootoutScore != null ? parseInt(me.shootoutScore) : null,
        soA: opp.shootoutScore != null ? parseInt(opp.shootoutScore) : null, date: e.date
      });
      [[cs[0], cs[1]], [cs[1], cs[0]]].forEach(([me, opp]) => {
        const fr = frOf(me.team.displayName);
        if (st === 'post') { if (!last[fr] || new Date(e.date) > new Date(last[fr].date)) last[fr] = info(me, opp); }
        else if (st === 'pre') { if (!next[fr] || new Date(e.date) < new Date(next[fr].date)) next[fr] = info(me, opp); }
      });
    });
    return { last, next };
  }

  function matchCell(fr, idx) {
    const L = idx.last[fr], N = idx.next[fr];
    if (L && !isNaN(L.gf)) {
      const hasSO = L.soF != null && L.soA != null;
      const won = hasSO ? L.soF > L.soA : L.gf > L.ga;
      const lost = hasSO ? L.soF < L.soA : L.gf < L.ga;
      const cls = won ? 'w' : lost ? 'l' : 'd', mark = won ? '✓' : lost ? '✗' : '•';
      const so = hasSO ? ' <span class="fr-opp">(' + L.soF + '-' + L.soA + ' ' + (window.t ? window.t('shootout_abbr') : 'tab') + ')</span>' : '';
      const of = ISO[L.oppFr] ? '<img class="fr-opp-flag" src="' + flag(ISO[L.oppFr], 40) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '';
      return '<span class="fr-res ' + cls + '">' + mark + '</span><span class="fr-score">' + L.gf + '–' + L.ga + '</span>' + so + ' <span class="fr-opp">v</span> ' + of + '<span class="fr-opp">' + esc(L.oppAbbr) + '</span>';
    }
    if (N) {
      const when = (typeof dayjs !== 'undefined') ? dayjs(N.date).tz('Europe/Paris').format('D MMM · HH:mm')
                                                  : new Date(N.date).toLocaleString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const of = ISO[N.oppFr] ? '<img class="fr-opp-flag" src="' + flag(ISO[N.oppFr], 40) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '';
      return '<span class="fr-next">' + esc(when) + '</span> <span class="fr-opp">v</span> ' + of + '<span class="fr-opp">' + esc(N.oppAbbr) + '</span>';
    }
    return '<span class="fr-opp">—</span>';
  }

  /* ---------------- Coquille (construite une seule fois) ---------------- */
  // La recherche/les boutons survivent aux re-render : seules les lignes
  // #fr-body sont reconstruites à chaque rafraîchissement.
  function ensureShell() {
    if (!_host) return null;
    if (_host.querySelector('#fr-body')) return _host;
    const t = (k) => (window.t ? window.t(k) : k);
    const widget = _opts.mode === 'widget';
    _host.classList.add('fr-wrap');
    if (widget) _host.classList.add('fr-widget');
    const searchHtml = '<div class="fr-filter-wrap"><span class="fr-filter-icon">🔍</span>'
      + '<input type="text" class="fr-filter-input" id="fr-search" autocomplete="off" placeholder="' + t('ranking_search') + '"></div>';
    const pillHtml = '<span class="fr-live-pill" id="fr-live-pill" style="display:none"><span class="dot"></span>' + t('ranking_live') + '</span>';
    _host.innerHTML =
      (widget
        ? '<div class="fr-toolbar">' + searchHtml + pillHtml + '</div>'
        : '<div class="fr-head-block"><div class="fr-title">' + t('ranking_title') + pillHtml
          + '</div><div class="fr-sub">' + t('ranking_sub') + '</div></div>'
          + '<div class="fr-search-wrap">' + searchHtml + '</div>')
      + '<div class="fr-table"><div class="fr-colhead"><span>' + t('col_rank') + '</span><span>' + t('col_team')
      + '</span><span class="c-match">' + t('col_matches') + '</span><span class="c-pts">' + t('col_points') + '</span></div>'
      + '<div id="fr-body"></div></div>'
      + '<div class="fr-empty" id="fr-empty" style="display:none">' + t('ranking_none') + '</div>'
      + (widget ? '<button class="fr-expand-btn" id="fr-expand" type="button"></button>' : '')
      + '<div class="fr-note">' + t('ranking_note') + '</div>';
    const input = _host.querySelector('#fr-search');
    input.value = _query;
    // widget : le sous-ensemble affiché dépend de la recherche → re-render ;
    // full : toutes les lignes sont déjà là → simple filtre d'affichage
    input.addEventListener('input', () => { _query = input.value; if (_opts.mode === 'widget') render(); else applyFilter(); });
    const xbtn = _host.querySelector('#fr-expand');
    if (xbtn) xbtn.addEventListener('click', () => { _expanded = !_expanded; render(); });
    // clic sur une ligne → 5 derniers matchs de l'équipe (délégation : #fr-body persiste)
    const body = _host.querySelector('#fr-body');
    if (body) body.addEventListener('click', (e) => {
      const row = e.target.closest('.fr-row'); if (row) openTeamModal(row.getAttribute('data-name'), row);
    });
    return _host;
  }

  function applyFilter() {
    const body = document.getElementById('fr-body'); if (!body) return;
    const q = norm(_query.trim());
    let shown = 0;
    body.querySelectorAll('.fr-row').forEach(row => {
      const ok = !q || norm(row.getAttribute('data-name')).indexOf(q) !== -1;
      row.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    const empty = document.getElementById('fr-empty');
    if (empty) empty.style.display = (q && shown === 0) ? '' : 'none';
  }

  function rowHtml(r, idx, fav) {
    const out = !idx.last[r.fr] && !idx.next[r.fr];
    const isFav = fav && r.fr === fav;
    const mv = r.move > 0 ? '<span class="fr-move up">▲ ' + r.move + '</span>'
             : r.move < 0 ? '<span class="fr-move down">▼ ' + (-r.move) + '</span>'
             : '<span class="fr-move same">–</span>';
    return '<div class="fr-row' + (out ? ' is-out' : '') + (isFav ? ' is-fav' : '') + '" data-name="' + esc(r.fr) + '">'
      + '<div class="fr-rank"><span class="fr-pos">' + r.rank + '</span>' + mv + '</div>'
      + '<div class="fr-team"><img class="fr-flag" src="' + flag(r.iso, 80) + '" srcset="' + flag(r.iso, 160) + ' 2x" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
      + (isFav ? '<span class="fr-fav-star">★</span>' : '')
      + '<span class="fr-name">' + esc(r.fr) + '</span></div>'
      + '<div class="fr-match">' + matchCell(r.fr, idx) + '</div>'
      + '<div class="fr-pts">' + r.pts.toFixed(2) + '</div>'
      + '</div>';
  }

  function render() {
    const wrap = ensureShell(); if (!wrap) return;
    const list = computed(), idx = matchIndex();
    const anyLive = Object.values(_all).some(e => { const c = e.competitions && e.competitions[0]; return c && c.status && c.status.type && c.status.type.state === 'in'; });
    const pill = document.getElementById('fr-live-pill'); if (pill) pill.style.display = anyLive ? '' : 'none';
    const t = (k) => (window.t ? window.t(k) : k);
    const fav = favName();
    const hasQuery = !!norm(_query.trim());
    // widget replié : top N + (⋯ + ligne du favori s'il est plus bas)
    const collapsed = _opts.mode === 'widget' && !_expanded && !hasQuery;
    let html;
    if (collapsed) {
      const n = _opts.collapsed || 10;
      html = list.slice(0, n).map(r => rowHtml(r, idx, fav)).join('');
      const fi = list.findIndex(r => r.fr === fav);
      if (fi >= n) html += '<div class="fr-sep" aria-hidden="true">⋯</div>' + rowHtml(list[fi], idx, fav);
    } else {
      html = list.map(r => rowHtml(r, idx, fav)).join('');
    }
    document.getElementById('fr-body').innerHTML = html;
    const xbtn = document.getElementById('fr-expand');
    if (xbtn) {
      xbtn.style.display = hasQuery ? 'none' : '';
      xbtn.textContent = _expanded ? ('▲ ' + t('ranking_reduce')) : ('▼ ' + t('ranking_seeall'));
    }
    applyFilter();
  }

  /* ---------------- Modale : 5 derniers matchs + graphique ---------------- */
  const STAGE = { 'group-stage':'phase_groups','round-of-32':'phase_r32','round-of-16':'phase_r16','quarterfinals':'phase_qf','semifinals':'phase_sf','3rd-place-match':'phase_3p','final':'phase_final' };
  function teamMatches(fr, n) {
    const out = [];
    Object.values(_all).forEach(e => {
      const c = e.competitions && e.competitions[0]; if (!c) return;
      const st = c.status && c.status.type && c.status.type.state; if (st !== 'post' && st !== 'in') return;
      const cs = c.competitors || []; if (cs.length < 2) return;
      let me = null, opp = null;
      if (frOf(cs[0].team.displayName) === fr) { me = cs[0]; opp = cs[1]; }
      else if (frOf(cs[1].team.displayName) === fr) { me = cs[1]; opp = cs[0]; }
      if (!me) return;
      const oppFr = frOf(opp.team.displayName);
      out.push({ date: e.date, slug: (e.season && e.season.slug) || 'group-stage', live: st === 'in',
        oppFr, oppAbbr: (opp.team.abbreviation || '').toUpperCase(), oppIso: ISO[oppFr],
        gf: parseInt(me.score), ga: parseInt(opp.score),
        soF: me.shootoutScore != null ? parseInt(me.shootoutScore) : null,
        soA: opp.shootoutScore != null ? parseInt(opp.shootoutScore) : null });
    });
    out.sort((a, b) => new Date(b.date) - new Date(a.date));   // plus récent d'abord
    return out.slice(0, n || 5);
  }
  function ensureModal() {
    let bd = document.getElementById('fr-modal-bd'); if (bd) return bd;
    bd = document.createElement('div'); bd.className = 'fr-modal-backdrop'; bd.id = 'fr-modal-bd';
    bd.innerHTML = '<div class="fr-modal" role="dialog" aria-modal="true"><button class="fr-modal-close" aria-label="Fermer">✕</button><div class="fr-modal-body"></div></div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => { if (e.target === bd || e.target.classList.contains('fr-modal-close')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    return bd;
  }
  function closeModal() { const bd = document.getElementById('fr-modal-bd'); if (bd) bd.classList.remove('open'); }
  // mini-graphique SVG de l'évolution des points (base 11 juin → chaque match)
  function sparkline(fr) {
    const tr = _lastTraj[fr];
    if (!tr || tr.length < 2) return '';               // aucune évolution (équipe hors CDM)
    const t = (k) => (window.t ? window.t(k) : k);
    const W = 340, H = 62, pad = 7;
    const vals = tr.map(p => p.pts);
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), range = (max - min) || 1;
    const n = tr.length, base = tr[0].pts, cur = vals[n - 1], gained = cur >= base;
    const col = gained ? '#3ee07a' : '#ff5252';
    const X = i => pad + (i / (n - 1)) * (W - 2 * pad);
    const Y = v => pad + (1 - (v - min) / range) * (H - 2 * pad);
    const line = tr.map((p, i) => X(i).toFixed(1) + ',' + Y(p.pts).toFixed(1)).join(' ');
    const area = line + ' ' + X(n - 1).toFixed(1) + ',' + (H - pad) + ' ' + pad + ',' + (H - pad);
    const baseY = Y(base).toFixed(1);
    // chaque point coloré selon le RÉSULTAT du match (vert/rouge/gris) → forme lisible d'un coup d'œil
    const dots = tr.map((p, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.pts).toFixed(1) + '" r="2.4" fill="' + resColorOf(p) + '"/>').join('');
    const delta = cur - base, deltaTxt = (delta >= 0 ? '+' : '') + delta.toFixed(2);
    return '<div class="fr-spark-wrap">'
      + '<div class="fr-spark-top"><span class="fr-spark-label">' + t('ranking_evolution') + '</span>'
      + '<span class="fr-spark-delta" style="color:' + col + '">' + (gained ? '▲' : '▼') + ' ' + deltaTxt + ' pts</span></div>'
      + '<svg class="fr-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + '<rect class="fr-spark-hit" x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/>'
      + '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + baseY + '" y2="' + baseY + '" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="4 4"/>'
      + '<polygon points="' + area + '" fill="' + col + '" fill-opacity="0.13"/>'
      + '<polyline points="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
      + dots
      + '<g class="fr-spark-cursor" style="display:none">'
      + '<line class="fr-spark-cline" y1="' + pad + '" y2="' + (H - pad) + '" stroke="rgba(255,255,255,0.55)" stroke-width="1" stroke-dasharray="3 3"/>'
      + '<circle class="fr-spark-cdot" r="3.4" fill="#fff" stroke="' + col + '" stroke-width="2"/></g>'
      + '</svg>'
      + '<div class="fr-spark-tip" style="display:none"></div>'
      + '<div class="fr-spark-axis"><span>' + base.toFixed(0) + '</span><span>' + cur.toFixed(0) + '</span></div></div>';
  }
  // survol du graphique → accroche le point le plus proche + bulle (tour · adv · pts)
  function wireSparkline(fr) {
    const svg = document.querySelector('#fr-modal-bd .fr-spark'); if (!svg) return;
    const tr = _lastTraj[fr]; if (!tr || tr.length < 2) return;
    const wrap = svg.closest('.fr-spark-wrap');
    const tip = wrap.querySelector('.fr-spark-tip');
    const cursor = svg.querySelector('.fr-spark-cursor');
    const cLine = svg.querySelector('.fr-spark-cline'), cDot = svg.querySelector('.fr-spark-cdot');
    const t = (k) => (window.t ? window.t(k) : k);
    const W = 340, H = 62, pad = 7, n = tr.length;
    const Xv = i => pad + (i / (n - 1)) * (W - 2 * pad);
    const vals = tr.map(p => p.pts), min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), range = (max - min) || 1;
    const Yv = v => pad + (1 - (v - min) / range) * (H - 2 * pad);
    function show(clientX) {
      const r = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      let i = Math.round((((clientX - r.left) / r.width * W - pad) / (W - 2 * pad)) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const p = tr[i], prev = i > 0 ? tr[i - 1] : null, vx = Xv(i), vy = Yv(p.pts);
      cLine.setAttribute('x1', vx); cLine.setAttribute('x2', vx);
      cDot.setAttribute('cx', vx); cDot.setAttribute('cy', vy);
      const rc = resColorOf(p);                 // couleur du RÉSULTAT (victoire/nul/défaite)
      cDot.setAttribute('stroke', rc);
      tip.style.borderLeftColor = rc;
      cursor.style.display = '';
      const rankTxt = p.rank ? ((prev && prev.rank && prev.rank !== p.rank) ? ('#' + prev.rank + ' → #' + p.rank) : ('#' + p.rank)) : '';
      if (i === 0 || !p.date) {
        tip.innerHTML = '<b>' + t('ranking_base') + '</b>'
          + '<div class="fr-tip-row"><span class="fr-tip-pts">' + p.pts.toFixed(2) + ' pts</span>'
          + (rankTxt ? '<span class="fr-tip-rank">' + rankTxt + '</span>' : '') + '</div>';
      } else {
        const stage = (p.slug && STAGE[p.slug]) ? t(STAGE[p.slug]) + ' · ' : '';
        const sc = (p.soF != null && p.soAg != null) ? (p.gf + '–' + p.ga + ' <i>(' + p.soF + '-' + p.soAg + ')</i>') : (p.gf + '–' + p.ga);
        const won = (p.soF != null && p.soAg != null) ? p.soF > p.soAg : p.gf > p.ga;
        const lost = (p.soF != null && p.soAg != null) ? p.soF < p.soAg : p.gf < p.ga;
        const mark = won ? '✓' : lost ? '✗' : '•';
        const of = ISO[p.opp] ? '<img src="' + flag(ISO[p.opp], 40) + '" alt="">' : '';
        const d = prev ? p.pts - prev.pts : 0;
        const dt = (typeof dayjs !== 'undefined') ? dayjs(p.date).format('D MMM YYYY') : new Date(p.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' });
        tip.innerHTML = '<b><span style="color:' + rc + '">' + mark + '</span> ' + of + stage + 'vs ' + esc(p.opp) + ' ' + sc + '</b>'
          + '<div class="fr-tip-date">' + esc(dt) + '</div>'
          + '<div class="fr-tip-row"><span class="fr-tip-pts">' + p.pts.toFixed(2) + ' pts</span>'
          + '<span class="fr-tip-delta" style="color:' + (d >= 0 ? '#3ee07a' : '#ff5252') + '">' + (d >= 0 ? '+' : '') + d.toFixed(2) + '</span>'
          + (rankTxt ? '<span class="fr-tip-rank">' + rankTxt + '</span>' : '') + '</div>';
      }
      tip.style.display = 'block';
      const sx = (r.left - wr.left) + (vx / W) * r.width, sy = (r.top - wr.top) + (vy / H) * r.height;
      let left = sx - tip.offsetWidth / 2;
      left = Math.max(2, Math.min(wrap.clientWidth - tip.offsetWidth - 2, left));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(-4, sy - tip.offsetHeight - 9) + 'px';
    }
    function hide() { cursor.style.display = 'none'; tip.style.display = 'none'; }
    svg.addEventListener('pointermove', e => show(e.clientX));
    svg.addEventListener('pointerdown', e => show(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }
  function openTeamModal(fr, row) {
    if (!fr) return;
    const t = (k) => (window.t ? window.t(k) : k);
    if (!_lastTraj[fr]) computed();                    // garantit une trajectoire à jour
    const bd = ensureModal();
    const rank = row ? ((row.querySelector('.fr-pos') || {}).textContent || '') : '';
    const pts = row ? ((row.querySelector('.fr-pts') || {}).textContent || '') : '';
    const ms = teamMatches(fr, 5);
    // Δ points FIFA par match (depuis la trajectoire, indexée par date)
    const trj = _lastTraj[fr] || [], dmap = {};
    for (let i = 1; i < trj.length; i++) dmap[trj[i].date] = trj[i].pts - trj[i - 1].pts;
    const fmt = (d) => (typeof dayjs !== 'undefined') ? dayjs(d).format('D MMM YYYY') : new Date(d).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' });
    let listHtml;
    if (!ms.length) listHtml = '<div class="fr-empty">' + t('ranking_no_wc') + '</div>';
    else listHtml = ms.map(m => {
      const hasSO = m.soF != null && m.soA != null;
      const won = hasSO ? m.soF > m.soA : m.gf > m.ga;
      const lost = hasSO ? m.soF < m.soA : m.gf < m.ga;
      const cls = m.live ? 'live' : won ? 'w' : lost ? 'l' : 'd';
      const mark = m.live ? '●' : won ? '✓' : lost ? '✗' : '•';
      const so = hasSO ? ' <span class="fr-mm-so">(' + m.soF + '-' + m.soA + ' ' + t('shootout_abbr') + ')</span>' : '';
      const of = m.oppIso ? '<img src="' + flag(m.oppIso, 40) + '" alt="" onerror="this.style.display=\'none\'">' : '';
      return '<div class="fr-mm ' + cls + '"><span class="fr-res ' + cls + '">' + mark + '</span>'
        + '<div class="fr-mm-mid"><div class="fr-mm-opp">' + of + '<span>' + esc(m.oppAbbr || m.oppFr) + '</span></div>'
        + '<div class="fr-mm-stage">' + (STAGE[m.slug] ? t(STAGE[m.slug]) : '') + '</div></div>'
        + '<div class="fr-mm-right"><div class="fr-mm-score">' + m.gf + '–' + m.ga + so + '</div>'
        + '<div class="fr-mm-date">' + esc(fmt(m.date)) + '</div>'
        + ((!m.live && dmap[m.date] != null) ? '<div class="fr-mm-delta" style="color:' + (dmap[m.date] >= 0 ? '#3ee07a' : '#ff5252') + '">' + (dmap[m.date] >= 0 ? '+' : '') + dmap[m.date].toFixed(2) + ' pts</div>' : '')
        + '</div></div>';
    }).join('');
    bd.querySelector('.fr-modal-body').innerHTML =
      '<div class="fr-modal-head"><img class="fr-modal-flag" src="' + flag(ISO[fr], 160) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      + '<div><div class="fr-modal-name">' + esc(fr) + '</div><div class="fr-modal-sub">'
      + (rank ? '#' + rank + ' · ' : '') + esc(pts) + ' pts</div></div></div>'
      + sparkline(fr)
      + '<div class="fr-modal-listtitle">' + t('ranking_last5') + '</div>'
      + '<div class="fr-modal-list">' + listHtml + '</div>';
    bd.classList.add('open');
    wireSparkline(fr);   // interactivité du graphique (survol des points)
  }

  /* ---------------- CSS injecté (aucune dépendance de page) ---------------- */
  function injectCSS() {
    if (document.getElementById('fifa-ranking-css')) return;
    const st = document.createElement('style');
    st.id = 'fifa-ranking-css';
    st.textContent = `
.fr-wrap { max-width: 840px; margin: 0 auto; }
.fr-head-block { text-align: center; margin-bottom: 18px; }
.fr-title { font-family: var(--font-d, 'Bebas Neue', sans-serif); font-size: 1.9em; letter-spacing: 0.04em; color: #fff; }
.fr-sub { color: var(--muted, #8fa3b5); font-size: 0.82em; margin-top: 4px; }
.fr-live-pill { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 3px 10px; border-radius: 999px; background: rgba(46,213,115,0.16); border: 1px solid rgba(46,213,115,0.5); color: #3ee07a; font-size: 0.58em; font-weight: 800; letter-spacing: 0.08em; vertical-align: middle; text-transform: uppercase; }
.fr-live-pill .dot { width: 7px; height: 7px; border-radius: 50%; background: #3ee07a; box-shadow: 0 0 8px #3ee07a; }
.fr-table { background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; }
.fr-colhead, .fr-row { display: grid; grid-template-columns: 84px 1fr 176px 96px; align-items: center; gap: 8px; }
.fr-colhead { padding: 12px 18px; font-size: 0.62em; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted, #8fa3b5); border-bottom: 1px solid rgba(255,255,255,0.08); }
.fr-colhead .c-match { text-align: center; } .fr-colhead .c-pts { text-align: right; }
.fr-row { padding: 9px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s; cursor: pointer; }
.fr-row:last-child { border-bottom: none; }
.fr-row:hover { background: rgba(255,255,255,0.03); }
.fr-row.is-out { opacity: 0.62; }
.fr-row.is-fav { background: rgba(251,197,49,0.07); box-shadow: inset 3px 0 0 var(--gold, #fbc531); }
.fr-row.is-fav:hover { background: rgba(251,197,49,0.11); }
.fr-fav-star { color: var(--gold, #fbc531); font-size: 0.85em; flex-shrink: 0; }
.fr-rank { display: flex; align-items: center; gap: 8px; }
.fr-pos { font-family: var(--font-d, 'Bebas Neue', sans-serif); font-size: 1.3em; color: #fff; min-width: 24px; }
.fr-move { font-size: 0.72em; font-weight: 800; white-space: nowrap; }
.fr-move.up { color: #3ee07a; } .fr-move.down { color: #ff5252; } .fr-move.same { color: var(--muted, #8fa3b5); opacity: 0.55; }
.fr-team { display: flex; align-items: center; gap: 10px; min-width: 0; }
.fr-flag { width: 30px; height: 20px; object-fit: cover; border-radius: 3px; box-shadow: 0 1px 4px rgba(0,0,0,0.5); flex-shrink: 0; }
.fr-name { font-weight: 700; font-size: 0.92em; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fr-match { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 0.78em; color: #fff; }
.fr-res { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; font-size: 0.66em; font-weight: 900; flex-shrink: 0; }
.fr-res.w { background: #16a34a; color: #fff; } .fr-res.l { background: #dc2626; color: #fff; } .fr-res.d { background: #64748b; color: #fff; }
.fr-res.live { background: var(--live, #ff4757); color: #fff; }
.fr-score { font-weight: 800; }
.fr-opp-flag { width: 18px; height: 12px; object-fit: cover; border-radius: 2px; }
.fr-opp { color: var(--muted, #8fa3b5); font-weight: 700; }
.fr-next { color: var(--muted, #8fa3b5); }
.fr-pts { font-family: var(--font-d, 'Bebas Neue', sans-serif); font-size: 1.18em; color: var(--gold, #fbc531); text-align: right; }
.fr-note { text-align: center; color: var(--muted, #8fa3b5); font-size: 0.72em; margin-top: 14px; line-height: 1.6; }
.fr-empty { text-align: center; color: var(--muted, #8fa3b5); padding: 26px 10px; font-size: 0.9em; }
/* recherche (styles autonomes, identiques au filtre du Tracker) */
.fr-search-wrap { display: flex; justify-content: center; margin-bottom: 16px; }
.fr-filter-wrap { position: relative; width: 100%; max-width: 320px; }
.fr-filter-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); font-size: 1.1em; opacity: 0.7; }
.fr-filter-input { width: 100%; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.05); border-radius: 40px; padding: 12px 16px 12px 44px; color: #fff; font-family: var(--font-b, 'Inter', sans-serif); font-size: 0.85em; font-weight: 500; transition: border-color 0.2s, box-shadow 0.2s; }
.fr-filter-input:focus { outline: none; border-color: rgba(255,255,255,0.2); box-shadow: 0 0 20px rgba(0,0,0,0.5); }
.fr-filter-input::placeholder { color: var(--muted, #8fa3b5); }
/* mode widget (dashboard) : toolbar compacte + table façon carte du dashboard */
.fr-widget { max-width: none; margin: 0; }
.fr-widget .fr-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.fr-widget .fr-filter-wrap { max-width: 300px; }
.fr-widget .fr-filter-input { padding: 10px 14px 10px 42px; }
.fr-widget .fr-live-pill { margin-left: 0; font-size: 0.62em; }
.fr-widget .fr-table { background: rgba(15,25,35,0.7); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 18px; }
.fr-sep { text-align: center; color: var(--muted, #8fa3b5); letter-spacing: 0.3em; padding: 2px 0 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.fr-expand-btn { display: block; width: 100%; margin-top: 12px; padding: 10px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14); background: transparent; color: #c8d2dd; font-weight: 800; font-size: 0.75em; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: color 0.15s, border-color 0.15s; }
.fr-expand-btn:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
/* modale : 5 derniers matchs de l'équipe
   PERF : PAS de backdrop-filter blur — plein écran, il se recalculerait à chaque
   frame de ce qui bouge derrière (vidéo/stream). Fond opaque = coût nul. */
.fr-modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(3,8,6,0.86); z-index: 1400; align-items: center; justify-content: center; padding: 18px; }
.fr-modal-backdrop.open { display: flex; }
@keyframes frModalIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.fr-modal { position: relative; width: 400px; max-width: 100%; max-height: 88vh; overflow-y: auto; background: var(--panel2, #10202f); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,0.7); padding: 22px; animation: frModalIn 0.22s ease; }
.fr-modal-close { position: absolute; top: 12px; right: 12px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #fff; font-size: 0.95em; cursor: pointer; transition: background 0.15s; }
.fr-modal-close:hover { background: rgba(255,255,255,0.15); }
.fr-modal-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding-right: 30px; }
.fr-modal-flag { width: 56px; height: 38px; object-fit: cover; border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); flex-shrink: 0; }
.fr-modal-name { font-family: var(--font-d, 'Bebas Neue', sans-serif); font-size: 1.55em; color: #fff; line-height: 1; }
.fr-modal-sub { color: var(--gold, #fbc531); font-size: 0.82em; font-weight: 700; margin-top: 5px; }
.fr-modal-listtitle { font-size: 0.68em; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted, #8fa3b5); margin: 4px 0 8px; }
.fr-mm { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: center; padding: 9px 2px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.fr-mm:last-child { border-bottom: none; }
.fr-mm-mid { min-width: 0; }
.fr-mm-opp { display: flex; align-items: center; gap: 7px; font-weight: 700; color: #fff; font-size: 0.92em; }
.fr-mm-opp img { width: 20px; height: 13px; object-fit: cover; border-radius: 2px; }
.fr-mm-stage { color: var(--muted, #8fa3b5); font-size: 0.72em; margin-top: 2px; }
.fr-mm-right { text-align: right; }
.fr-mm-score { font-family: var(--font-d, 'Bebas Neue', sans-serif); font-size: 1.16em; color: #fff; white-space: nowrap; }
.fr-mm-so { font-family: var(--font-b, 'Inter', sans-serif); font-size: 0.55em; color: var(--muted, #8fa3b5); }
.fr-mm-date { color: var(--muted, #8fa3b5); font-size: 0.7em; margin-top: 2px; }
.fr-mm-delta { font-size: 0.68em; font-weight: 800; margin-top: 1px; }
.fr-mm.live .fr-mm-score { color: var(--live, #ff4757); }
/* mini-graphique d'évolution des points */
.fr-spark-wrap { position: relative; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 12px 14px 8px; margin-bottom: 16px; }
.fr-spark-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.fr-spark-label { font-size: 0.66em; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted, #8fa3b5); }
.fr-spark-delta { font-family: var(--font-b, 'Inter', sans-serif); font-weight: 800; font-size: 0.85em; white-space: nowrap; }
.fr-spark { width: 100%; height: 62px; display: block; cursor: crosshair; touch-action: none; }
.fr-spark-axis { display: flex; justify-content: space-between; font-size: 0.62em; color: var(--muted, #8fa3b5); margin-top: 3px; }
.fr-spark-tip { position: absolute; pointer-events: none; z-index: 2; background: #0b1b12; border: 1px solid rgba(255,255,255,0.18); border-left: 3px solid var(--gold, #fbc531); border-radius: 8px; padding: 6px 9px; font-size: 0.72em; line-height: 1.35; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,0.6); white-space: nowrap; }
.fr-spark-tip b { display: flex; align-items: center; gap: 5px; font-weight: 700; }
.fr-spark-tip b img { width: 16px; height: 11px; object-fit: cover; border-radius: 2px; }
.fr-spark-tip i { color: var(--muted, #8fa3b5); font-style: normal; }
.fr-tip-date { color: var(--muted, #8fa3b5); font-size: 0.92em; margin-top: 1px; }
.fr-tip-row { display: flex; gap: 8px; align-items: baseline; margin-top: 2px; }
.fr-tip-pts { color: var(--gold, #fbc531); font-weight: 800; }
.fr-tip-delta { font-weight: 800; }
.fr-tip-rank { color: #cfd8e0; font-weight: 700; }
@media (max-width: 640px) {
  .fr-colhead, .fr-row { grid-template-columns: 60px 1fr 66px; }
  .fr-match, .fr-colhead .c-match { display: none; }
  .fr-name { font-size: 0.82em; } .fr-pos { font-size: 1.1em; }
  .fr-widget .fr-filter-wrap { max-width: none; flex: 1; }
}`;
    document.head.appendChild(st);
  }

  /* ---------------- API + langue ---------------- */
  // changement de langue → reconstruit la coquille (libellés) en gardant recherche/état
  window.addEventListener('langchange', () => { if (_host) { _host.innerHTML = ''; render(); } });

  window.FifaRanking = {
    mount(el, opts) {
      if (!el) return;
      _host = el;
      _opts = Object.assign({ mode: 'full', collapsed: 10 }, opts || {});
      injectCSS();
      render();
    },
    update: window.updateFifaRanking,
    rerender: render,
    // rang + points actuels d'une équipe (nom FR) — ex. pour le badge lanyard
    get(fr) { if (!_lastList.length) computed(); return _lastList.find(t => t.fr === fr) || null; }
  };
})();
