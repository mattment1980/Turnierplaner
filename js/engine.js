/*
 * Turnierplaner – Engine für flexible Modi (ohne DOM)
 *   league : Liga, jeder gegen jeden (einfach oder Hin- und Rückrunde), optional K.-o.-Runde
 *   groups : WM-Format, Gruppen mit 3–10 Teams, X pro Gruppe weiter, beste Nachrücker füllen den K.-o.-Baum
 * "Andi Spezial" liegt unverändert in logic.js.
 */
(function (root) {
  'use strict';

  var TL = root.TL || (typeof require !== 'undefined' ? require('./logic.js') : null);

  var FORMATS = [
    { key: 'andi', name: 'Andi Spezial', desc: '16 Teams · 2 Gruppenphasen (neu gemischt) · alle Plätze 1–16 werden ausgespielt' },
    { key: 'league', name: 'Liga', desc: 'Eine Tabelle, jeder gegen jeden · optional Hin- und Rückrunde · optional K.-o.-Runde' },
    { key: 'groups', name: 'WM-Format', desc: 'Gruppenphase · die Besten jeder Gruppe (plus beste Nachrücker) spielen K.-o.' },
    { key: 'multi', name: 'Mehrstufig', desc: '16, 32 oder 64 Teams · Runde 1 in 4er-Gruppen · Leistungsgruppen Gold/Silber/Bronze · Champions, Europa und Conference League mit Playoffs · auch über 2 Tage und mehrere Orte' }
  ];

  var PLACEMENTS = [
    { key: 'final', label: 'Nur Finale' },
    { key: 'third', label: 'Finale + Spiel um Platz 3' },
    { key: 'all', label: 'Alle Plätze ausspielen' }
  ];

  var MIN_TEAMS = 2, MAX_TEAMS = 32;
  var GROUP_MIN = 3, GROUP_MAX = 10;

  function formatInfo(key) {
    for (var i = 0; i < FORMATS.length; i++) if (FORMATS[i].key === key) return FORMATS[i];
    return FORMATS[0];
  }

  function groupName(g) { return 'Gruppe ' + String.fromCharCode(65 + g); }

  function clamp(n, lo, hi) { n = parseInt(n, 10); if (isNaN(n)) n = lo; return Math.max(lo, Math.min(hi, n)); }

  function nextPow2(n) { var p = 1; while (p < n) p *= 2; return p; }
  function prevPow2(n) { var p = 1; while (p * 2 <= n) p *= 2; return p; }

  /* ---------- Anlegen & Struktur ---------- */

  function defaultGroupCount(n) {
    if (n < 6) return 1;
    return Math.max(1, Math.min(Math.floor(n / GROUP_MIN), Math.round(n / 4)));
  }

  function distribute(ids, count) {
    count = Math.max(1, count);
    var groups = [];
    var base = Math.floor(ids.length / count), extra = ids.length % count, k = 0;
    for (var g = 0; g < count; g++) {
      var size = base + (g < extra ? 1 : 0);
      groups.push(ids.slice(k, k + size));
      k += size;
    }
    return groups;
  }

  function createTournament(format, opts) {
    opts = opts || {};
    if (format === 'multi') return root.ME.createTournament(opts);
    if (format === 'andi') {
      var a = TL.createTournament(opts);
      a.format = 'andi';
      return a;
    }
    var n = clamp(opts.teamCount || 8, MIN_TEAMS, MAX_TEAMS);
    var teams = [], lots = {};
    for (var i = 0; i < n; i++) {
      var id = 't' + (i + 1);
      teams.push({ id: id, name: 'Team ' + (i + 1) });
      lots[id] = Math.random();
    }
    var ids = teams.map(function (x) { return x.id; });
    var t = {
      version: 2,
      format: format,
      id: TL.uid(),
      name: opts.name || 'Neues Turnier',
      date: opts.date || '',
      venue: opts.venue || '',
      ageGroup: opts.ageGroup || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        fields: 4, gameMinutes: 12, slotMinutes: 17, pauseMinutes: 15,
        times: { start: '09:00', ko: '', ceremony: '' },
        double: false,
        koSize: 0,
        groupCount: format === 'groups' ? defaultGroupCount(n) : 1,
        advance: 2,
        placement: 'third'
      },
      teams: teams,
      lots: lots,
      groups: null,
      koSeeds: null,
      results: {},
      info: TL.DEFAULT_INFO.map(function (r) { return { label: r.label, value: r.value }; })
    };
    t.groups = format === 'league' ? [ids] : distribute(ids, t.config.groupCount);
    return t;
  }

  function hasResults(t) {
    return Object.keys(t.results).some(function (k) { return TL.isPlayed(t.results[k]); });
  }

  function allIdsInOrder(t) {
    var out = [];
    t.groups.forEach(function (g) { out = out.concat(g); });
    return out;
  }

  function setTeamCount(t, n) {
    n = clamp(n, MIN_TEAMS, MAX_TEAMS);
    if (hasResults(t) || n === t.teams.length) return false;
    var used = {};
    t.teams.forEach(function (x) { used[x.id] = true; });
    while (t.teams.length < n) {
      var k = 1;
      while (used['t' + k]) k++;
      var id = 't' + k;
      used[id] = true;
      t.teams.push({ id: id, name: 'Team ' + (t.teams.length + 1) });
      t.lots[id] = Math.random();
      // neues Team in die kleinste Gruppe
      var smallest = 0;
      t.groups.forEach(function (g, gi) { if (g.length < t.groups[smallest].length) smallest = gi; });
      t.groups[smallest].push(id);
    }
    while (t.teams.length > n) {
      var gone = t.teams.pop();
      delete t.lots[gone.id];
      t.groups = t.groups.map(function (g) { return g.filter(function (x) { return x !== gone.id; }); });
    }
    if (t.format === 'groups') {
      var maxGroups = Math.max(1, Math.floor(n / 2));
      if (t.config.groupCount > maxGroups) setGroupCount(t, maxGroups);
      else rebalance(t);
    }
    t.koSeeds = null;
    return true;
  }

  // Leere Gruppen vermeiden, ohne die Handverteilung unnötig zu ändern
  function rebalance(t) {
    t.groups.forEach(function (g, gi) {
      if (g.length) return;
      var biggest = 0;
      t.groups.forEach(function (h, hi) { if (h.length > t.groups[biggest].length) biggest = hi; });
      if (t.groups[biggest].length > 1) g.push(t.groups[biggest].pop());
    });
  }

  function setGroupCount(t, count) {
    if (t.format !== 'groups' || hasResults(t)) return false;
    count = clamp(count, 1, Math.max(1, Math.floor(t.teams.length / 2)));
    t.config.groupCount = count;
    t.groups = distribute(allIdsInOrder(t), count);
    t.koSeeds = null;
    return true;
  }

  function drawGroups(t) {
    if (hasResults(t)) return false;
    t.groups = t.format === 'league'
      ? [TL.shuffle(allIdsInOrder(t))]
      : distribute(TL.shuffle(allIdsInOrder(t)), t.groups.length);
    t.koSeeds = null;
    return true;
  }

  function moveTeam(t, id, target) {
    if (hasResults(t) || target < 0 || target >= t.groups.length) return false;
    t.groups = t.groups.map(function (g) { return g.filter(function (x) { return x !== id; }); });
    t.groups[target].push(id);
    t.koSeeds = null;
    return true;
  }

  function groupWarnings(t) {
    var w = [];
    if (t.format !== 'groups') return w;
    t.groups.forEach(function (g, gi) {
      if (g.length < GROUP_MIN) w.push(groupName(gi) + ' hat nur ' + g.length + ' Team' + (g.length === 1 ? '' : 's') + ' (mindestens ' + GROUP_MIN + ').');
      if (g.length > GROUP_MAX) w.push(groupName(gi) + ' hat ' + g.length + ' Teams (höchstens ' + GROUP_MAX + ').');
      if (g.length && t.config.advance >= g.length) w.push('Aus ' + groupName(gi) + ' kämen alle Teams weiter – „Weiter pro Gruppe“ verringern.');
    });
    return w;
  }

  /* ---------- Spielplan ---------- */

  // Rundenturnier (Kreis-Methode). Liefert Runden mit Paarungen [heim, gast].
  function roundRobin(ids) {
    var a = ids.slice();
    if (a.length % 2) a.push(null);
    var n = a.length, rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var pairs = [];
      for (var i = 0; i < n / 2; i++) {
        var x = a[i], y = a[n - 1 - i];
        if (x && y) pairs.push((r + i) % 2 === 0 ? [x, y] : [y, x]);
      }
      rounds.push(pairs);
      a.splice(1, 0, a.pop());
    }
    return rounds;
  }

  // Verteilt Spiele auf Zeitslots à <fields> Spiele.
  // Regeln: kein Team zweimal im selben Slot; Teams spielen ihre Runden in Reihenfolge;
  // wenn möglich keine zwei Spiele direkt hintereinander.
  function schedule(games, fields) {
    var remaining = games.slice().sort(function (a, b) { return a.round - b.round || a.group - b.group || a.m - b.m; });
    var pendingRound = {}; // team -> Liste offener Runden
    remaining.forEach(function (g) {
      [g.home, g.away].forEach(function (tm) { (pendingRound[tm] = pendingRound[tm] || []).push(g.round); });
    });
    function minRound(tm) { return Math.min.apply(null, pendingRound[tm]); }
    function done(g) {
      [g.home, g.away].forEach(function (tm) {
        var l = pendingRound[tm];
        l.splice(l.indexOf(g.round), 1);
        if (!l.length) l.push(Infinity);
      });
    }
    var slot = 0, prev = {}, left = remaining.length;
    while (left > 0) {
      var inSlot = {}, picked = [];
      for (var pass = 0; pass < 2 && picked.length < fields; pass++) {
        for (var i = 0; i < remaining.length && picked.length < fields; i++) {
          var g = remaining[i];
          if (g.slot != null) continue;
          if (inSlot[g.home] || inSlot[g.away]) continue;
          if (g.round !== minRound(g.home) || g.round !== minRound(g.away)) continue;
          if (pass === 0 && (prev[g.home] || prev[g.away])) continue;
          g.slot = slot;
          picked.push(g);
          inSlot[g.home] = inSlot[g.away] = true;
        }
      }
      picked.forEach(function (g, k) { g.field = k + 1; done(g); });
      left -= picked.length;
      prev = inSlot;
      slot++;
      if (slot > 5000) break; // Sicherheitsnetz
    }
    return remaining.sort(function (a, b) { return a.slot - b.slot || a.field - b.field; });
  }

  function fieldsOf(t) { return clamp(t.config.fields, 1, 16); }
  function slotMin(t) { return clamp(t.config.slotMinutes, 1, 180); }

  function stageGames(t) {
    var all = [];
    t.groups.forEach(function (ids, g) {
      var rounds = roundRobin(ids), R = rounds.length;
      rounds.forEach(function (pairs, r) {
        pairs.forEach(function (p, m) { all.push({ id: 'g' + g + '-r' + r + '-m' + m, group: g, round: r, m: m, home: p[0], away: p[1] }); });
      });
      if (t.config.double) {
        rounds.forEach(function (pairs, r) {
          pairs.forEach(function (p, m) { all.push({ id: 'g' + g + '-r' + (r + R) + '-m' + m, group: g, round: r + R, m: m, home: p[1], away: p[0] }); });
        });
      }
    });
    var games = schedule(all, fieldsOf(t));
    games.forEach(function (g, i) {
      g.no = i + 1;
      g.time = TL.addMinutes(t.config.times.start, g.slot * slotMin(t));
      g.groupLabel = t.format === 'league' ? (t.config.double ? (g.round < roundsPerLeg(t) ? 'Hinrunde' : 'Rückrunde') : 'Spieltag ' + (g.round + 1)) : groupName(g.group);
    });
    return games;
  }

  function roundsPerLeg(t) {
    var n = t.groups[0].length;
    return n % 2 ? n : n - 1;
  }

  function stageSlots(t, games) {
    games = games || stageGames(t);
    return games.length ? games[games.length - 1].slot + 1 : 0;
  }

  function stageProgress(t, games) {
    games = games || stageGames(t);
    var done = games.filter(function (g) { return TL.isPlayed(TL.getResult(t, g.id)); }).length;
    return { done: done, total: games.length };
  }

  function stageComplete(t) {
    var p = stageProgress(t);
    return p.total > 0 && p.done === p.total;
  }

  /* ---------- Tabellen ---------- */

  function standings(t, g, games) {
    games = (games || stageGames(t)).filter(function (x) { return x.group === g; });
    var rows = TL.tableFromGames(t, t.groups[g], games);
    var complete = games.length > 0 && games.every(function (x) { return TL.isPlayed(TL.getResult(t, x.id)); });
    return { rows: rows, complete: complete };
  }

  function allStandings(t) {
    var games = stageGames(t);
    return t.groups.map(function (_, g) { return standings(t, g, games); });
  }

  // Vergleich über Gruppen hinweg (für beste Nachrücker, Setzliste, Endstand):
  // Gruppenplatz, dann Punkte/Tordifferenz/Tore pro Spiel, dann Los
  function crossRanking(t) {
    var list = [];
    allStandings(t).forEach(function (st, g) {
      st.rows.forEach(function (r, i) {
        var sp = r.sp || 1;
        list.push({ team: r.team, group: g, rank: i, ppg: r.pts / sp, tdpg: r.td / sp, gfpg: r.gf / sp });
      });
    });
    list.sort(cmpCross);
    return list;
    function cmpCross(a, b) {
      return (a.rank - b.rank) || (b.ppg - a.ppg) || (b.tdpg - a.tdpg) || (b.gfpg - a.gfpg) || (t.lots[a.team] - t.lots[b.team]);
    }
  }

  function cmpPerformance(t) {
    return function (a, b) {
      return (b.ppg - a.ppg) || (b.tdpg - a.tdpg) || (b.gfpg - a.gfpg) || (t.lots[a.team] - t.lots[b.team]);
    };
  }

  /* ---------- K.-o.-Runde ---------- */

  function hasKo(t) {
    return koPlan(t).size >= 2;
  }

  // Wie viele Teams spielen K.-o., und woher kommen sie?
  function koPlan(t) {
    var n = t.teams.length;
    if (t.format === 'league') {
      var k = parseInt(t.config.koSize, 10) || 0;
      if (k < 2 || k > n) return { size: 0, direct: 0, fill: 0 };
      return { size: k, direct: k, fill: 0 };
    }
    var adv = clamp(t.config.advance, 1, GROUP_MAX);
    var direct = 0;
    t.groups.forEach(function (g) { direct += Math.min(adv, g.length); });
    if (direct < 2) return { size: 0, direct: direct, fill: 0 };
    var size = nextPow2(direct);
    if (size > n) size = prevPow2(direct);
    if (size < direct) return { size: size, direct: size, fill: 0, cut: direct - size };
    return { size: size, direct: direct, fill: size - direct, fillRank: adv };
  }

  function seedOrder(n) {
    var o = [1];
    while (o.length < n) {
      var m = o.length * 2;
      o = o.reduce(function (acc, s) { return acc.concat([s, m + 1 - s]); }, []);
    }
    return o;
  }

  // Setzliste -> Positionen im Baum (Pos. 0 gegen 1, 2 gegen 3, …)
  function computeKoSeeds(t) {
    var plan = koPlan(t);
    if (plan.size < 2) return null;
    var seeds;
    if (t.format === 'league') {
      seeds = allStandings(t)[0].rows.slice(0, plan.size).map(function (r) { return { team: r.team, group: 0, rank: 0 }; });
    } else {
      var cross = crossRanking(t);
      var adv = clamp(t.config.advance, 1, GROUP_MAX);
      var direct = cross.filter(function (x) { return x.rank < adv; });
      var rest = cross.filter(function (x) { return x.rank >= adv; });
      // beste Nachrücker: erst alle Teams des nächsten Gruppenplatzes, nach Leistung
      rest.sort(function (a, b) { return (a.rank - b.rank) || cmpPerformance(t)(a, b); });
      seeds = direct.concat(rest.slice(0, Math.max(0, plan.size - direct.length)));
      seeds.sort(function (a, b) { return (a.rank - b.rank) || cmpPerformance(t)(a, b); });
      seeds = seeds.slice(0, plan.size);
    }
    var order = seedOrder(plan.size);
    var pos = order.map(function (s) { return seeds[s - 1]; });
    avoidSameGroup(pos);
    return pos.map(function (x) { return x.team; });
  }

  // In der ersten Runde möglichst keine Teams aus derselben Gruppe gegeneinander
  function avoidSameGroup(pos) {
    for (var i = 0; i < pos.length; i += 2) {
      if (pos[i].group !== pos[i + 1].group) continue;
      for (var j = 0; j < pos.length; j += 2) {
        if (j === i) continue;
        var b = pos[i + 1], b2 = pos[j + 1];
        if (b.rank !== b2.rank) continue;
        if (pos[i].group !== b2.group && pos[j].group !== b.group) {
          pos[i + 1] = b2; pos[j + 1] = b;
          break;
        }
      }
    }
  }

  var ROUND_NAMES = { 2: 'Finale', 4: 'Halbfinale', 8: 'Viertelfinale', 16: 'Achtelfinale', 32: 'Sechzehntelfinale' };

  function koDefs(t) {
    var plan = koPlan(t);
    if (plan.size < 2) return [];
    var placement = t.config.placement || 'third';
    var defs = [], counter = 0;
    function sub(refs, placeFrom, depth) {
      var m = refs.length;
      if (m < 2) return;
      var winners = [], losers = [], first = defs.length;
      for (var i = 0; i < m / 2; i++) {
        var id = 'ko-' + (++counter);
        defs.push({ id: id, depth: depth, size: m, placeFrom: placeFrom, home: refs[i * 2], away: refs[i * 2 + 1], idx: i + 1, count: m / 2 });
        winners.push({ w: id });
        losers.push({ l: id });
      }
      if (m === 2) { defs[first].places = [placeFrom, placeFrom + 1]; return; }
      sub(winners, placeFrom, depth + 1);
      if (placement === 'all' || (placement === 'third' && m === 4 && placeFrom === 1)) sub(losers, placeFrom + m / 2, depth + 1);
    }
    var refs = [];
    for (var p = 0; p < plan.size; p++) refs.push({ pos: p });
    sub(refs, 1, 0);
    defs.forEach(function (d) { d.label = koLabel(d); });
    return defs;
  }

  function koLabel(d) {
    var n = d.count > 1 ? ' ' + d.idx : '';
    if (d.placeFrom === 1) return ROUND_NAMES[d.size] + n;
    if (d.size === 2) return 'Spiel um Platz ' + d.placeFrom;
    return 'Platzierung ' + d.placeFrom + '–' + (d.placeFrom + d.size - 1) + ' · ' + (d.size === 4 ? 'Halbfinale' : ROUND_NAMES[d.size]) + n;
  }

  function findDef(defs, id) {
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }

  function koOutcome(t, defs, id, memo) {
    if (memo[id] !== undefined) return memo[id];
    var d = findDef(defs, id);
    var home = koSide(t, defs, d.home, memo), away = koSide(t, defs, d.away, memo);
    var r = TL.getResult(t, id), out = null;
    if (home && away && TL.isPlayed(r)) {
      var hw = r.h > r.a ? true : r.a > r.h ? false : r.pen === 'h' ? true : r.pen === 'a' ? false : null;
      if (hw !== null) out = hw ? { winner: home, loser: away } : { winner: away, loser: home };
    }
    memo[id] = out;
    return out;
  }

  function koSide(t, defs, ref, memo) {
    if (ref.pos != null) return t.koSeeds ? t.koSeeds[ref.pos] || null : null;
    var o = koOutcome(t, defs, ref.w || ref.l, memo);
    return o ? (ref.w ? o.winner : o.loser) : null;
  }

  function sideLabel(t, defs, ref) {
    if (ref.pos != null) {
      var order = seedOrder(koPlan(t).size);
      return t.format === 'league' ? 'Platz ' + order[ref.pos] + ' der Liga' : 'Setzplatz ' + order[ref.pos];
    }
    var d = findDef(defs, ref.w || ref.l);
    return (ref.w ? 'Sieger ' : 'Verlierer ') + d.label;
  }

  function koStart(t, games) {
    if (t.config.times.ko) return t.config.times.ko;
    return TL.addMinutes(t.config.times.start, stageSlots(t, games) * slotMin(t) + (parseInt(t.config.pauseMinutes, 10) || 0));
  }

  function koGames(t, games) {
    games = games || stageGames(t);
    var defs = koDefs(t), memo = {};
    var fields = fieldsOf(t), start = koStart(t, games);
    var slotBase = 0, depth = -1, inDepth = 0, maxSlotInDepth = 0;
    return defs.slice().sort(function (a, b) { return a.depth - b.depth || a.placeFrom - b.placeFrom; }).map(function (d, i) {
      if (d.depth !== depth) { slotBase += depth < 0 ? 0 : maxSlotInDepth + 1; depth = d.depth; inDepth = 0; maxSlotInDepth = 0; }
      var s = Math.floor(inDepth / fields);
      maxSlotInDepth = Math.max(maxSlotInDepth, s);
      var field = (inDepth % fields) + 1;
      inDepth++;
      return {
        id: d.id, no: games.length + i + 1, depth: d.depth, size: d.size, placeFrom: d.placeFrom, label: d.label, places: d.places || null,
        home: koSide(t, defs, d.home, memo), away: koSide(t, defs, d.away, memo),
        homeLabel: sideLabel(t, defs, d.home), awayLabel: sideLabel(t, defs, d.away),
        field: field, time: TL.addMinutes(start, (slotBase + s) * slotMin(t))
      };
    });
  }

  function koSections(t, kgames) {
    var byDepth = {};
    kgames.forEach(function (g) { (byDepth[g.depth] = byDepth[g.depth] || []).push(g); });
    return Object.keys(byDepth).map(function (d) {
      var list = byDepth[d];
      var names = [];
      list.forEach(function (g) {
        var base = g.placeFrom === 1 ? ROUND_NAMES[g.size] : (g.size === 2 ? 'Spiel um Platz ' + g.placeFrom : 'Platzierung ' + g.placeFrom + '–' + (g.placeFrom + g.size - 1));
        if (names.indexOf(base) < 0) names.push(base);
      });
      return { title: names.join(' · '), games: list };
    });
  }

  /* ---------- Endstand ---------- */

  function finalRanking(t) {
    var n = t.teams.length;
    var plan = koPlan(t);
    var games = stageGames(t);
    var cross = t.format === 'league'
      ? allStandings(t)[0].rows.map(function (r, i) { return { team: r.team, rank: i }; })
      : crossRanking(t);
    var crossIdx = {};
    cross.forEach(function (c, i) { crossIdx[c.team] = i; });
    var complete = stageComplete(t);
    var out = [];

    if (plan.size < 2) {
      cross.forEach(function (c, i) { out.push({ place: i + 1, team: c.team }); });
      return { places: out, provisional: !complete };
    }

    var slots = [];
    for (var i = 0; i < n; i++) slots.push({ place: i + 1, team: null });
    if (t.koSeeds) {
      var defs = koDefs(t), memo = {};
      var loserUsed = {};
      defs.forEach(function (d) { if (d.home.l) loserUsed[d.home.l] = true; if (d.away.l) loserUsed[d.away.l] = true; });
      var shared = {};
      defs.forEach(function (d) {
        var o = koOutcome(t, defs, d.id, memo);
        if (!o) return;
        if (d.places) {
          slots[d.places[0] - 1].team = o.winner;
          slots[d.places[1] - 1].team = o.loser;
        } else if (!loserUsed[d.id]) {
          var from = d.placeFrom + d.size / 2;
          (shared[from] = shared[from] || []).push(o.loser);
        }
      });
      Object.keys(shared).forEach(function (from) {
        var list = shared[from].sort(function (a, b) { return crossIdx[a] - crossIdx[b]; });
        list.forEach(function (team, k) { slots[from - 1 + k] = { place: parseInt(from, 10), team: team, shared: true }; });
      });
      var inKo = {};
      t.koSeeds.forEach(function (id) { inKo[id] = true; });
      var k = plan.size;
      cross.forEach(function (c) { if (!inKo[c.team]) { slots[k] = { place: k + 1, team: c.team }; k++; } });
    }
    return { places: slots, provisional: false };
  }

  /* ---------- Zeitplan ---------- */

  function timetable(t) {
    var games = stageGames(t);
    var gm = parseInt(t.config.gameMinutes, 10) || 12;
    function span(list) {
      var times = list.map(function (g) { return g.time; }).filter(Boolean).sort();
      return times.length ? times[0] + ' – ca. ' + TL.addMinutes(times[times.length - 1], gm) : '';
    }
    var rows = [{ label: t.format === 'league' ? 'Liga' : 'Gruppenphase', value: span(games) }];
    if (hasKo(t)) koSections(t, koGames(t, games)).forEach(function (s) { rows.push({ label: s.title, value: span(s.games) }); });
    if (t.config.times.ceremony) rows.push({ label: 'Siegerehrung', value: t.config.times.ceremony });
    return rows;
  }

  function validate(t) {
    if (!Array.isArray(t.teams) || t.teams.length < MIN_TEAMS || t.teams.length > MAX_TEAMS) return 'Ungültige Teamanzahl.';
    if (!Array.isArray(t.groups) || !t.groups.length) return 'Gruppeneinteilung fehlt.';
    if (!t.config || !t.config.times) return 'Konfiguration fehlt.';
    if (!t.results || typeof t.results !== 'object') t.results = {};
    if (!t.lots) { t.lots = {}; t.teams.forEach(function (x) { t.lots[x.id] = Math.random(); }); }
    if (!Array.isArray(t.info)) t.info = [];
    return null;
  }

  var api = {
    FORMATS: FORMATS,
    PLACEMENTS: PLACEMENTS,
    MIN_TEAMS: MIN_TEAMS, MAX_TEAMS: MAX_TEAMS, GROUP_MIN: GROUP_MIN, GROUP_MAX: GROUP_MAX,
    formatInfo: formatInfo,
    groupName: groupName,
    createTournament: createTournament,
    hasResults: hasResults,
    setTeamCount: setTeamCount,
    setGroupCount: setGroupCount,
    drawGroups: drawGroups,
    moveTeam: moveTeam,
    groupWarnings: groupWarnings,
    roundRobin: roundRobin,
    schedule: schedule,
    stageGames: stageGames,
    stageProgress: stageProgress,
    stageComplete: stageComplete,
    standings: standings,
    allStandings: allStandings,
    crossRanking: crossRanking,
    hasKo: hasKo,
    koPlan: koPlan,
    computeKoSeeds: computeKoSeeds,
    koDefs: koDefs,
    koGames: koGames,
    koSections: koSections,
    finalRanking: finalRanking,
    timetable: timetable,
    validate: validate,
    seedOrder: seedOrder
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GE = api;
})(this);
