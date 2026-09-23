/* ===================================================================
   MATCH-SHEET — feuille de match complète (module PARTAGÉ).
   Rassemble TOUT ce qu'ESPN publie sur un match dans une seule fiche :
     • en-tête   : équipes, drapeaux, score, t.a.b., statut (MT/AP/FT), phase
     • infos     : stade, ville/pays, affluence, arbitre(s), diffuseurs
     • fil       : buts (+ passeur, penalty, CSC, tête, c.f.), cartons,
                   remplacements, coups d'envoi/mi-temps/prolongation/t.a.b.,
                   pauses fraîcheur — minute par minute, par camp
     • stats     : possession, tirs, cadrés, corners, fautes, hors-jeu,
                   passes, centres, tacles, interceptions, dégagements…
     • compos    : formation, onze de départ, remplaçants, entrées/sorties,
                   buts et cartons reportés sur chaque joueur
     • commentaire play-by-play (repliable) + résumé et lien ESPN

   Source : endpoint `summary?event=<id>` de la compétition affichée
   (window.COMP.slug → fifa.world ou uefa.nations).

   API : window.MatchSheet.open(eventId [, { slug }])  /  .close()
   Le CSS est injecté par le module (aucune dépendance de page) ; il repose
   sur les variables du site avec repli : --font-d/--font-b/--gold/--muted.
   Charger APRÈS team-data.js (noms FR + drapeaux) et competition.js.
   =================================================================== */
