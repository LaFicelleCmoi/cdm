/* ============================================================
   i18n.js — Sélecteur de langue FR/EN partagé (dashboard + CDM + legal)
   - Toggle animé "style React" (pilule + curseur qui glisse)
   - Choix mémorisé dans localStorage (cdm2026_lang) → cohérent partout
   - Traduit le HTML statique via [data-i18n], [data-i18n-html],
     [data-i18n-ph] (placeholder), [data-i18n-title]
   - Expose window.t(key), window.getLang(), window.setLang(),
     et émet un évènement 'langchange' pour re-rendre le dynamique.
   ============================================================ */
(function () {
  const LANG_KEY = 'cdm2026_lang';

  const DICT = {
    fr: {
      /* Dashboard */
      nav_simulator: 'Lancer le Tracker →',
      subtitle_dash: 'Statistiques & Calendrier en temps réel',
      live_refresh: 'Rafraîchir',
      flag_loop_label: '⚽ Les 48 nations · clique sur un drapeau',
      groups_overview_title: '🏆 Les 12 groupes',
      live_badge: 'EN DIRECT',
      live_now: 'MAINTENANT',
      cooling_break: 'Pause fraîcheur',
      match_interrupted: 'INTERROMPU',
      live_today: "AUJOURD'HUI",
      live_today_matches: 'MATCHS DU JOUR',
      live_no_match: 'AUCUN MATCH',
      live_matches_word: 'MATCHS',
      updated: 'Mise à jour',
      empty_today: "📅 Aucun match programmé aujourd'hui. Reviens plus tard !",
      net_error: "⚠️ Impossible de joindre l'API ESPN. Vérifie ta connexion.",
      status_in: 'EN COURS', status_pre: 'À VENIR', status_post: 'TERMINÉ',
      eyebrow_featured: "📺 À l'affiche", eyebrow_next: '⏳ Prochain match', eyebrow_done: '✅ Terminé',
      countdown_kickoff: "🟢 C'est parti !",
      venue_default: 'Stade —',
      kickoff_word: "Coup d'envoi",
      more_live_one: 'autre match en direct', more_live_many: 'autres matchs en direct',
      /* Country card */
      group: 'Groupe', wc2026: 'Coupe du Monde 2026',
      opponents_label: 'Adversaires de poule', view_group: 'Voir le groupe',
      results_label: 'Parcours', res_w: 'V', res_d: 'N', res_l: 'D', no_results: 'Aucun match joué',
      scorers_label: 'Buteurs',
      fav_label: 'Ta sélection', fav_group: 'Groupe', fav_next: 'Prochain :', fav_last: 'Dernier :',
      lanyard_comp: 'COUPE DU MONDE 2026', lanyard_role: 'SUPPORTER',
      fav_no_match: 'Pas de match à venir', fav_see: 'Voir ma sélection', fav_change: 'Changer', fav_set: 'Ta sélection :',
      fav_pick_title: '⭐ Choisis ta sélection favorite', fav_pick_sub: 'Tu auras un suivi personnalisé : prochain match, résultats, mise en avant.',
      fav_search_ph: 'Rechercher une équipe…', fav_skip: 'Plus tard',
      phase_groups: 'Poules', phase_r32: '16es de finale', phase_r16: '8es de finale', phase_qf: 'Quart de finale', phase_sf: 'Demi-finale', phase_3p: 'Petite finale', phase_final: '🏆 Finale',
      /* CDM nav / controls */
      nav_back: '← Retour au Dashboard',
      tab_groups: 'PHASE DE GROUPES', tab_planning: 'PLANNING POULES', tab_bracket: 'PHASE FINALE', tab_scorers: 'MEILLEURS BUTEURS',
      scorers_title: 'Meilleurs buteurs', scorers_sub: 'Coupe du Monde · classement de tous les temps', scorers_goals: 'buts',
      scorers_tab_alltime: 'Tous les temps', scorers_tab_live: 'Mondial 2026',
      scorers_live_sub: "Coupe du Monde 2026 · Soulier d'or en direct",
      scorers_loading: 'Chargement des buteurs 2026…', scorers_live_empty: 'Aucun buteur pour le moment.',
      scorers_live_fail: 'Impossible de charger les buteurs en direct.',
      scorers_live_note: "Soulier d'or 2026 · buts du tournoi en cours (source ESPN, en direct).",
      scorers_asof: 'À jour au 26 juin 2026 · Mondial en cours',
      scorers_active: 'Encore en lice — Coupe du Monde 2026',
      scorers_live_badge: 'EN DIRECT', scorers_live_updated: 'Mis à jour en direct à',
      cele_goal: 'BUT !',
      ko_r32: '16es de finale', ko_r16: '8es de finale', ko_qf: 'Quarts de finale', ko_sf: 'Demi-finales', ko_final: 'Finale',
      view_final: 'Voir la phase finale', cc_upcoming: 'à venir', cc_groupphase: 'Phase de groupes', cc_kophase: 'Phase finale',
      status_alive: 'En lice', status_out: 'Éliminé',
      shootout_word: 'Tirs au but', shootout_abbr: 't.a.b.',
      scorers_note: "Palmarès officiel FIFA (hommes). 🐐 Lionel Messi a pris la tête de l'histoire (18 buts) en 2026. Les totaux des joueurs encore en lice (pastille 2026) montent en direct pendant les matchs.",
      search_ph: 'Rechercher une équipe…',
      btn_fetch: '📡 Récupérer les scores', btn_reset: '🗑️ Réinitialiser la simulation',
      group_word: 'GROUPE', group_sub_locked: '🔒 Scores live (API)', poule: 'Poule',
      th_team: 'Équipe', th_mp: 'MJ', th_w: 'G', th_d: 'N', th_l: 'P', th_gf: 'BP', th_ga: 'BC', th_gd: 'DB', th_pts: 'Pts', th_last5: '5 derniers',
      /* Bracket */
      bracket_title: 'Phase Finale',
      bracket_subtitle: '🔒 Scores synchronisés en direct depuis l\'API · 🔴 En cours · ✅ Terminé · le bracket se remplit tout seul',
      view_cards: '🃏 Vue cartes', view_tree: '🌳 Vue arbre',
      round_r16: '16es de finale', round_r8: '8es de finale', round_qf: 'Quarts de finale', round_sf: 'Demi-finales', round_final: 'Finale',
      third_place: '🥉 Match pour la 3e place',
      tree_loading: "⏳ Chargement de l'arbre…", tree_error: "⚠️ Impossible de charger la vue arbre (CDN indisponible).", tree_render_error: "⚠️ Rendu de l'arbre impossible.",
      sync_lock_hint: "🔒 Scores synchronisés automatiquement depuis l'API ESPN.",
      match_live_txt: '🔴 Match en cours', match_done_txt: '✅ Match terminé', match_pre_txt: '⏳ Match à venir',
      /* Modale match */
      modal_state: 'État du match', state_live: 'En cours', state_pending: 'À venir', state_done: 'Terminé',
      team1_ph: 'Équipe 1', team2_ph: 'Équipe 2',
      btn_cancel: 'Annuler', btn_close: 'Fermer', btn_confirm: 'Confirmer ✓',
      /* Modale reset */
      reset_title: 'Tout effacer ?',
      reset_msg: 'Tu vas perdre <b>tous les scores</b>, statuts de matchs et résultats de la phase finale. Cette action est <b>irréversible</b>.',
      reset_confirm: 'Tout effacer',
      /* Footer */
      footer_disclaimer: 'Projet indépendant réalisé par un fan — <strong>non affilié à la FIFA</strong> ni à aucun organisme officiel. « World Cup 2026 » et les marques associées appartiennent à leurs propriétaires. Scores fournis par ESPN (source non officielle), à titre indicatif.',
      footer_legal: 'Mentions légales', footer_privacy: 'Confidentialité', footer_terms: 'CGU', footer_credits: 'Crédits',
      legal_back: "← Retour à l'accueil",
      /* Toasts */
      toast_match_live: 'Match en cours', toast_match_done: 'Match validé', toast_score_saved: 'Score enregistré',
      toast_reset_done: 'Simulation réinitialisée', toast_goal: 'BUT !', champion_suffix: 'est champion du monde !',
      toast_recovered: 'matchs récupérés depuis ESPN', toast_caught_up: 'résultat(s) rattrapé(s)', toast_recover_fail: '⚠️ Récupération impossible (réseau)',
    },
    en: {
      /* Dashboard */
      nav_simulator: 'Launch Tracker →',
      subtitle_dash: 'Live stats & schedule',
      live_refresh: 'Refresh',
      flag_loop_label: '⚽ The 48 nations · click a flag',
      groups_overview_title: '🏆 The 12 groups',
      live_badge: 'LIVE',
      live_now: 'NOW',
      cooling_break: 'Cooling break',
      match_interrupted: 'INTERRUPTED',
      live_today: 'TODAY',
      live_today_matches: "TODAY'S MATCHES",
      live_no_match: 'NO MATCH',
      live_matches_word: 'MATCHES',
      updated: 'Updated',
      empty_today: '📅 No match scheduled today. Check back later!',
      net_error: "⚠️ Can't reach the ESPN API. Check your connection.",
      status_in: 'LIVE', status_pre: 'UPCOMING', status_post: 'FINISHED',
      eyebrow_featured: '📺 Featured', eyebrow_next: '⏳ Next match', eyebrow_done: '✅ Finished',
      countdown_kickoff: '🟢 Kick-off!',
      venue_default: 'Stadium —',
      kickoff_word: 'Kick-off',
      more_live_one: 'other live match', more_live_many: 'other live matches',
      /* Country card */
      group: 'Group', wc2026: 'World Cup 2026',
      opponents_label: 'Group opponents', view_group: 'View group',
      results_label: 'Results', res_w: 'W', res_d: 'D', res_l: 'L', no_results: 'No match played yet',
      scorers_label: 'Scorers',
      fav_label: 'Your team', fav_group: 'Group', fav_next: 'Next:', fav_last: 'Last:',
      lanyard_comp: 'FIFA WORLD CUP 2026', lanyard_role: 'SUPPORTER',
      fav_no_match: 'No upcoming match', fav_see: 'View my team', fav_change: 'Change', fav_set: 'Your team:',
      fav_pick_title: '⭐ Pick your favorite team', fav_pick_sub: "You'll get personalised tracking: next match, results, highlights.",
      fav_search_ph: 'Search a team…', fav_skip: 'Later',
      phase_groups: 'Group stage', phase_r32: 'Round of 32', phase_r16: 'Round of 16', phase_qf: 'Quarter-final', phase_sf: 'Semi-final', phase_3p: 'Third place', phase_final: '🏆 Final',
      /* CDM nav / controls */
      nav_back: '← Back to Dashboard',
      tab_groups: 'GROUP STAGE', tab_planning: 'GROUP SCHEDULE', tab_bracket: 'KNOCKOUT', tab_scorers: 'TOP SCORERS',
      scorers_title: 'Top scorers', scorers_sub: 'World Cup · all-time ranking', scorers_goals: 'goals',
      scorers_tab_alltime: 'All-time', scorers_tab_live: '2026 World Cup',
      scorers_live_sub: '2026 World Cup · live Golden Boot',
      scorers_loading: 'Loading 2026 scorers…', scorers_live_empty: 'No scorers yet.',
      scorers_live_fail: "Couldn't load live scorers.",
      scorers_live_note: '2026 Golden Boot · goals in the ongoing tournament (live, via ESPN).',
      scorers_asof: 'Updated 26 June 2026 · tournament in progress',
      scorers_active: 'Still in the running — World Cup 2026',
      scorers_live_badge: 'LIVE', scorers_live_updated: 'Live · updated at',
      cele_goal: 'GOAL !',
      ko_r32: 'Round of 32', ko_r16: 'Round of 16', ko_qf: 'Quarter-finals', ko_sf: 'Semi-finals', ko_final: 'Final',
      view_final: 'View knockouts', cc_upcoming: 'upcoming', cc_groupphase: 'Group stage', cc_kophase: 'Knockouts',
      status_alive: 'Still in', status_out: 'Eliminated',
      shootout_word: 'Penalty shoot-out', shootout_abbr: 'pens',
      scorers_note: 'Official FIFA record (men). 🐐 Lionel Messi became the all-time top scorer (18 goals) in 2026. Totals of players still in the running (2026 badge) climb live during matches.',
      search_ph: 'Search a team…',
      btn_fetch: '📡 Fetch scores', btn_reset: '🗑️ Reset simulation',
      group_word: 'GROUP', group_sub_locked: '🔒 Live scores (API)', poule: 'Group',
      th_team: 'Team', th_mp: 'MP', th_w: 'W', th_d: 'D', th_l: 'L', th_gf: 'GF', th_ga: 'GA', th_gd: 'GD', th_pts: 'Pts', th_last5: 'Last 5',
      /* Bracket */
      bracket_title: 'Knockout Stage',
      bracket_subtitle: '🔒 Scores synced live from the API · 🔴 Live · ✅ Finished · the bracket fills itself',
      view_cards: '🃏 Card view', view_tree: '🌳 Tree view',
      round_r16: 'Round of 32', round_r8: 'Round of 16', round_qf: 'Quarter-finals', round_sf: 'Semi-finals', round_final: 'Final',
      third_place: '🥉 Third-place match',
      tree_loading: '⏳ Loading bracket…', tree_error: '⚠️ Could not load the tree view (CDN unavailable).', tree_render_error: '⚠️ Could not render the bracket.',
      sync_lock_hint: '🔒 Scores synced automatically from the ESPN API.',
      match_live_txt: '🔴 Match live', match_done_txt: '✅ Match finished', match_pre_txt: '⏳ Match upcoming',
      /* Match modal */
      modal_state: 'Match status', state_live: 'Live', state_pending: 'Upcoming', state_done: 'Finished',
      team1_ph: 'Team 1', team2_ph: 'Team 2',
      btn_cancel: 'Cancel', btn_close: 'Close', btn_confirm: 'Confirm ✓',
      /* Reset modal */
      reset_title: 'Erase everything?',
      reset_msg: 'You will lose <b>all scores</b>, match statuses and knockout results. This action is <b>irreversible</b>.',
      reset_confirm: 'Erase all',
      /* Footer */
      footer_disclaimer: 'Independent fan-made project — <strong>not affiliated with FIFA</strong> or any official body. "World Cup 2026" and related marks belong to their owners. Scores provided by ESPN (unofficial source), for information only.',
      footer_legal: 'Legal notice', footer_privacy: 'Privacy', footer_terms: 'Terms', footer_credits: 'Credits',
      legal_back: '← Back to home',
      /* Toasts */
      toast_match_live: 'Match live', toast_match_done: 'Match confirmed', toast_score_saved: 'Score saved',
      toast_reset_done: 'Simulation reset', toast_goal: 'GOAL!', champion_suffix: 'is world champion!',
      toast_recovered: 'matches fetched from ESPN', toast_caught_up: 'result(s) caught up', toast_recover_fail: '⚠️ Recovery failed (network)',
    }
  };

  function getLang() { try { return localStorage.getItem(LANG_KEY) || 'fr'; } catch (e) { return 'fr'; } }
  function setLang(l) { if (l !== 'fr' && l !== 'en') l = 'fr'; try { localStorage.setItem(LANG_KEY, l); } catch (e) {} apply(l); }
  function t(key, lang) { lang = lang || getLang(); const d = DICT[lang] || DICT.fr; return (key in d) ? d[key] : (DICT.fr[key] != null ? DICT.fr[key] : key); }
  // Renvoie la traduction si la clé existe, sinon undefined (→ on garde le texte HTML d'origine)
  function lookup(key, lang) { lang = lang || getLang(); const d = DICT[lang] || DICT.fr; if (key in d) return d[key]; if (key in DICT.fr) return DICT.fr[key]; return undefined; }

  function apply(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = lookup(el.getAttribute('data-i18n'), lang); if (v !== undefined) el.textContent = v; });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { const v = lookup(el.getAttribute('data-i18n-html'), lang); if (v !== undefined) el.innerHTML = v; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { const v = lookup(el.getAttribute('data-i18n-ph'), lang); if (v !== undefined) el.placeholder = v; });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { const v = lookup(el.getAttribute('data-i18n-title'), lang); if (v !== undefined) el.title = v; });
    const tg = document.getElementById('lang-toggle');
    if (tg) { tg.dataset.lang = lang; tg.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang)); }
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function injectStyle() {
    if (document.getElementById('lang-toggle-style')) return;
    const s = document.createElement('style');
    s.id = 'lang-toggle-style';
    s.textContent = `
      .lang-toggle { position: fixed; z-index: 60; display: inline-flex; align-items: center; padding: 4px;
        background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.12); border-radius: 30px;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
      .lang-toggle .lang-opt { position: relative; z-index: 1; border: none; background: transparent;
        color: var(--muted, #8a9bb0); font-family: inherit; font-weight: 800; font-size: 0.72em; letter-spacing: 0.06em;
        padding: 6px 15px; border-radius: 24px; cursor: pointer; transition: color 0.3s; }
      .lang-toggle .lang-opt.active { color: #000; }
      .lang-toggle .lang-slider { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px);
        background: var(--gold, #fbc531); border-radius: 24px; z-index: 0; box-shadow: 0 0 16px rgba(251,197,49,0.4);
        transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); }
      .lang-toggle[data-lang="en"] .lang-slider { transform: translateX(100%); }
    `;
    document.head.appendChild(s);
  }

  function buildToggle() {
    const tg = document.getElementById('lang-toggle');
    if (!tg) return;
    tg.classList.add('lang-toggle');
    tg.innerHTML = '<span class="lang-slider"></span>' +
      '<button class="lang-opt" data-lang="fr" type="button">FR</button>' +
      '<button class="lang-opt" data-lang="en" type="button">EN</button>';
    tg.addEventListener('click', (e) => { const b = e.target.closest('.lang-opt'); if (b) setLang(b.dataset.lang); });
  }

  // Permet à une page d'enregistrer son propre dictionnaire (ex. page légale)
  function extend(extra) {
    if (extra && extra.fr) Object.assign(DICT.fr, extra.fr);
    if (extra && extra.en) Object.assign(DICT.en, extra.en);
    apply(getLang());
  }

  window.t = t; window.getLang = getLang; window.setLang = setLang; window.applyLang = apply; window.i18nExtend = extend;

  function init() { injectStyle(); buildToggle(); apply(getLang()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
