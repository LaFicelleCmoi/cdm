/* ===================================================================
   MATCH-PIP — épingle un match en Picture-in-Picture (module PARTAGÉ).
   Une mini-fenêtre TOUJOURS AU-DESSUS des autres applications, qui suit
   le match en direct : drapeaux, score, horloge, buts et cartons rangés
   par camp, ou l'affiche et le compte à rebours pour un match à venir.

   Deux implémentations, la meilleure disponible d'abord :
     1. Document Picture-in-Picture (Chrome/Edge 116+) : une vraie page
        HTML dans la fenêtre flottante → texte net, mise à jour ciblée.
     2. Repli universel : un <canvas> peint puis diffusé dans un <video>
        via captureStream() + requestPictureInPicture() (Firefox, Safari).
        Aucune image externe n'est dessinée (un canvas « teinté » ferait
        échouer captureStream) : abréviations, score et horloge seulement.

   ---- Coût de fonctionnement (le PIP tourne parfois des heures) ----
   • DONNÉES : le SCOREBOARD du jour suffit (competitions[].details porte
     buts ET cartons avec leurs auteurs) ; il pèse une fraction du summary,
     qui n'est plus utilisé. Mieux : les pages poussent leur propre lot de
     matchs du jour via MatchPiP.seed(events) → zéro requête tant que la
     page rafraîchit déjà (toutes les 30 s).
   • CADENCE ADAPTATIVE : 15 s en direct, 60 s avant le coup d'envoi,
     PLUS AUCUNE requête une fois le match terminé.
   • PAS DE THROTTLING : le minuteur vit dans la fenêtre PIP (toujours
     visible) et non dans l'onglet, qu'un navigateur brident à 1 réveil
     par minute en arrière-plan — c'est justement là que le PIP sert.
   • RENDU : une signature compare l'état affiché à l'état reçu ; sans
     changement, ni DOM ni canvas ne sont retouchés. Le canvas ne diffuse
     une image que sur changement réel (captureStream(0) + requestFrame).
   • Le compte à rebours d'un match à venir est calculé en local, sans
     requête, et ne réécrit que son propre nœud.

   API : window.MatchPiP.open(eventId [, { slug }])  /  .close()
         .supported()  /  .seed(events)  /  .label()
   Charger APRÈS team-data.js (noms FR + drapeaux) et competition.js.
   =================================================================== */
