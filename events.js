/* ============================================================
   events.js — Événements détaillés d'un match (ESPN summary)
   Buteurs, passeurs, penalty, CSC, cartons jaunes/rouges.
   Partagé par dashboard.html (carte pays) et CDM.html (widget live).
   Expose window.MatchEvents.
   ============================================================ */
(function () {
  const EP = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=';
  const cache = {}; // eventId -> { ts, list }
  // Timeout sûr pour fetch (évite les requêtes qui pendent indéfiniment quand ESPN rame)
  const tmo = (ms) => { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } };

  function kindOf(t) {
    if (!t) return 'other';
    if (t === 'Own Goal') return 'owngoal';
    if (/penalty/i.test(t) && /miss|saved|fail/i.test(t)) return 'penmiss';
    if (/penalty/i.test(t) && /scor/i.test(t)) return 'pen';
    if (/free.?kick/i.test(t)) return 'freekick';
    if (/^goal/i.test(t)) return 'goal';
    if (/red/i.test(t)) return 'red';
    if (/yellow/i.test(t)) return 'yellow';
    if (/substitution/i.test(t)) return 'sub';
    return 'other';
  }

  function normalize(keyEvents) {
    return (keyEvents || []).map(k => {
      const t = (k.type && k.type.text) || '';
      const desc = k.text || '';
      const parts = (k.participants || [])
        .map(p => (p && p.athlete && p.athlete.displayName) || '')
        .filter(Boolean);
      let kind = kindOf(t);
      // Pause fraîcheur (drinks/cooling break) = "Start Delay" avec ce motif ; fin = "End Delay"
      if (/start delay/i.test(t) && /drink|cool|water|hydrat/i.test(desc)) kind = 'cooling';
      else if (/end delay/i.test(t)) kind = 'enddelay';
      return {
        kind,
        typeText: t,
        clock: (k.clock && k.clock.displayValue) || '',
        team: (k.team && k.team.displayName) || '',
        player: parts[0] || '',
        assist: parts[1] || '',
        scoring: !!k.scoringPlay,
      };
    });
  }

  // Une pause fraîcheur est-elle en cours ? (dernier "cooling" non suivi d'un "enddelay")
  function coolingActive(list) {
    let lastC = -1, lastE = -1;
    (list || []).forEach((e, i) => { if (e.kind === 'cooling') lastC = i; else if (e.kind === 'enddelay') lastE = i; });
    return lastC > lastE;
  }

  async function fetchEvents(eventId, maxAgeMs = 25000) {
    if (!eventId) return [];
    const c = cache[eventId];
    if (c && (Date.now() - c.ts) < maxAgeMs) return c.list;
    try {
      const res = await fetch(EP + eventId, { cache: 'no-store', signal: tmo(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const list = normalize(data.keyEvents);
      cache[eventId] = { ts: Date.now(), list };
      return list;
    } catch (e) { return (c && c.list) || []; }
  }

  const EMOJI = { goal: '⚽', pen: '⚽', freekick: '⚽', owngoal: '⚽', penmiss: '❌', red: '🟥', yellow: '🟨', sub: '🔁', other: '•' };
  const NOTABLE = ['goal', 'pen', 'freekick', 'owngoal', 'penmiss', 'red', 'yellow'];
  const GOALISH = ['goal', 'pen', 'freekick', 'owngoal'];
  const TAG = { pen: 'pen', freekick: 'cf', owngoal: 'csc', penmiss: 'pen ✗' };

  // Nom de famille seul (compact) : "Raúl Jiménez" → "Jiménez"
  function lastName(full) {
    if (!full) return '';
    const p = full.trim().split(/\s+/);
    return p.length > 1 ? p.slice(1).join(' ') : full;
  }

  window.MatchEvents = {
    fetch: fetchEvents,
    normalize,
    emoji: (e) => EMOJI[e.kind] || '•',
    lastName,
    notable: (list) => (list || []).filter(e => NOTABLE.includes(e.kind)),
    goals: (list) => (list || []).filter(e => GOALISH.includes(e.kind)),
    isGoal: (e) => GOALISH.includes(e.kind),
    tag: (e) => TAG[e && e.kind] || '',
    coolingActive,
  };
})();
