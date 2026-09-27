/* ===================================================================
   MATCH-PIP — épingle un match en Picture-in-Picture (module PARTAGÉ).
   Une mini-fenêtre TOUJOURS AU-DESSUS des autres applications, qui suit
   le match en direct : drapeaux, score, horloge, buteurs, ou l'affiche
   et le compte à rebours pour un match à venir.

   Deux implémentations, la meilleure disponible d'abord :
     1. Document Picture-in-Picture (Chrome/Edge 116+) : une vraie page
        HTML dans la fenêtre flottante → texte net, mise à jour ciblée.
     2. Repli universel : un <canvas> peint puis diffusé dans un <video>
        via captureStream() + requestPictureInPicture() (Firefox, Safari).
        Aucune image externe n'est dessinée (un canvas « teinté » ferait
        échouer captureStream) : abréviations, score et horloge seulement.

   Données : summary?event= via MatchSheet.fetch (cache 20 s en direct),
   rafraîchi toutes les 15 s tant que la fenêtre est ouverte.

   API : window.MatchPiP.open(eventId [, { slug }])  /  .close()  /  .supported()
   Charger APRÈS match-sheet.js (et team-data.js pour les noms FR).
   =================================================================== */
(function () {
  'use strict';

  var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  var REFRESH = 20000;   // aligné sur le cache « live » du summary (MatchSheet)
  var _win = null, _video = null, _canvas = null, _stream = null;
  var _timer = null, _paint = null, _id = null, _opts = null, _data = null;

  var lang = function () { return (window.getLang && window.getLang()) === 'en' ? 'en' : 'fr'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var frOf = function (dn) { return (window.TEAM_FR && window.TEAM_FR[dn]) || dn; };
  var isoOf = function (dn) { var fr = frOf(dn); return (window.TEAM_ISO && window.TEAM_ISO[fr]) || ''; };
  var tmo = function (ms) { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } };

  var L = {
    fr: { pin: 'Épingler en PIP', kickoff: 'Coup d’envoi', live: 'EN DIRECT', ft: 'Terminé',
          ht: 'Mi-temps', pens: 't.a.b.', soon: 'À venir', none: 'Match introuvable', vs: 'VS' },
    en: { pin: 'Pin to PiP', kickoff: 'Kick-off', live: 'LIVE', ft: 'Full time',
          ht: 'Half-time', pens: 'pens', soon: 'Upcoming', none: 'Match not found', vs: 'VS' }
  };
  var T = function (k) { return L[lang()][k] || L.fr[k] || k; };

  var docPipOk = function () { return !!(window.documentPictureInPicture && window.documentPictureInPicture.requestWindow); };
  var videoPipOk = function () {
    return !!(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture
      && HTMLCanvasElement.prototype.captureStream);
  };
  function supported() { return docPipOk() || videoPipOk(); }

  /* ---------------- Données ---------------- */
  function slugOf(o) { return (o && o.slug) || (window.COMP && window.COMP.slug) || 'fifa.world'; }
  function load(id, opts) {
    // MatchSheet partage déjà le cache du summary (20 s en direct) : on le réutilise
    if (window.MatchSheet && window.MatchSheet.fetch) return window.MatchSheet.fetch(id, opts);
    return fetch(API + slugOf(opts) + '/summary?event=' + encodeURIComponent(id), { cache: 'no-store', signal: tmo(10000) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // extrait de quoi peindre la fenêtre, quel que soit le rendu choisi
  function model(d) {
    var c = d && d.header && d.header.competitions && d.header.competitions[0];
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
        : kickoffTxt(c.date);
    // buteurs (fil du match) : les 3 derniers buts, pour garder la fenêtre lisible
    var goals = (d.keyEvents || []).filter(function (e) {
      var t = ((e.type && e.type.type) || '') + ' ' + ((e.type && e.type.text) || '');
      return /goal/i.test(t) && !/own/i.test(t) || /penalty - scored/i.test(t);
    }).slice(-3).map(function (e) {
      var who = ((e.participants || [])[0] || {}).athlete;
      return ((e.clock && e.clock.displayValue) || '') + ' ' + ((who && who.displayName) || '').split(' ').slice(-1)[0];
    });
    return {
      home: side(h), away: side(a), state: state, clock: clock,
      phase: c.altGameNote || '', date: c.date, goals: goals
    };
  }
  function kickoffTxt(iso) {
    try {
      return new Date(iso).toLocaleString(lang() === 'en' ? 'en-GB' : 'fr-FR',
        { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    } catch (e) { return ''; }
  }

  /* ---------------- 1) Document Picture-in-Picture ---------------- */
  var CSS = [
    '*{box-sizing:border-box;margin:0}',
    'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1520;color:#fff;',
    '  height:100vh;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:12px 14px;overflow:hidden}',
    '.p-phase{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fbc531;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}',
    '.p-row{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px}',
    '.p-team{display:flex;align-items:center;gap:8px;min-width:0}',
    '.p-team.a{flex-direction:row-reverse}',
    '.p-flag{width:34px;height:23px;object-fit:cover;border-radius:3px;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.6)}',
    '.p-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.p-score{font-size:30px;font-weight:800;line-height:1;white-space:nowrap}',
    '.p-vs{font-size:15px;font-weight:700;color:#8a9bb0}',
    '.p-pens{font-size:10px;font-weight:800;color:#fbc531;text-align:center;margin-top:2px}',
    '.p-status{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a9bb0;text-align:center;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.p-status.live{color:#ff4757}',
    '.p-goals{font-size:10px;color:#9fb0c2;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '@media (max-width:260px){.p-name{font-size:12px}.p-score{font-size:24px}.p-flag{width:26px;height:18px}}'
  ].join('');

  function docHtml(m) {
    var fl = function (s) {
      return s.iso ? '<img class="p-flag" src="https://flagcdn.com/w80/' + s.iso + '.png" alt="" onerror="this.style.display=\'none\'">' : '';
    };
    var mid = m.state === 'pre'
      ? '<div class="p-vs">' + T('vs') + '</div>'
      : '<div class="p-score">' + esc(m.home.score) + ' – ' + esc(m.away.score) + '</div>';
    var so = (m.home.so != null && m.away.so != null)
      ? '<div class="p-pens">' + T('pens') + ' ' + esc(m.home.so) + ' – ' + esc(m.away.so) + '</div>' : '';
    return '<div class="p-phase">' + esc(m.phase || '') + '</div>'
      + '<div class="p-row">'
      + '<div class="p-team h">' + fl(m.home) + '<span class="p-name">' + esc(m.home.fr) + '</span></div>'
      + '<div>' + mid + '</div>'
      + '<div class="p-team a">' + fl(m.away) + '<span class="p-name">' + esc(m.away.fr) + '</span></div>'
      + '</div>' + so
      + '<div class="p-status' + (m.state === 'in' ? ' live' : '') + '">'
      + (m.state === 'in' ? '🔴 ' : '') + esc(m.clock || '') + '</div>'
      + (m.goals && m.goals.length ? '<div class="p-goals">⚽ ' + esc(m.goals.join(' · ')) + '</div>' : '');
  }

  function openDocPip(m) {
    return window.documentPictureInPicture.requestWindow({ width: 340, height: 170 }).then(function (w) {
      _win = w;
      var st = w.document.createElement('style');
      st.textContent = CSS;
      w.document.head.appendChild(st);
      w.document.body.innerHTML = docHtml(m);
      w.addEventListener('pagehide', stopAll);
      return w;
    });
  }

  /* ---------------- 2) Repli : canvas → video → PiP ---------------- */
  function paint(m) {
    if (!_canvas) return;
    var ctx = _canvas.getContext('2d');
    var W = _canvas.width, H = _canvas.height;
    ctx.fillStyle = '#0b1520'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // bandeaux aux couleurs des deux sélections (pas d'image : canvas non teinté)
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
    ctx.fillText((m.state === 'in' ? '● ' : '') + (m.clock || ''), W / 2, H - 58);
    if (m.goals && m.goals.length) {
      ctx.fillStyle = '#9fb0c2';
      ctx.font = '500 18px system-ui, sans-serif';
      ctx.fillText(m.goals.join(' · ').slice(0, 60), W / 2, H - 26);
    }
  }

  function openVideoPip(m) {
    _canvas = document.createElement('canvas');
    _canvas.width = 640; _canvas.height = 300;
    paint(m);
    _stream = _canvas.captureStream(4);          // 4 img/s : largement assez pour un score
    _video = document.createElement('video');
    _video.srcObject = _stream;
    _video.muted = true; _video.playsInline = true;
    _video.style.position = 'fixed'; _video.style.left = '-9999px'; _video.style.width = '1px';
    document.body.appendChild(_video);
    _video.addEventListener('leavepictureinpicture', stopAll);
    // le canvas doit continuer à produire des images, sinon le flux se fige
    _paint = setInterval(function () { if (_data) paint(model(_data) || m); }, 1000);
    return _video.play().then(function () { return _video.requestPictureInPicture(); });
  }

  /* ---------------- Cycle de vie ---------------- */
  function refresh() {
    if (!_id) return;
    load(_id, _opts).then(function (d) {
      if (!_id) return;
      _data = d;
      var m = model(d);
      if (!m) return;
      if (_win && !_win.closed) _win.document.body.innerHTML = docHtml(m);
      else if (_canvas) paint(m);
    }).catch(function () {});
  }

  function open(eventId, opts) {
    if (!eventId) return Promise.resolve(false);
    if (!supported()) return Promise.resolve(false);
    close();
    _id = String(eventId); _opts = opts || {};
    return load(_id, _opts).then(function (d) {
      _data = d;
      var m = model(d);
      if (!m) throw new Error('summary vide');
      var p = docPipOk() ? openDocPip(m) : openVideoPip(m);
      return p.then(function () {
        _timer = setInterval(refresh, REFRESH);
        return true;
      });
    }).catch(function (e) {
      console.warn('PiP:', e);
      stopAll();
      return false;
    });
  }

  function stopAll() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_paint) { clearInterval(_paint); _paint = null; }
    if (_stream) { _stream.getTracks().forEach(function (t) { t.stop(); }); _stream = null; }
    if (_video) { try { _video.pause(); } catch (e) {} _video.remove(); _video = null; }
    _canvas = null; _id = null; _data = null;
  }

  function close() {
    try { if (document.pictureInPictureElement) document.exitPictureInPicture(); } catch (e) {}
    if (_win && !_win.closed) { try { _win.close(); } catch (e) {} }
    _win = null;
    stopAll();
  }

  window.MatchPiP = { open: open, close: close, supported: supported, label: function () { return T('pin'); } };
})();