(function () {
  'use strict';

  var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  var MS_LIVE = 15000, MS_PRE = 60000;     // cadence réseau selon l'état du match
  var MAX_SIDE = 5;                        // lignes d'événements par camp
  var _win = null, _video = null, _canvas = null, _stream = null, _track = null;
  var _timer = null, _tick = null, _id = null, _opts = null;
  var _ev = null;                          // dernier event ESPN connu du match
  var _sig = '';                           // signature de l'état affiché
  var _busy = false;

  var lang = function () { return (window.getLang && window.getLang()) === 'en' ? 'en' : 'fr'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var frOf = function (dn) { return (window.TEAM_FR && window.TEAM_FR[dn]) || dn; };
  var isoOf = function (dn) { var fr = frOf(dn); return (window.TEAM_ISO && window.TEAM_ISO[fr]) || ''; };
  var tmo = function (ms) { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } };
  var slugOf = function (o) { return (o && o.slug) || (window.COMP && window.COMP.slug) || 'fifa.world'; };

  var L = {
    fr: { og: '(csc)', pen: '(pen.)',
          pin: 'Épingler en PIP', kickoff: 'Coup d’envoi', live: 'EN DIRECT', ft: 'Terminé',
          pens: 't.a.b.', none: 'Match introuvable', vs: 'VS' },
    en: { og: '(og)', pen: '(pen.)',
          pin: 'Pin to PiP', kickoff: 'Kick-off', live: 'LIVE', ft: 'Full time',
          pens: 'pens', none: 'Match not found', vs: 'VS' }
  };
  var T = function (k) { return L[lang()][k] || L.fr[k] || k; };

  var docPipOk = function () { return !!(window.documentPictureInPicture && window.documentPictureInPicture.requestWindow); };
  var videoPipOk = function () {
    return !!(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture
      && HTMLCanvasElement.prototype.captureStream);
  };
  function supported() { return docPipOk() || videoPipOk(); }

  /* ---------------- Données : le scoreboard suffit ---------------- */
  // AAAAMMJJ (heure de Paris) du match : le scoreboard s'interroge par journée
  function dayParam(iso) {
    try {
      return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(iso)).replace(/-/g, '');
    } catch (e) { return String(iso || '').slice(0, 10).replace(/-/g, ''); }
  }

  function fetchDay(day) {
    return fetch(API + slugOf(_opts) + '/scoreboard?dates=' + day, { cache: 'no-store', signal: tmo(8000) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return j.events || []; });
  }

  // Lot de matchs déjà récupéré par la page : on s'en sert sans rien demander
  function seed(events) {
    if (!_id || !events || !events.length) return;
    for (var i = 0; i < events.length; i++) {
      if (events[i] && String(events[i].id) === _id) { apply(events[i]); return; }
    }
  }

  /* ---------------- Modèle d'affichage ---------------- */
  function model(ev) {
    var c = ev && ev.competitions && ev.competitions[0];
    if (!c) return null;
    var cs = c.competitors || [];
    var h = cs.filter(function (x) { return x.homeAway === 'home'; })[0] || cs[0];
    var a = cs.filter(function (x) { return x.homeAway === 'away'; })[0] || cs[1];
    if (!h || !a || !h.team || !a.team) return null;
    var st = c.status || {}, ty = st.type || {};
    var state = ty.state || 'pre';
    var side = function (x) {
      var dn = x.team.displayName || x.team.name || '';
      return {
        fr: frOf(dn), iso: isoOf(dn),
        abbr: x.team.abbreviation || (frOf(dn) || '').slice(0, 3).toUpperCase(),
        score: state === 'pre' ? '' : String(x.score == null ? '' : x.score),
        so: x.shootoutScore == null ? null : x.shootoutScore,
        color: x.team.color ? '#' + x.team.color : '#8a9bb0'
      };
    };
    var clock = state === 'in' ? (st.displayClock || ty.shortDetail || '')
      : state === 'post' ? (ty.detail || T('ft'))
        : kickoffTxt(ev.date);
    var sc = timeline(c, String(h.team.id));
    return {
      home: side(h), away: side(a), state: state, clock: clock, date: ev.date,
      phase: c.altGameNote || (c.notes && c.notes[0] && c.notes[0].headline) || ty.detail || '',
      evHome: sc.home, evAway: sc.away
    };
  }

  function kickoffTxt(iso) {
    try {
      return new Date(iso).toLocaleString(lang() === 'en' ? 'en-GB' : 'fr-FR',
        { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    } catch (e) { return ''; }
  }
  // compte à rebours calculé EN LOCAL (aucune requête)
  function countdown(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms) || ms <= 0) return '';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return '⏳ ' + d + ' j ' + (h % 24) + ' h';
    if (h >= 1) return '⏳ ' + h + ' h ' + (m % 60) + ' min';
    return '⏳ ' + m + ' min';
  }

  /* Buts ET cartons rangés : ordre chronologique puis répartis par camp.
     Le scoreboard expose tout dans competitions[].details — un csc y est déjà
     crédité à l'équipe qui en profite ; tirs au but et penalties manqués exclus. */
  function timeline(c, homeId) {
    var list = (c.details || []).map(function (d, i) { return { d: d, i: i }; })
      .filter(function (x) {
        var d = x.d;
        if (!d || d.shootout) return false;
        return d.scoringPlay || d.yellowCard || d.redCard;
      })
      .sort(function (a, b) {
        var ca = (a.d.clock && a.d.clock.value) || 0, cb = (b.d.clock && b.d.clock.value) || 0;
        return ca !== cb ? ca - cb : a.i - b.i;
      });
    var home = [], away = [];
    list.forEach(function (x) {
      var d = x.d;
      var who = (d.athletesInvolved || [])[0];
      var name = ((who && (who.displayName || who.shortName)) || '').split(' ').slice(-1)[0];
      var kind = d.redCard ? 'red' : d.yellowCard ? 'yellow' : 'goal';
      var tag = kind !== 'goal' ? '' : (d.ownGoal ? ' ' + T('og') : (d.penaltyKick ? ' ' + T('pen') : ''));
      (String(d.team && d.team.id) === homeId ? home : away).push({
        kind: kind,
        icon: kind === 'red' ? '🟥' : kind === 'yellow' ? '🟨' : '⚽',
        txt: ((d.clock && d.clock.displayValue) || '') + ' ' + name + tag
      });
    });
    return { home: trim(home), away: trim(away) };
  }

  // Trop d'événements pour la fenêtre : les cartons JAUNES les plus anciens
  // sautent en premier — un but ou un rouge n'est jamais masqué.
  function trim(list) {
    if (list.length <= MAX_SIDE) return list;
    var keep = list.slice(), i = 0;
    while (keep.length > MAX_SIDE && i < keep.length) {
      if (keep[i].kind === 'yellow') keep.splice(i, 1); else i++;
    }
    return keep.length > MAX_SIDE ? keep.slice(keep.length - MAX_SIDE) : keep;
  }

  // signature = ce qui est visible ; identique ⇒ rien à repeindre
  function sigOf(m) {
    return [m.state, m.home.score, m.away.score, m.home.so, m.away.so, m.clock, m.phase,
      m.evHome.map(function (e) { return e.icon + e.txt; }).join(','),
      m.evAway.map(function (e) { return e.icon + e.txt; }).join(',')].join('|');
  }

  /* ---------------- 1) Document Picture-in-Picture ---------------- */
  var CSS = [
    '*{box-sizing:border-box;margin:0}',
    'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1520;color:#fff;',
    '  height:100vh;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:10px 14px;overflow:hidden}',
    '.p-phase{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fbc531;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}',
    '.p-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px}',
    '.p-team{display:flex;align-items:center;gap:8px;min-width:0}',
    '.p-team.a{flex-direction:row-reverse}',
    '.p-flag{width:34px;height:23px;object-fit:cover;border-radius:3px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.6)}',
    '.p-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.p-score{font-size:30px;font-weight:800;line-height:1;white-space:nowrap;text-align:center}',
    '.p-vs{font-size:15px;font-weight:700;color:#8a9bb0}',
    '.p-pens{font-size:10px;font-weight:800;color:#fbc531;text-align:center}',
    '.p-status{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a9bb0;text-align:center;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.p-status.live{color:#ff4757}',
    '.p-goals{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;align-items:start;font-size:10px;color:#9fb0c2}',
    '.p-gcol{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.p-gcol span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px}',
    '.p-gcol span i{font-style:normal;font-size:9px;flex-shrink:0}',
    '.p-gcol.a{text-align:right}',
    '.p-gcol.a span{flex-direction:row-reverse}',
    '.p-gcol span.k-goal{color:#e6eef6}',
    '.p-gcol span.k-red{color:#ff8a93}',
    '@media (max-width:260px){.p-name{font-size:12px}.p-score{font-size:24px}.p-flag{width:26px;height:18px}}'
  ].join('');

  function flagTag(s) {
    return s.iso ? '<img class="p-flag" src="https://flagcdn.com/w80/' + s.iso + '.png" alt="" onerror="this.style.display=\'none\'">' : '';
  }
  function colHtml(list, cls) {
    return list.map(function (g) {
      return '<span class="k-' + g.kind + '"><i>' + g.icon + '</i>' + esc(g.txt) + '</span>';
    }).join('');
  }

  // Squelette écrit UNE fois ; ensuite seuls les nœuds qui changent sont touchés.
  function shell(w, m) {
    var st = w.document.createElement('style');
    st.textContent = CSS;
    w.document.head.appendChild(st);
    w.document.body.innerHTML =
      '<div class="p-phase" id="k-phase"></div>'
      + '<div class="p-row">'
      + '<div class="p-team h">' + flagTag(m.home) + '<span class="p-name">' + esc(m.home.fr) + '</span></div>'
      + '<div><div class="p-score" id="k-score"></div><div class="p-pens" id="k-pens"></div></div>'
      + '<div class="p-team a">' + flagTag(m.away) + '<span class="p-name">' + esc(m.away.fr) + '</span></div>'
      + '</div>'
      + '<div class="p-status" id="k-status"></div>'
      + '<div class="p-goals"><div class="p-gcol h" id="k-evh"></div><div class="p-gcol a" id="k-eva"></div></div>';
  }

  function paintDoc(m) {
    if (!_win || _win.closed) return;
    var D = _win.document;
    var set = function (id, html) { var el = D.getElementById(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
    set('k-phase', esc(m.phase || ''));
    set('k-score', m.state === 'pre'
      ? '<span class="p-vs">' + T('vs') + '</span>'
      : esc(m.home.score) + ' – ' + esc(m.away.score));
    set('k-pens', (m.home.so != null && m.away.so != null) ? T('pens') + ' ' + esc(m.home.so) + ' – ' + esc(m.away.so) : '');
    var status = D.getElementById('k-status');
    if (status) {
      status.className = 'p-status' + (m.state === 'in' ? ' live' : '');
      var txt = (m.state === 'in' ? '🔴 ' : '') + (m.clock || '');
      if (m.state === 'pre') { var cd = countdown(m.date); if (cd) txt += ' · ' + cd; }
      if (status.textContent !== txt) status.textContent = txt;
    }
    set('k-evh', colHtml(m.evHome, 'h'));
    set('k-eva', colHtml(m.evAway, 'a'));
  }

  /* ---------------- 2) Repli : canvas → video → PiP ---------------- */
  function paintCanvas(m) {
    if (!_canvas) return;
    var ctx = _canvas.getContext('2d');
    var W = _canvas.width, H = _canvas.height;
    ctx.fillStyle = '#0b1520'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = m.home.color; ctx.fillRect(0, 0, 10, H);
    ctx.fillStyle = m.away.color; ctx.fillRect(W - 10, 0, 10, H);
    ctx.fillStyle = '#fbc531';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText((m.phase || '').slice(0, 44), W / 2, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillText(m.home.abbr + '   ' + (m.state === 'pre' ? T('vs') : (m.home.score + ' – ' + m.away.score)) + '   ' + m.away.abbr, W / 2, H / 2);
    ctx.fillStyle = m.state === 'in' ? '#ff4757' : '#8a9bb0';
    ctx.font = '600 22px system-ui, sans-serif';
    var sub = (m.state === 'in' ? '● ' : '') + (m.clock || '');
    if (m.state === 'pre') { var cd = countdown(m.date); if (cd) sub += ' · ' + cd; }
    ctx.fillText(sub, W / 2, H - 104);
    ctx.font = '500 17px system-ui, sans-serif';
    var line = function (g, x, align, i) {
      ctx.textAlign = align;
      ctx.fillStyle = g.kind === 'red' ? '#ff8a93' : g.kind === 'yellow' ? '#9fb0c2' : '#e6eef6';
      ctx.fillText(g.icon + ' ' + g.txt, x, H - 76 + i * 20);
    };
    m.evHome.slice(-4).forEach(function (g, i) { line(g, 22, 'left', i); });
    m.evAway.slice(-4).forEach(function (g, i) { line(g, W - 22, 'right', i); });
    ctx.textAlign = 'center';
    // une image n'est diffusée QUE sur changement : au repos, coût nul
    if (_track && _track.requestFrame) _track.requestFrame();
  }

  function openVideoPip(m) {
    _canvas = document.createElement('canvas');
    _canvas.width = 640; _canvas.height = 340;
    // captureStream(0) : aucune image tant qu'on n'appelle pas requestFrame()
    var manual = !!(HTMLCanvasElement.prototype.captureStream);
    _stream = _canvas.captureStream(manual ? 0 : 4);
    _track = (_stream.getVideoTracks && _stream.getVideoTracks()[0]) || null;
    if (!(_track && _track.requestFrame)) {            // navigateur sans requestFrame
      _stream.getTracks().forEach(function (t) { t.stop(); });
      _stream = _canvas.captureStream(2);
      _track = null;
    }
    // le flux est branché AVANT le 1er dessin : avec captureStream(0), une image
    // produite avant l'attache serait perdue et la vidéo resterait noire
    _video = document.createElement('video');
    _video.srcObject = _stream;
    _video.muted = true; _video.playsInline = true;
    _video.style.position = 'fixed'; _video.style.left = '-9999px'; _video.style.width = '1px';
    document.body.appendChild(_video);
    _video.addEventListener('leavepictureinpicture', stopAll);
    paintCanvas(m);
    return _video.play().then(function () { return _video.requestPictureInPicture(); });
  }

  /* ---------------- Boucle ---------------- */
  function apply(ev) {
    if (!ev) return;
    _ev = ev;
    var m = model(ev);
    if (!m) return;
    var sig = sigOf(m);
    if (sig === _sig) return;          // rien de neuf : aucun repaint
    _sig = sig;
    if (_win) paintDoc(m); else paintCanvas(m);
    schedule(m.state);                 // la cadence suit l'état du match
  }

  function refresh() {
    if (!_id || _busy || !_ev) return;
    _busy = true;
    fetchDay(dayParam(_ev.date))
      .then(function (events) {
        for (var i = 0; i < events.length; i++) {
          if (String(events[i].id) === _id) { apply(events[i]); return; }
        }
      })
      .catch(function () {})
      .then(function () { _busy = false; });
  }

  // Le minuteur vit dans la fenêtre PIP (visible) : un onglet en arrière-plan
  // serait bridé à un réveil par minute, or c'est le cas d'usage du PIP.
  var host = function () { return (_win && !_win.closed) ? _win : window; };
  function clearTimers() {
    if (_timer) { try { _timer.w.clearInterval(_timer.id); } catch (e) {} _timer = null; }
    if (_tick) { try { _tick.w.clearInterval(_tick.id); } catch (e) {} _tick = null; }
  }
  function schedule(state) {
    clearTimers();
    if (state === 'post') return;                       // terminé : plus rien à demander
    var w = host(), every = state === 'in' ? MS_LIVE : MS_PRE;
    _timer = { w: w, id: w.setInterval(refresh, every) };
    if (state === 'pre') {                              // compte à rebours local
      _tick = { w: w, id: w.setInterval(function () {
        var m = _ev && model(_ev);
        if (!m) return;
        if (_win) paintDoc(m); else paintCanvas(m);
      }, 30000) };
    }
  }

  /* ---------------- Cycle de vie ---------------- */
  function open(eventId, opts) {
    if (!eventId || !supported()) return Promise.resolve(false);
    close();
    _id = String(eventId); _opts = opts || {}; _sig = '';
    // L'appelant connaît en général la date du match (carte live, widget,
    // feuille de match) : le scoreboard de cette journée suffit — UNE requête.
    // Sans date, on la demande une fois au summary, puis plus jamais.
    var day = _opts.date
      ? Promise.resolve(dayParam(_opts.date))
      : fetch(API + slugOf(_opts) + '/summary?event=' + encodeURIComponent(_id), { cache: 'no-store', signal: tmo(10000) })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) {
            var c = d && d.header && d.header.competitions && d.header.competitions[0];
            if (!c) throw new Error('summary vide');
            return dayParam(c.date);
          });
    return day
      .then(function (dp) {
        return fetchDay(dp).then(function (events) {
          for (var i = 0; i < events.length; i++) if (String(events[i].id) === _id) return events[i];
          throw new Error(T('none'));
        });
      })
      .then(function (ev) {
        _ev = ev;
        var m = model(ev);
        if (!m) throw new Error('match illisible');
        var p = docPipOk()
          ? window.documentPictureInPicture.requestWindow({ width: 360, height: 210 }).then(function (w) {
              _win = w;
              shell(w, m);
              w.addEventListener('pagehide', stopAll);
            })
          : openVideoPip(m);
        return p.then(function () {
          _sig = sigOf(m);
          if (_win) paintDoc(m);
          schedule(m.state);
          return true;
        });
      })
      .catch(function (e) { console.warn('PiP:', e); stopAll(); return false; });
  }

  function stopAll() {
    clearTimers();
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
    if (_video) { try { _video.pause(); } catch (e) {} _video.remove(); _video = null; }
    _canvas = null; _track = null; _id = null; _ev = null; _sig = ''; _busy = false;
  }

  function close() {
    clearTimers();
    try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) {}
    if (_win && !_win.closed) { try { _win.close(); } catch (e) {} }
    _win = null;
    stopAll();
  }

  // la langue change → libellés et formats de date suivent
  window.addEventListener('langchange', function () {
    if (!_ev) return;
    _sig = '';
    apply(_ev);
  });

  window.MatchPiP = {
    open: open, close: close, supported: supported, seed: seed,
    label: function () { return T('pin'); }
  };
})();
