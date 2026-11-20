/*
 * Turnierplaner – Turnierlogik (ohne DOM)
 * Format: 16 Teams, 4 Gruppen à 4, zwei Gruppenphasen, danach Finalrunde
 * mit Platzierungsspielen für alle Plätze 1–16.
 *
 * Wichtig: Punkte, Tore und Tordifferenz gelten immer nur innerhalb
 * der jeweiligen Gruppenphase.
 */
(function (root) {
  'use strict';

  var GROUP_COUNT = 4;
  var TEAMS_PER_GROUP = 4;
  var TEAM_COUNT = GROUP_COUNT * TEAMS_PER_GROUP;

  // Spielpaarungen innerhalb einer Gruppe (Positionen 0–3), wie im Excel:
  // Runde 1: 4–1, 2–3 · Runde 2: 1–3, 4–2 · Runde 3: 1–2, 3–4
  var ROUND_ROBIN = [
    [[3, 0], [1, 2]],
    [[0, 2], [3, 1]],
    [[0, 1], [2, 3]]
  ];

  // Finalrunde. seed: [Gruppe, Platz] aus Gruppenphase 2 (0-basiert),
  // w/l: Sieger/Verlierer eines vorherigen Spiels.
  var KO_ROUNDS = [
    { key: 'vf', name: 'Viertelfinale & Spiele um Platz 9–16 (Qualifikation)' },
    { key: 'hf', name: 'Halbfinale, kleines Halbfinale & Platzierungsspiele 9–16' },
    { key: 'f', name: 'Finale & Spiele um Platz 3–8' }
  ];

  var KO_GAMES = [
    { id: 'ko1', round: 'vf', label: 'Viertelfinale 1', home: { seed: [0, 0] }, away: { seed: [2, 1] } },
    { id: 'ko2', round: 'vf', label: 'Viertelfinale 2', home: { seed: [2, 0] }, away: { seed: [0, 1] } },
    { id: 'ko3', round: 'vf', label: 'Viertelfinale 3', home: { seed: [1, 0] }, away: { seed: [3, 1] } },
    { id: 'ko4', round: 'vf', label: 'Viertelfinale 4', home: { seed: [3, 0] }, away: { seed: [1, 1] } },
    { id: 'ko5', round: 'q', label: 'Qualifikation Platz 9–12 (A)', home: { seed: [0, 2] }, away: { seed: [2, 2] } },
    { id: 'ko6', round: 'q', label: 'Qualifikation Platz 9–12 (B)', home: { seed: [1, 2] }, away: { seed: [3, 2] } },
    { id: 'ko7', round: 'q', label: 'Qualifikation Platz 13–16 (A)', home: { seed: [0, 3] }, away: { seed: [2, 3] } },
    { id: 'ko8', round: 'q', label: 'Qualifikation Platz 13–16 (B)', home: { seed: [1, 3] }, away: { seed: [3, 3] } },
    { id: 'ko9', round: 'hf', label: 'Halbfinale 1', home: { w: 'ko1' }, away: { w: 'ko3' } },
    { id: 'ko10', round: 'hf', label: 'Halbfinale 2', home: { w: 'ko2' }, away: { w: 'ko4' } },
    { id: 'ko11', round: 'hf', label: 'Kleines Halbfinale 1 (Platz 5–8)', home: { l: 'ko1' }, away: { l: 'ko3' } },
    { id: 'ko12', round: 'hf', label: 'Kleines Halbfinale 2 (Platz 5–8)', home: { l: 'ko2' }, away: { l: 'ko4' } },
    { id: 'ko13', round: 'pl', label: 'Spiel um Platz 9', home: { w: 'ko5' }, away: { w: 'ko6' }, places: [9, 10] },
    { id: 'ko14', round: 'pl', label: 'Spiel um Platz 11', home: { l: 'ko5' }, away: { l: 'ko6' }, places: [11, 12] },
    { id: 'ko15', round: 'pl', label: 'Spiel um Platz 13', home: { w: 'ko7' }, away: { w: 'ko8' }, places: [13, 14] },
    { id: 'ko16', round: 'pl', label: 'Spiel um Platz 15', home: { l: 'ko7' }, away: { l: 'ko8' }, places: [15, 16] },
    { id: 'ko17', round: 'f', label: 'Finale', home: { w: 'ko9' }, away: { w: 'ko10' }, places: [1, 2] },
    { id: 'ko18', round: 'f', label: 'Kleines Finale (Platz 3)', home: { l: 'ko9' }, away: { l: 'ko10' }, places: [3, 4] },
    { id: 'ko19', round: 'f', label: 'Spiel um Platz 5', home: { w: 'ko11' }, away: { w: 'ko12' }, places: [5, 6] },
    { id: 'ko20', round: 'f', label: 'Spiel um Platz 7', home: { l: 'ko11' }, away: { l: 'ko12' }, places: [7, 8] }
  ];

  var TIME_SLOTS = [
    { key: 'p1', label: 'Beginn Gruppenphase 1' },
    { key: 'p2', label: 'Beginn Gruppenphase 2' },
    { key: 'vf', label: 'Viertelfinale' },
    { key: 'q', label: 'Qualifikation Platz 9–16' },
    { key: 'hf', label: 'Halbfinale / kleines Halbfinale' },
    { key: 'pl', label: 'Platzierungsspiele 9–16' },
    { key: 'f', label: 'Finale / Spiele um Platz 3–8' },
    { key: 'ceremony', label: 'Siegerehrung' }
  ];

  var DEFAULT_INFO = [
    { label: 'Spieler', value: '5 Feldspieler + TW / ca. 10 Spieler + TW' },
    { label: 'Spieleröffnung', value: 'Anstoß Mittellinie (erstgenanntes Team)' },
    { label: 'Anstoß', value: 'Anstoß Mittellinie (immer indirekt)' },
    { label: 'Abstoß', value: 'Eindribbeln oder Einkicken' },
    { label: 'Seitenaus', value: 'Einkicken (immer indirekt / KEIN Einwurf / KEIN Eindribbeln)' },
    { label: 'Ecke', value: 'Einkicken (immer indirekt / KEIN Eindribbeln)' },
    { label: 'Freistoß', value: 'Einkicken (Foulspiel – direkt / Handspiel – immer indirekt [KEIN Eindribbeln])' },
    { label: 'Unentschieden in der Finalrunde', value: 'Neunmeterschießen' }
  ];

  var TIEBREAK_TEXT = 'Punkte – Tordifferenz – mehr erzielte Tore – direkter Vergleich – Los';

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultConfig() {
    return {
      fields: 4,
      gameMinutes: 12,
      slotMinutes: 17,
      times: { p1: '09:00', p2: '11:00', vf: '13:15', q: '13:30', hf: '13:50', pl: '14:05', f: '14:30', ceremony: '14:50' }
    };
  }

  function createTournament(opts) {
    opts = opts || {};
    var teams = [];
    var lots = {};
    for (var i = 0; i < TEAM_COUNT; i++) {
      var id = 't' + (i + 1);
      var name = (opts.teamNames && opts.teamNames[i]) || ('Team ' + (i + 1));
      teams.push({ id: id, name: name });
      lots[id] = Math.random();
    }
    var groups1 = [];
    for (var g = 0; g < GROUP_COUNT; g++) {
      groups1.push(teams.slice(g * TEAMS_PER_GROUP, (g + 1) * TEAMS_PER_GROUP).map(function (t) { return t.id; }));
    }
    return {
      version: 1,
      format: 'andi',
      id: uid(),
      name: opts.name || 'Neues Turnier',
      date: opts.date || '',
      venue: opts.venue || '',
      ageGroup: opts.ageGroup || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: defaultConfig(),
      teams: teams,
      lots: lots,
      groups1: groups1,
      groups2: null,   // wird beim Abschluss von Phase 1 festgelegt
      koSeeds: null,   // wird beim Abschluss von Phase 2 festgelegt
      results: {},
      info: DEFAULT_INFO.map(function (r) { return { label: r.label, value: r.value }; })
    };
  }

  /* ---------- Zeit ---------- */

  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function addMinutes(hhmm, minutes) {
    var base = toMinutes(hhmm);
    if (base === null) return '';
    var total = ((base + minutes) % 1440 + 1440) % 1440;
    var h = Math.floor(total / 60), m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function fieldsOf(t) {
    var f = parseInt(t.config.fields, 10);
    return f > 0 ? f : 4;
  }

  /* ---------- Hilfen ---------- */

  function teamName(t, id) {
    if (!id) return '';
    for (var i = 0; i < t.teams.length; i++) if (t.teams[i].id === id) return t.teams[i].name;
    return '?';
  }

  function getResult(t, gameId) {
    return t.results[gameId] || null;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0;
  }

  function isPlayed(r) {
    return !!r && isNum(r.h) && isNum(r.a);
  }

  /* ---------- Gruppenphasen ---------- */

  function groupsOf(t, phase) {
    return phase === 1 ? t.groups1 : t.groups2;
  }

  // Liefert die 24 Spiele einer Gruppenphase in Excel-Reihenfolge,
  // verteilt auf Zeitslots à <Spielfelder> Spiele.
  function phaseGames(t, phase) {
    var groups = groupsOf(t, phase);
    var ordered = [];
    for (var r = 0; r < ROUND_ROBIN.length; r++) {
      for (var pair = 0; pair < GROUP_COUNT; pair += 2) {
        for (var g = pair; g < pair + 2; g++) {
          for (var m = 0; m < ROUND_ROBIN[r].length; m++) {
            var p = ROUND_ROBIN[r][m];
            ordered.push({
              id: 'p' + phase + '-g' + g + '-r' + r + '-m' + m,
              phase: phase,
              group: g,
              round: r,
              home: groups ? groups[g][p[0]] : null,
              away: groups ? groups[g][p[1]] : null,
              homeLabel: groups ? null : 'Gruppe ' + (g + 1) + ' · Pos. ' + (p[0] + 1),
              awayLabel: groups ? null : 'Gruppe ' + (g + 1) + ' · Pos. ' + (p[1] + 1)
            });
          }
        }
      }
    }
    var fields = fieldsOf(t);
    var start = t.config.times['p' + phase];
    var slotMin = parseInt(t.config.slotMinutes, 10) || 17;
    ordered.forEach(function (game, i) {
      game.no = i + 1;
      game.slot = Math.floor(i / fields);
      game.field = (i % fields) + 1;
      game.time = addMinutes(start, game.slot * slotMin);
    });
    return ordered;
  }

  function emptyRow(teamId, pos) {
    return { team: teamId, pos: pos, sp: 0, s: 0, u: 0, n: 0, gf: 0, ga: 0, td: 0, pts: 0, note: '' };
  }

  function addGame(row, gf, ga) {
    row.sp++;
    row.gf += gf;
    row.ga += ga;
    row.td = row.gf - row.ga;
    if (gf > ga) { row.s++; row.pts += 3; }
    else if (gf === ga) { row.u++; row.pts += 1; }
    else { row.n++; }
  }

  function cmpBase(a, b) {
    return (b.pts - a.pts) || (b.td - a.td) || (b.gf - a.gf);
  }

  // Tabelle einer Gruppe – nur Spiele dieser Phase und Gruppe.
  function standings(t, phase, g) {
    var groups = groupsOf(t, phase);
    if (!groups) return null;
    var games = phaseGames(t, phase).filter(function (x) { return x.group === g; });
    return tableFromGames(t, groups[g], games);
  }

  // Allgemeine Tabelle: ids = Teams, games = Spiele mit id/home/away
  function tableFromGames(t, ids, games) {
    var rows = {};
    ids.forEach(function (id, i) { rows[id] = emptyRow(id, i); });
    var played = [];
    games.forEach(function (game) {
      var r = getResult(t, game.id);
      if (!isPlayed(r) || !rows[game.home] || !rows[game.away]) return;
      played.push({ home: game.home, away: game.away, h: r.h, a: r.a });
      addGame(rows[game.home], r.h, r.a);
      addGame(rows[game.away], r.a, r.h);
    });
    var list = ids.map(function (id) { return rows[id]; });
    if (played.length === 0) return list; // noch nichts gespielt: Reihenfolge der Auslosung

    list.sort(function (a, b) { return cmpBase(a, b) || (a.pos - b.pos); });

    // Gleichstände über direkten Vergleich, dann Los auflösen
    var out = [];
    var i = 0;
    while (i < list.length) {
      var j = i + 1;
      while (j < list.length && cmpBase(list[i], list[j]) === 0) j++;
      var cluster = list.slice(i, j);
      if (cluster.length > 1) out = out.concat(resolveTie(t, cluster, played));
      else out.push(cluster[0]);
      i = j;
    }
    return out;
  }

  function resolveTie(t, cluster, played) {
    var members = {};
    var mini = {};
    cluster.forEach(function (r) { members[r.team] = true; mini[r.team] = emptyRow(r.team, r.pos); });
    played.forEach(function (p) {
      if (members[p.home] && members[p.away]) {
        addGame(mini[p.home], p.h, p.a);
        addGame(mini[p.away], p.a, p.h);
      }
    });
    var sorted = cluster.slice().sort(function (a, b) {
      return cmpBase(mini[a.team], mini[b.team]) || (t.lots[a.team] - t.lots[b.team]);
    });
    for (var k = 0; k < sorted.length; k++) {
      var prev = sorted[k - 1], next = sorted[k + 1];
      var tiedPrev = prev && cmpBase(mini[prev.team], mini[sorted[k].team]) === 0;
      var tiedNext = next && cmpBase(mini[next.team], mini[sorted[k].team]) === 0;
      sorted[k].note = (tiedPrev || tiedNext) ? 'Los' : 'direkter Vergleich';
    }
    return sorted;
  }

  function phaseProgress(t, phase) {
    var games = groupsOf(t, phase) ? phaseGames(t, phase) : [];
    var done = games.filter(function (g) { return isPlayed(getResult(t, g.id)); }).length;
    return { done: done, total: games.length || 24 };
  }

  function isPhaseComplete(t, phase) {
    if (!groupsOf(t, phase)) return false;
    var p = phaseProgress(t, phase);
    return p.done === p.total;
  }

  // Neue Gruppe g erhält: Platz i aus alter Gruppe (g + i) mod 4.
  // => jede neue Gruppe hat einen 1., 2., 3. und 4. und keine Wiederholungsspiele.
  function computeGroups2(t) {
    var tables = [];
    for (var g = 0; g < GROUP_COUNT; g++) tables.push(standings(t, 1, g));
    var out = [];
    for (var ng = 0; ng < GROUP_COUNT; ng++) {
      var grp = [];
      for (var rank = 0; rank < TEAMS_PER_GROUP; rank++) {
        grp.push(tables[(ng + rank) % GROUP_COUNT][rank].team);
      }
      out.push(grp);
    }
    return out;
  }

  function computeKoSeeds(t) {
    var seeds = [];
    for (var g = 0; g < GROUP_COUNT; g++) {
      seeds.push(standings(t, 2, g).map(function (r) { return r.team; }));
    }
    return seeds;
  }

  function hasResultsWithPrefix(t, prefix) {
    return Object.keys(t.results).some(function (k) {
      return k.indexOf(prefix) === 0 && isPlayed(t.results[k]);
    });
  }

  /* ---------- Finalrunde ---------- */

  function koDef(id) {
    for (var i = 0; i < KO_GAMES.length; i++) if (KO_GAMES[i].id === id) return KO_GAMES[i];
    return null;
  }

  function koOutcome(t, id) {
    var def = koDef(id);
    var home = koSide(t, def.home), away = koSide(t, def.away);
    var r = getResult(t, id);
    if (!home || !away || !isPlayed(r)) return null;
    var homeWins;
    if (r.h > r.a) homeWins = true;
    else if (r.a > r.h) homeWins = false;
    else if (r.pen === 'h') homeWins = true;
    else if (r.pen === 'a') homeWins = false;
    else return null; // Unentschieden ohne Neunmeter-Sieger
    return homeWins ? { winner: home, loser: away } : { winner: away, loser: home };
  }

  function koSide(t, ref) {
    if (ref.seed) return t.koSeeds ? t.koSeeds[ref.seed[0]][ref.seed[1]] : null;
    var o = koOutcome(t, ref.w || ref.l);
    if (!o) return null;
    return ref.w ? o.winner : o.loser;
  }

  function koSideLabel(ref) {
    if (ref.seed) return (ref.seed[1] + 1) + '. Gruppe ' + (ref.seed[0] + 1);
    var d = koDef(ref.w || ref.l);
    return (ref.w ? 'Sieger ' : 'Verlierer ') + d.label;
  }

  function koGames(t) {
    var fields = fieldsOf(t);
    var slotMin = parseInt(t.config.slotMinutes, 10) || 17;
    var counters = {};
    return KO_GAMES.map(function (def, idx) {
      var n = counters[def.round] || 0;
      counters[def.round] = n + 1;
      var slot = Math.floor(n / fields);
      return {
        id: def.id,
        no: idx + 1,
        round: def.round,
        label: def.label,
        places: def.places || null,
        home: koSide(t, def.home),
        away: koSide(t, def.away),
        homeLabel: koSideLabel(def.home),
        awayLabel: koSideLabel(def.away),
        field: (n % fields) + 1,
        time: addMinutes(t.config.times[def.round], slot * slotMin)
      };
    });
  }

  function finalRanking(t) {
    var places = [];
    for (var i = 1; i <= TEAM_COUNT; i++) places.push({ place: i, team: null });
    KO_GAMES.forEach(function (def) {
      if (!def.places) return;
      var o = koOutcome(t, def.id);
      if (!o) return;
      places[def.places[0] - 1].team = o.winner;
      places[def.places[1] - 1].team = o.loser;
    });
    return places;
  }

  // Ablauf / Zeitplan wird aus den Spielzeiten berechnet (keine Widersprüche mehr)
  function timetable(t) {
    var gameMin = parseInt(t.config.gameMinutes, 10) || 12;
    function span(games) {
      var times = games.map(function (g) { return g.time; }).filter(Boolean);
      if (!times.length) return '';
      times.sort();
      return times[0] + ' – ca. ' + addMinutes(times[times.length - 1], gameMin);
    }
    var ko = koGames(t);
    function round(key) { return ko.filter(function (g) { return g.round === key; }); }
    return [
      { label: 'Gruppenphase 1', value: span(phaseGames(t, 1)) },
      { label: 'Gruppenphase 2', value: span(phaseGames(t, 2)) },
      { label: 'Viertelfinale', value: span(round('vf')) },
      { label: 'Qualifikation Platz 9–16', value: span(round('q')) },
      { label: 'Halbfinale / kleines Halbfinale', value: span(round('hf')) },
      { label: 'Platzierungsspiele 9–16', value: span(round('pl')) },
      { label: 'Finale / Spiele um Platz 3–8', value: span(round('f')) },
      { label: 'Siegerehrung', value: t.config.times.ceremony || '' }
    ];
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function drawGroups(t) {
    var ids = shuffle(t.teams.map(function (x) { return x.id; }));
    var groups = [];
    for (var g = 0; g < GROUP_COUNT; g++) groups.push(ids.slice(g * TEAMS_PER_GROUP, (g + 1) * TEAMS_PER_GROUP));
    return groups;
  }

  function validateTournament(t) {
    if (!t || typeof t !== 'object') return 'Keine gültige Datei.';
    if (t.format && t.format !== 'andi') return null; // andere Modi prüft engine.js
    if (!Array.isArray(t.teams) || t.teams.length !== TEAM_COUNT) return 'Die Datei enthält nicht 16 Teams.';
    if (!Array.isArray(t.groups1) || t.groups1.length !== GROUP_COUNT) return 'Gruppeneinteilung fehlt.';
    if (!t.config || !t.config.times) return 'Konfiguration fehlt.';
    if (!t.results || typeof t.results !== 'object') t.results = {};
    if (!t.lots) { t.lots = {}; t.teams.forEach(function (x) { t.lots[x.id] = Math.random(); }); }
    if (!Array.isArray(t.info)) t.info = [];
    return null;
  }

  var api = {
    GROUP_COUNT: GROUP_COUNT,
    TEAM_COUNT: TEAM_COUNT,
    KO_ROUNDS: KO_ROUNDS,
    KO_GAMES: KO_GAMES,
    TIME_SLOTS: TIME_SLOTS,
    TIEBREAK_TEXT: TIEBREAK_TEXT,
    uid: uid,
    createTournament: createTournament,
    tableFromGames: tableFromGames,
    DEFAULT_INFO: DEFAULT_INFO,
    shuffle: shuffle,
    defaultConfig: defaultConfig,
    addMinutes: addMinutes,
    teamName: teamName,
    getResult: getResult,
    isPlayed: isPlayed,
    phaseGames: phaseGames,
    standings: standings,
    phaseProgress: phaseProgress,
    isPhaseComplete: isPhaseComplete,
    computeGroups2: computeGroups2,
    computeKoSeeds: computeKoSeeds,
    hasResultsWithPrefix: hasResultsWithPrefix,
    koGames: koGames,
    koOutcome: koOutcome,
    finalRanking: finalRanking,
    timetable: timetable,
    drawGroups: drawGroups,
    validateTournament: validateTournament
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TL = api;
})(this);