(function () {
  'use strict';

  var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  var cache = {};                                  // eventId -> { ts, data }
  var TTL_LIVE = 20000, TTL_DONE = 600000;         // match en cours / terminé
  var _host = null, _open = null, _busy = false;

  var slugOf = function (o) { return (o && o.slug) || (window.COMP && window.COMP.slug) || 'fifa.world'; };
  var lang = function () { return (window.getLang && window.getLang()) === 'en' ? 'en' : 'fr'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var frOf = function (dn) { return (window.TEAM_FR && window.TEAM_FR[dn]) || dn; };
  var isoOf = function (dn) { var fr = frOf(dn); return (window.TEAM_ISO && window.TEAM_ISO[fr]) || ''; };
  var tmo = function (ms) { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } };

  /* ---------------- Libellés (FR/EN, module autonome) ---------------- */
  var L = {
    fr: {
      sheet: 'Feuille de match', loading: 'Chargement de la feuille de match…',
      error: 'ESPN n’a pas répondu — réessaie dans un instant.',
      none: 'Aucune donnée détaillée pour ce match (elle arrive au coup d’envoi).',
      venue: 'Stade', attendance: 'Affluence', referee: 'Arbitre', referees: 'Arbitres', tv: 'Diffusion',
      timeline: 'Fil du match', stats: 'Statistiques', lineups: 'Compositions',
      commentary: 'Commentaire minute par minute', recap: 'Résumé', espn: 'Voir sur ESPN',
      starters: 'Titulaires', bench: 'Remplaçants', formation: 'Formation',
      pens: 't.a.b.', show: 'Afficher', hide: 'Masquer', close: 'Fermer',
      assist: 'passe', spectators: 'spectateurs',
      ev_goal: 'But', ev_own: 'But contre son camp', ev_pen: 'Penalty', ev_penmiss: 'Penalty manqué',
      ev_yellow: 'Carton jaune', ev_red: 'Carton rouge', ev_sub: 'Remplacement',
      ev_cooling: 'Pause fraîcheur', ev_delay: 'Interruption', ev_resume: 'Reprise',
      ev_kickoff: 'Coup d’envoi', ev_half: 'Mi-temps', ev_2nd: 'Seconde période',
      ev_endreg: 'Fin du temps réglementaire', ev_et: 'Prolongation', ev_ethalf: 'Mi-temps de la prolongation',
      ev_et2: '2e période de prolongation', ev_endet: 'Fin de la prolongation',
      ev_shootout: 'Séance de tirs au but', ev_end: 'Fin du match', ev_var: 'VAR',
      st: {
        possessionPct: 'Possession (%)', totalShots: 'Tirs', shotsOnTarget: 'Tirs cadrés',
        shotPct: 'Tirs cadrés (%)', blockedShots: 'Tirs contrés', wonCorners: 'Corners',
        foulsCommitted: 'Fautes commises', offsides: 'Hors-jeu', saves: 'Arrêts',
        yellowCards: 'Cartons jaunes', redCards: 'Cartons rouges',
        totalPasses: 'Passes', accuratePasses: 'Passes réussies', passPct: 'Passes réussies (%)',
        totalCrosses: 'Centres', accurateCrosses: 'Centres réussis', crossPct: 'Centres réussis (%)',
        totalLongBalls: 'Longs ballons', accurateLongBalls: 'Longs ballons réussis', longballPct: 'Longs ballons (%)',
        totalTackles: 'Tacles', effectiveTackles: 'Tacles réussis', tacklePct: 'Tacles réussis (%)',
        interceptions: 'Interceptions', totalClearance: 'Dégagements', effectiveClearance: 'Dégagements réussis',
        penaltyKickGoals: 'Penalties marqués', penaltyKickShots: 'Penalties tirés',
        goalAssists: 'Passes décisives', totalGoals: 'Buts', shotAssists: 'Passes avant tir',
        appearances: 'Titularisations'
      },
      pos: { Goalkeeper: 'Gardien', Defender: 'Défenseur', Midfielder: 'Milieu', Forward: 'Attaquant', Substitute: 'Remplaçant' }
    },
    en: {
      sheet: 'Match sheet', loading: 'Loading match sheet…',
      error: 'ESPN did not answer — try again in a moment.',
      none: 'No detailed data for this match yet (it starts at kick-off).',
      venue: 'Venue', attendance: 'Attendance', referee: 'Referee', referees: 'Referees', tv: 'Broadcast',
      timeline: 'Match timeline', stats: 'Statistics', lineups: 'Line-ups',
      commentary: 'Minute-by-minute commentary', recap: 'Recap', espn: 'View on ESPN',
      starters: 'Starting XI', bench: 'Substitutes', formation: 'Formation',
      pens: 'pens', show: 'Show', hide: 'Hide', close: 'Close',
      assist: 'assist', spectators: 'spectators',
      ev_goal: 'Goal', ev_own: 'Own goal', ev_pen: 'Penalty', ev_penmiss: 'Penalty missed',
      ev_yellow: 'Yellow card', ev_red: 'Red card', ev_sub: 'Substitution',
      ev_cooling: 'Drinks break', ev_delay: 'Delay', ev_resume: 'Play resumes',
      ev_kickoff: 'Kick-off', ev_half: 'Half-time', ev_2nd: 'Second half',
      ev_endreg: 'End of regular time', ev_et: 'Extra time', ev_ethalf: 'Extra-time half-time',
      ev_et2: 'Extra time, second half', ev_endet: 'End of extra time',
      ev_shootout: 'Penalty shootout', ev_end: 'Full time', ev_var: 'VAR',
      st: {
        possessionPct: 'Possession (%)', totalShots: 'Shots', shotsOnTarget: 'Shots on target',
        shotPct: 'Shot accuracy (%)', blockedShots: 'Blocked shots', wonCorners: 'Corners',
        foulsCommitted: 'Fouls committed', offsides: 'Offsides', saves: 'Saves',
        yellowCards: 'Yellow cards', redCards: 'Red cards',
        totalPasses: 'Passes', accuratePasses: 'Accurate passes', passPct: 'Pass accuracy (%)',
        totalCrosses: 'Crosses', accurateCrosses: 'Accurate crosses', crossPct: 'Cross accuracy (%)',
        totalLongBalls: 'Long balls', accurateLongBalls: 'Accurate long balls', longballPct: 'Long ball accuracy (%)',
        totalTackles: 'Tackles', effectiveTackles: 'Tackles won', tacklePct: 'Tackle success (%)',
        interceptions: 'Interceptions', totalClearance: 'Clearances', effectiveClearance: 'Effective clearances',
        penaltyKickGoals: 'Penalties scored', penaltyKickShots: 'Penalties taken',
        goalAssists: 'Assists', totalGoals: 'Goals', shotAssists: 'Chances created',
        appearances: 'Appearances'
      },
      pos: {}
    }
  };
  var T = function (k) { return L[lang()][k] || L.fr[k] || k; };
  // ordre d'affichage des statistiques (les autres suivent, telles quelles)
  var STAT_ORDER = ['possessionPct', 'totalShots', 'shotsOnTarget', 'shotPct', 'blockedShots', 'wonCorners',
    'offsides', 'foulsCommitted', 'yellowCards', 'redCards', 'saves', 'totalPasses', 'accuratePasses', 'passPct',
    'totalCrosses', 'accurateCrosses', 'crossPct', 'totalLongBalls', 'accurateLongBalls', 'longballPct',
    'totalTackles', 'effectiveTackles', 'tacklePct', 'interceptions', 'totalClearance', 'effectiveClearance',
    'penaltyKickGoals', 'penaltyKickShots'];
  var RATIO_PCT = { shotPct: 1, passPct: 1, crossPct: 1, longballPct: 1, tacklePct: 1 };
  var statLabel = function (s) { return (L[lang()].st[s.name] || L.fr.st[s.name] || s.displayName || s.name); };
  var posLabel = function (p) { return (L[lang()].pos[p] || p || ''); };

  /* ---------------- Typage des événements ESPN ---------------- */
  // ESPN fournit un `type.type` normalisé (goal, yellow-card, substitution…)
  // et un texte anglais : on en déduit une icône + un libellé traduit.
  function kindOf(ev) {
    var tt = ((ev.type && ev.type.type) || '').toLowerCase();
    var tx = ((ev.type && ev.type.text) || '').toLowerCase();
    if (/own/.test(tt) || /own goal/.test(tx)) return 'own';
    if (/penalty/.test(tx) && /(miss|saved|fail|post|bar)/.test(tx)) return 'penmiss';
    if (/penalty/.test(tx) && /scor/.test(tx)) return 'pen';
    if (/goal/.test(tt) || /^goal/.test(tx)) return 'goal';
    if (/red/.test(tt) || /red card/.test(tx)) return 'red';
    if (/yellow/.test(tt) || /yellow card/.test(tx)) return 'yellow';
    if (/substitution/.test(tt) || /substitution/.test(tx)) return 'sub';
    if (/var/.test(tx)) return 'var';
    if (/start.?delay/.test(tt) || /start delay/.test(tx)) return /drink|cool|water|hydrat/.test((ev.text || '').toLowerCase()) ? 'cooling' : 'delay';
    if (/end.?delay/.test(tt) || /end delay/.test(tx)) return 'resume';
    if (/kickoff/.test(tt) || /kickoff/.test(tx)) return 'kickoff';
    if (/shootout/.test(tx)) return 'shootout';
    if (/halftime extra/.test(tx)) return 'ethalf';
    if (/halftime/.test(tx)) return 'half';
    if (/start 2nd half extra/.test(tx)) return 'et2';
    if (/start 2nd half/.test(tx)) return 'second';
    if (/start extra/.test(tx)) return 'et';
    if (/end extra/.test(tx)) return 'endet';
    if (/end regular/.test(tx)) return 'endreg';
    if (/end match|full.?time/.test(tx)) return 'end';
    return 'other';
  }
  var ICON = {
    goal: '⚽', pen: '⚽', own: '🥅', penmiss: '❌', yellow: '🟨', red: '🟥', sub: '🔁', var: '📺',
    cooling: '💧', delay: '⏸', resume: '▶️', kickoff: '🟢', half: '⏸', second: '▶️', endreg: '⏱',
    et: '⏱', ethalf: '⏸', et2: '▶️', endet: '⏱', shootout: '🎯', end: '🏁', other: '•'
  };
  var KIND_LABEL = {
    goal: 'ev_goal', pen: 'ev_pen', own: 'ev_own', penmiss: 'ev_penmiss', yellow: 'ev_yellow', red: 'ev_red',
    sub: 'ev_sub', var: 'ev_var', cooling: 'ev_cooling', delay: 'ev_delay', resume: 'ev_resume',
    kickoff: 'ev_kickoff', half: 'ev_half', second: 'ev_2nd', endreg: 'ev_endreg', et: 'ev_et',
    ethalf: 'ev_ethalf', et2: 'ev_et2', endet: 'ev_endet', shootout: 'ev_shootout', end: 'ev_end'
  };
  var SIDED = { goal: 1, pen: 1, own: 1, penmiss: 1, yellow: 1, red: 1, sub: 1, var: 1 }; // rattaché à une équipe

  function people(ev) {
    return (ev.participants || []).map(function (p) { return (p && p.athlete && p.athlete.displayName) || ''; }).filter(Boolean);
  }

  /* ---------------- Récupération ---------------- */
  function fetchSummary(id, opts) {
    var c = cache[id];
    var fresh = c && (Date.now() - c.ts) < (c.live ? TTL_LIVE : TTL_DONE);
    if (fresh) return Promise.resolve(c.data);
    return fetch(API + slugOf(opts) + '/summary?event=' + encodeURIComponent(id), { cache: 'no-store', signal: tmo(10000) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var st = state(d);
        cache[id] = { ts: Date.now(), data: d, live: st === 'in' };
        return d;
      })
      .catch(function (e) { if (c) return c.data; throw e; });
  }
  function comp(d) { return (d && d.header && d.header.competitions && d.header.competitions[0]) || null; }
  function state(d) { var c = comp(d); return (c && c.status && c.status.type && c.status.type.state) || 'pre'; }

  /* ---------------- Rendu ---------------- */
  function teamBlock(c, side) {
    if (!c || !c.team) return '';
    var dn = c.team.displayName || c.team.name || '';
    var fr = frOf(dn), iso = isoOf(dn);
    var fl = iso
      ? '<img class="msh-flag" src="https://flagcdn.com/w80/' + iso + '.png" srcset="https://flagcdn.com/w160/' + iso + '.png 2x" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : (c.team.logos && c.team.logos[0] ? '<img class="msh-flag" src="' + esc(c.team.logos[0].href) + '" alt="">' : '');
    return '<div class="msh-team ' + side + '">' + fl + '<span class="msh-tname">' + esc(fr) + '</span></div>';
  }

  function headerHtml(d) {
    var c = comp(d);
    if (!c) return '';
    var cs = c.competitors || [];
    var home = cs.filter(function (x) { return x.homeAway === 'home'; })[0] || cs[0];
    var away = cs.filter(function (x) { return x.homeAway === 'away'; })[0] || cs[1];
    var st = c.status || {}, ty = st.type || {};
    var pre = ty.state === 'pre';
    var score = pre ? '—' : esc(home && home.score) + ' <span class="msh-sep">–</span> ' + esc(away && away.score);
    var so = (home && home.shootoutScore != null && away && away.shootoutScore != null)
      ? '<div class="msh-pens">' + T('pens') + ' ' + esc(home.shootoutScore) + ' – ' + esc(away.shootoutScore) + '</div>' : '';
    var when = '';
    try {
      when = new Date(c.date).toLocaleString(lang() === 'en' ? 'en-GB' : 'fr-FR',
        { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    } catch (e) { when = esc(c.date || ''); }
    var live = ty.state === 'in';
    var statusTxt = live ? (st.displayClock || ty.detail || '') : (ty.detail || ty.description || '');
    var phase = c.altGameNote || (d.header && d.header.season && d.header.season.type && d.header.season.type.name) || '';
    return '<div class="msh-head">'
      + '<div class="msh-phase">' + esc(phase) + (phase && when ? ' · ' : '') + esc(when) + '</div>'
      + '<div class="msh-scoreline">' + teamBlock(home, 'h')
      + '<div class="msh-score-wrap"><div class="msh-score">' + score + '</div>' + so
      + '<div class="msh-status' + (live ? ' is-live' : '') + '">' + (live ? '🔴 ' : '') + esc(statusTxt) + '</div></div>'
      + teamBlock(away, 'a') + '</div></div>';
  }

  function infoHtml(d) {
    var gi = d.gameInfo || {}, chips = [];
    var v = gi.venue || {};
    if (v.fullName) {
      var city = (v.address && (v.address.city || '')) + (v.address && v.address.country ? ', ' + v.address.country : '');
      chips.push(['🏟', T('venue'), esc(v.fullName) + (city ? ' · ' + esc(city) : '')]);
    }
    if (gi.attendance) chips.push(['👥', T('attendance'), Number(gi.attendance).toLocaleString(lang() === 'en' ? 'en-GB' : 'fr-FR') + ' ' + T('spectators')]);
    var offs = gi.officials || [];
    if (offs.length) {
      chips.push(['🧑‍⚖️', offs.length > 1 ? T('referees') : T('referee'),
        offs.map(function (o) { return esc(o.displayName || o.fullName) + (o.position && o.position.displayName ? ' (' + esc(o.position.displayName) + ')' : ''); }).join(' · ')]);
    }
    var b = (d.broadcasts || []).map(function (x) { return (x.media && x.media.shortName) || (x.names || []).join(', '); }).filter(Boolean);
    if (b.length) chips.push(['📺', T('tv'), esc([].concat.apply([], b).join(' · '))]);
    if (!chips.length) return '';
    return '<div class="msh-info">' + chips.map(function (ch) {
      return '<div class="msh-chip"><span class="msh-chip-ico">' + ch[0] + '</span><span class="msh-chip-k">' + esc(ch[1]) + '</span><span class="msh-chip-v">' + ch[2] + '</span></div>';
    }).join('') + '</div>';
  }

  function timelineHtml(d) {
    var c = comp(d), evs = (d.keyEvents || []).slice();
    if (!evs.length) return '';
    var cs = (c && c.competitors) || [];
    var home = cs.filter(function (x) { return x.homeAway === 'home'; })[0] || cs[0];
    var homeId = home && home.team && String(home.team.id);
    var seen = {};
    var rows = evs.map(function (ev) {
      var k = kindOf(ev);
      // ESPN duplique les événements neutres (un par équipe) : on garde le 1er
      if (!SIDED[k]) {
        var key = k + '|' + ((ev.clock && ev.clock.displayValue) || '') + '|' + ((ev.period && ev.period.number) || '');
        if (seen[key]) return '';
        seen[key] = 1;
      }
      var who = people(ev);
      var teamId = ev.team && String(ev.team.id);
      var side = SIDED[k] ? (teamId && teamId === homeId ? 'h' : 'a') : 'c';
      var label = T(KIND_LABEL[k] || 'ev_goal');
      var txt;
      if (k === 'sub') txt = '<b>' + esc(who[0] || '') + '</b>' + (who[1] ? ' ← ' + esc(who[1]) : '');
      else if (who.length) txt = '<b>' + esc(who[0] || '') + '</b>' + (who[1] && (k === 'goal' || k === 'pen') ? ' <span class="msh-assist">(' + T('assist') + ' : ' + esc(who[1]) + ')</span>' : '');
      else txt = esc(ev.text || '');
      var min = (ev.clock && ev.clock.displayValue) || '';
      return '<div class="msh-ev side-' + side + ' k-' + k + '">'
        + '<span class="msh-ev-min">' + esc(min) + '</span>'
        + '<span class="msh-ev-ico" title="' + esc(label) + '">' + (ICON[k] || '•') + '</span>'
        + '<span class="msh-ev-txt"><span class="msh-ev-kind">' + esc(label) + '</span>' + txt + '</span></div>';
    }).join('');
    return section(T('timeline'), '<div class="msh-timeline">' + rows + '</div>');
  }

  function statsHtml(d) {
    var teams = (d.boxscore && d.boxscore.teams) || [];
    if (teams.length < 2) return '';
    var byName = {};
    teams.forEach(function (t) { (t.statistics || []).forEach(function (s) { (byName[s.name] = byName[s.name] || [])[t.homeAway === 'away' ? 1 : 0] = s; }); });
    var names = STAT_ORDER.filter(function (n) { return byName[n]; })
      .concat(Object.keys(byName).filter(function (n) { return STAT_ORDER.indexOf(n) === -1 && n !== 'appearances'; }));
    var rows = names.map(function (n) {
      var a = byName[n][0], b = byName[n][1];
      if (!a || !b) return '';
      var va = parseFloat(a.displayValue), vb = parseFloat(b.displayValue);
      // ESPN renvoie certains pourcentages en ratio (0.6) : on les affiche en %
      if (RATIO_PCT[n] && !isNaN(va) && !isNaN(vb) && va <= 1 && vb <= 1) {
        a = { name: a.name, displayName: a.displayName, displayValue: Math.round(va * 100) + '' };
        b = { name: b.name, displayName: b.displayName, displayValue: Math.round(vb * 100) + '' };
        va = va * 100; vb = vb * 100;
      }
      var pa = 50;
      if (!isNaN(va) && !isNaN(vb) && (va + vb) > 0) pa = Math.round((va / (va + vb)) * 100);
      return '<div class="msh-stat"><span class="msh-sv h">' + esc(a.displayValue) + '</span>'
        + '<span class="msh-sk">' + esc(statLabel(a)) + '</span>'
        + '<span class="msh-sv a">' + esc(b.displayValue) + '</span>'
        + '<span class="msh-bar"><i style="width:' + pa + '%"></i></span></div>';
    }).join('');
    return rows ? section(T('stats'), '<div class="msh-stats">' + rows + '</div>') : '';
  }

  // buts / cartons rattachés à chaque joueur (via les événements clés)
  function playerMarks(d) {
    var m = {};
    (d.keyEvents || []).forEach(function (ev) {
      var k = kindOf(ev), who = people(ev);
      if (!who.length) return;
      var add = function (n, s) { if (!n) return; m[n] = (m[n] || '') + s; };
      if (k === 'goal' || k === 'pen') add(who[0], '⚽');
      else if (k === 'own') add(who[0], '🥅');
      else if (k === 'penmiss') add(who[0], '❌');
      else if (k === 'yellow') add(who[0], '🟨');
      else if (k === 'red') add(who[0], '🟥');
    });
    return m;
  }

  function lineupsHtml(d) {
    var rs = d.rosters || [];
    if (!rs.length) return '';
    var marks = playerMarks(d);
    var cols = rs.map(function (r) {
      var list = (r.roster || []).slice().sort(function (x, y) { return (parseInt(x.formationPlace, 10) || 99) - (parseInt(y.formationPlace, 10) || 99); });
      var line = function (p) {
        var nm = (p.athlete && p.athlete.displayName) || '';
        var pos = (p.position && (p.position.abbreviation || p.position.name)) || '';
        var arrows = (p.subbedOut ? '<span class="msh-out">↓</span>' : '') + (p.subbedIn ? '<span class="msh-in">↑</span>' : '');
        return '<div class="msh-pl"><span class="msh-num">' + esc(p.jersey || '') + '</span>'
          + '<span class="msh-pn">' + esc(nm) + '</span>'
          + '<span class="msh-marks">' + (marks[nm] || '') + arrows + '</span>'
          + '<span class="msh-pos" title="' + esc(posLabel(p.position && p.position.name)) + '">' + esc(pos) + '</span></div>';
      };
      var starters = list.filter(function (p) { return p.starter; }).map(line).join('');
      var bench = list.filter(function (p) { return !p.starter; }).map(line).join('');
      var dn = (r.team && (r.team.displayName || r.team.name)) || '';
      return '<div class="msh-lu">'
        + '<div class="msh-lu-head">' + esc(frOf(dn)) + (r.formation ? ' <span class="msh-form">' + esc(r.formation) + '</span>' : '') + '</div>'
        + '<div class="msh-lu-sub">' + T('starters') + '</div>' + starters
        + (bench ? '<div class="msh-lu-sub">' + T('bench') + '</div>' + bench : '')
        + '</div>';
    }).join('');
    return section(T('lineups'), '<div class="msh-lineups">' + cols + '</div>');
  }

  function commentaryHtml(d) {
    var cm = (d.commentary || []).slice();
    if (!cm.length) return '';
    cm.reverse();                                   // du plus récent au plus ancien
    var rows = cm.map(function (c) {
      var min = (c.time && c.time.displayValue) || '';
      return '<div class="msh-cm"><span class="msh-cm-min">' + esc(min) + '</span><span>' + esc(c.text || '') + '</span></div>';
    }).join('');
    return '<details class="msh-sec msh-details"><summary>' + esc(T('commentary')) + ' <span class="msh-count">' + cm.length + '</span></summary>'
      + '<div class="msh-commentary">' + rows + '</div></details>';
  }

  function recapHtml(d) {
    var a = d.article || {};
    var head = a.headline || '', body = a.description || '';
    if (!head && !body) return '';
    return section(T('recap'), '<div class="msh-recap">' + (head ? '<b>' + esc(head) + '</b><br>' : '') + esc(body) + '</div>');
  }

  function linkHtml(d) {
    var links = (d.header && d.header.links) || [];
    var l = links.filter(function (x) { return (x.rel || []).indexOf('summary') !== -1 || (x.rel || []).indexOf('gamecast') !== -1; })[0] || links[0];
    return l && l.href ? '<a class="msh-espn" href="' + esc(l.href) + '" target="_blank" rel="noopener">' + esc(T('espn')) + ' ↗</a>' : '';
  }

  function section(title, inner) {
    return '<div class="msh-sec"><div class="msh-sec-title">' + esc(title) + '</div>' + inner + '</div>';
  }

  function body(d) {
    var parts = headerHtml(d) + infoHtml(d) + timelineHtml(d) + statsHtml(d) + lineupsHtml(d) + commentaryHtml(d) + recapHtml(d) + linkHtml(d);
    // un match à venir n'a ni fil ni stats : on l'annonce au lieu d'une fiche vide
    if (!d.keyEvents || !d.keyEvents.length) {
      if (!(d.boxscore && d.boxscore.teams && d.boxscore.teams.length) && !(d.rosters || []).length) {
        parts = headerHtml(d) + infoHtml(d) + '<div class="msh-empty">' + esc(T('none')) + '</div>' + linkHtml(d);
      }
    }
    return parts;
  }

  /* ---------------- Coquille (modale) ---------------- */
  function ensureHost() {
    if (_host) return _host;
    injectCSS();
    _host = document.createElement('div');
    _host.className = 'msh-backdrop';
    _host.innerHTML = '<div class="msh-modal" role="dialog" aria-modal="true"><button class="msh-close" type="button" aria-label="'
      + esc(T('close')) + '">✕</button><div class="msh-body"></div></div>';
    _host.addEventListener('click', function (e) { if (e.target === _host || e.target.closest('.msh-close')) close(); });
    document.body.appendChild(_host);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _host && _host.classList.contains('open')) close(); });
    return _host;
  }

  function setBody(html) {
    var b = _host && _host.querySelector('.msh-body');
    if (b) b.innerHTML = html;
  }

  function open(eventId, opts) {
    if (!eventId) return;
    ensureHost();
    _open = { id: String(eventId), opts: opts || {} };
    _host.classList.add('open');
    document.body.classList.add('msh-lock');
    setBody('<div class="msh-loading">' + esc(T('loading')) + '</div>');
    if (_busy) return;
    _busy = true;
    fetchSummary(eventId, opts)
      .then(function (d) { if (_open && _open.id === String(eventId)) setBody(body(d)); })
      .catch(function () { if (_open && _open.id === String(eventId)) setBody('<div class="msh-empty">' + esc(T('error')) + '</div>'); })
      .then(function () { _busy = false; });
  }

  function close() {
    _open = null;
    if (_host) _host.classList.remove('open');
    document.body.classList.remove('msh-lock');
  }

  // langue changée pendant que la fiche est ouverte → on la re-rend
  window.addEventListener('langchange', function () {
    if (!_open) return;
    var o = _open;
    fetchSummary(o.id, o.opts).then(function (d) { if (_open && _open.id === o.id) setBody(body(d)); }).catch(function () {});
  });

  /* ---------------- CSS ---------------- */
  function injectCSS() {
    if (document.getElementById('msh-style')) return;
    var s = document.createElement('style');
    s.id = 'msh-style';
    s.textContent = [
      '.msh-backdrop { position: fixed; inset: 0; z-index: 3000; display: none; align-items: flex-start; justify-content: center;',
      '  background: rgba(0,0,0,0.72); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); padding: 24px 14px; overflow-y: auto; }',
      '.msh-backdrop.open { display: flex; }',
      'body.msh-lock { overflow: hidden; }',
      '.msh-modal { position: relative; width: min(880px, 100%); background: #0f1923; border: 1px solid rgba(255,255,255,0.12);',
      '  border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); color: #fff; font-family: var(--font-b, inherit); animation: mshIn 0.22s ease; }',
      '@keyframes mshIn { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }',
      '.msh-close { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; cursor: pointer;',
      '  border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.07); color: #fff; font-size: 0.9em; z-index: 2; }',
      '.msh-close:hover { background: rgba(255,255,255,0.15); }',
      '.msh-body { padding: 20px 22px 24px; }',
      '.msh-loading, .msh-empty { text-align: center; color: var(--muted, #8fa3b5); padding: 40px 10px; font-size: 0.92em; }',
      /* en-tête */
      '.msh-head { text-align: center; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }',
      '.msh-phase { color: var(--gold, #fbc531); font-size: 0.72em; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }',
      '.msh-scoreline { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-top: 12px; }',
      '.msh-team { display: flex; align-items: center; gap: 10px; min-width: 0; }',
      '.msh-team.a { flex-direction: row-reverse; }',
      '.msh-flag { width: 42px; height: 28px; object-fit: cover; border-radius: 3px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); flex-shrink: 0; }',
      '.msh-tname { font-weight: 700; font-size: 1.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.msh-score { font-family: var(--font-d, inherit); font-size: 2.4em; line-height: 1; letter-spacing: 0.04em; }',
      '.msh-sep { color: var(--muted, #8fa3b5); }',
      '.msh-pens { color: var(--gold, #fbc531); font-size: 0.72em; font-weight: 800; margin-top: 4px; }',
      '.msh-status { color: var(--muted, #8fa3b5); font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 6px; }',
      '.msh-status.is-live { color: var(--live, #ff4757); }',
      /* infos */
      '.msh-info { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }',
      '.msh-chip { display: flex; align-items: baseline; gap: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);',
      '  border-radius: 10px; padding: 7px 11px; font-size: 0.8em; }',
      '.msh-chip-k { color: var(--muted, #8fa3b5); font-weight: 700; text-transform: uppercase; font-size: 0.82em; letter-spacing: 0.05em; }',
      '.msh-chip-v { font-weight: 600; }',
      /* sections */
      '.msh-sec { margin-top: 20px; }',
      '.msh-sec-title { font-family: var(--font-d, inherit); font-size: 1.15em; letter-spacing: 0.05em; color: var(--gold, #fbc531); margin-bottom: 10px; }',
      /* fil du match */
      '.msh-timeline { display: flex; flex-direction: column; gap: 2px; }',
      '.msh-ev { display: grid; grid-template-columns: 52px 22px 1fr; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: 8px; font-size: 0.86em; }',
      '.msh-ev:nth-child(odd) { background: rgba(255,255,255,0.03); }',
      '.msh-ev.side-a { direction: rtl; text-align: right; }',
      '.msh-ev.side-a > * { direction: ltr; }',
      '.msh-ev.side-c { opacity: 0.66; font-size: 0.8em; }',
      '.msh-ev-min { color: var(--gold, #fbc531); font-weight: 800; font-variant-numeric: tabular-nums; }',
      '.msh-ev-kind { color: var(--muted, #8fa3b5); margin-right: 7px; font-size: 0.86em; text-transform: uppercase; letter-spacing: 0.04em; }',
      '.msh-ev.side-a .msh-ev-kind { margin: 0 0 0 7px; }',
      '.msh-assist { color: var(--muted, #8fa3b5); }',
      '.msh-ev.k-goal, .msh-ev.k-pen, .msh-ev.k-own { background: rgba(46,213,115,0.08); }',
      '.msh-ev.k-red { background: rgba(255,71,87,0.08); }',
      /* statistiques */
      '.msh-stats { display: flex; flex-direction: column; gap: 10px; }',
      '.msh-stat { display: grid; grid-template-columns: 54px 1fr 54px; grid-template-areas: "h k a" "b b b"; gap: 4px 8px; align-items: center; font-size: 0.84em; }',
      '.msh-sv { font-weight: 800; font-variant-numeric: tabular-nums; }',
      '.msh-sv.h { grid-area: h; } .msh-sv.a { grid-area: a; text-align: right; }',
      '.msh-sk { grid-area: k; text-align: center; color: var(--muted, #8fa3b5); }',
      '.msh-bar { grid-area: b; height: 5px; border-radius: 3px; background: rgba(255,71,87,0.35); overflow: hidden; display: block; }',
      '.msh-bar i { display: block; height: 100%; background: var(--gold, #fbc531); }',
      /* compositions */
      '.msh-lineups { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }',
      '.msh-lu-head { font-weight: 800; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.12); margin-bottom: 8px; }',
      '.msh-form { color: var(--gold, #fbc531); font-size: 0.82em; font-weight: 700; margin-left: 6px; }',
      '.msh-lu-sub { color: var(--muted, #8fa3b5); font-size: 0.68em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; margin: 10px 0 5px; }',
      '.msh-pl { display: grid; grid-template-columns: 26px 1fr auto auto; gap: 7px; align-items: center; font-size: 0.83em; padding: 3px 0; }',
      '.msh-num { color: var(--muted, #8fa3b5); font-variant-numeric: tabular-nums; text-align: center; }',
      '.msh-pn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.msh-pos { color: var(--muted, #8fa3b5); font-size: 0.82em; }',
      '.msh-out { color: var(--red, #ff4757); font-weight: 900; }',
      '.msh-in { color: var(--green-b, #2ed573); font-weight: 900; }',
      /* commentaire */
      '.msh-details > summary { cursor: pointer; font-family: var(--font-d, inherit); font-size: 1.15em; color: var(--gold, #fbc531); letter-spacing: 0.05em; }',
      '.msh-count { color: var(--muted, #8fa3b5); font-size: 0.7em; }',
      '.msh-commentary { max-height: 320px; overflow-y: auto; margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }',
      '.msh-cm { display: grid; grid-template-columns: 50px 1fr; gap: 8px; font-size: 0.82em; color: #d6e2ee; }',
      '.msh-cm-min { color: var(--gold, #fbc531); font-weight: 800; font-variant-numeric: tabular-nums; }',
      '.msh-recap { font-size: 0.88em; line-height: 1.6; color: #d6e2ee; }',
      '.msh-espn { display: inline-block; margin-top: 18px; color: var(--gold, #fbc531); font-size: 0.8em; font-weight: 700; text-decoration: none; }',
      '.msh-espn:hover { text-decoration: underline; }',
      '@media (max-width: 620px) {',
      '  .msh-body { padding: 16px 14px 20px; } .msh-lineups { grid-template-columns: 1fr; }',
      '  .msh-score { font-size: 1.9em; } .msh-tname { font-size: 0.85em; white-space: normal; }',
      '  .msh-ev { grid-template-columns: 44px 20px 1fr; font-size: 0.8em; }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  window.MatchSheet = { open: open, close: close, fetch: fetchSummary };
})();
