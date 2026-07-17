/* ===================================================================
   LDN-DATA — tirage + classements Ligue des Nations 2026-27 (PARTAGÉ
   entre le dashboard et le tracker, comme team-data.js).
   window.LDN_DATA = {
     GROUPS   : [[ligue, n°, [équipes FR]], … 14 groupes],
     groupOf(fr)      -> { lg, num, teams } | null,
     frName(en)       -> nom FR (via TEAM_FR, sinon le nom ESPN),
     standings(events)-> [{ lg, num, played, rows:[{fr,p,w,d,l,gf,ga,gd,pts}] }]
   }
   Règles phase de ligue : 3/1/0 pts, nuls autorisés (pas de t.a.b.),
   matchs terminés uniquement, tri Pts › différence › BM › alphabétique
   (avant le 1er match : ordre du tirage).
   Charger APRÈS team-data.js.
   =================================================================== */
(function () {
  'use strict';

  // [ligue, n° de groupe, équipes (noms FR — TEAM_ISO fournit les drapeaux)]
  var GROUPS = [
    ['A', 1, ['France', 'Italie', 'Belgique', 'Turquie']],
    ['A', 2, ['Allemagne', 'Pays-Bas', 'Serbie', 'Grèce']],
    ['A', 3, ['Espagne', 'Croatie', 'Angleterre', 'Tchéquie']],
    ['A', 4, ['Portugal', 'Danemark', 'Norvège', 'Pays de Galles']],
    ['B', 1, ['Écosse', 'Suisse', 'Slovénie', 'Macédoine du Nord']],
    ['B', 2, ['Hongrie', 'Ukraine', 'Géorgie', 'Irlande du Nord']],
    ['B', 3, ['Israël', 'Autriche', 'Irlande', 'Kosovo']],
    ['B', 4, ['Pologne', 'Bosnie-Herzégovine', 'Roumanie', 'Suède']],
    ['C', 1, ['Albanie', 'Finlande', 'Biélorussie', 'Saint-Marin']],
    ['C', 2, ['Monténégro', 'Arménie', 'Chypre', 'Lettonie']],
    ['C', 3, ['Kazakhstan', 'Slovaquie', 'Îles Féroé', 'Moldavie']],
    ['C', 4, ['Islande', 'Bulgarie', 'Estonie', 'Luxembourg']],
    ['D', 1, ['Azerbaïdjan', 'Lituanie', 'Liechtenstein']],
    ['D', 2, ['Malte', 'Gibraltar', 'Andorre']]
  ];

  function frName(en) { return (window.TEAM_FR && window.TEAM_FR[en]) || en; }

  function groupOf(fr) {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i][2].indexOf(fr) !== -1) return { lg: GROUPS[i][0], num: GROUPS[i][1], teams: GROUPS[i][2] };
    }
    return null;
  }

  function standings(events) {
    var T = {};
    GROUPS.forEach(function (g) { g[2].forEach(function (t) { T[t] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; }); });
    (events || []).forEach(function (e) {
      var c = e.competitions && e.competitions[0];
      if (!c || !c.status || !c.status.type || c.status.type.state !== 'post') return;
      var cs = c.competitors || [];
      if (cs.length < 2 || !cs[0].team || !cs[1].team) return;
      var frA = frName(cs[0].team.displayName), frB = frName(cs[1].team.displayName);
      var sA = parseInt(cs[0].score, 10), sB = parseInt(cs[1].score, 10);
      if (isNaN(sA) || isNaN(sB) || !(frA in T) || !(frB in T)) return;
      var a = T[frA], b = T[frB];
      a.p++; b.p++; a.gf += sA; a.ga += sB; b.gf += sB; b.ga += sA;
      if (sA > sB) { a.w++; a.pts += 3; b.l++; }
      else if (sA < sB) { b.w++; b.pts += 3; a.l++; }
      else { a.d++; b.d++; a.pts++; b.pts++; }
    });
    return GROUPS.map(function (g) {
      var teams = g[2];
      var played = teams.some(function (t) { return T[t].p > 0; });
      var rows = teams.map(function (t) {
        var s = T[t];
        return { fr: t, p: s.p, w: s.w, d: s.d, l: s.l, gf: s.gf, ga: s.ga, gd: s.gf - s.ga, pts: s.pts };
      });
      if (played) rows.sort(function (x, y) { return y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.fr.localeCompare(y.fr, 'fr'); });
      return { lg: g[0], num: g[1], played: played, rows: rows };
    });
  }

  window.LDN_DATA = { GROUPS: GROUPS, groupOf: groupOf, frName: frName, standings: standings };
})();
