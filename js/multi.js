/*
 * Turnierplaner – Modus „Mehrstufig“ (16, 32 oder 64 Teams), ohne DOM
 *
 * Runde 1: 4er-Gruppen (Hand oder Auslosung)
 * Runde 2: 16 Teams  -> Gold (1.+2.) und Silber (3.+4.), danach Playoffs je Ast
 *          32/64     -> Gold (alle 1.), Silber (2.+3.), Bronze (alle 4.)
 * Runde 3: 32/64     -> Champions League (Gold 1–3 + Silber 1), Europa League (Silber 2+3, Bronze 1, Gold 4),
 *                       Conference League (Silber 4, Bronze 2–4), danach Playoffs je Liga
 * Gruppen in Runde 2/3: Setzung nach Leistung im Schlangenverfahren, Wiederholungsspiele möglichst vermeiden.
 * Wertung je Runde getrennt. Endstand: Gold vor Silber bzw. CL vor EL vor Conference.
 */
(function (root) {
  'use strict';

  var TL = root.TL || (typeof require !== 'undefined' ? require('./logic.js') : null);
  var GE = root.GE || (typeof require !== 'undefined' ? require('./engine.js') : null);

  var SIZES = [16, 32, 64];

  var BRANCHES = {
    r1: { name: 'Runde 1', short: 'R1' },
    gold: { name: 'Gold', short: 'Gold' },
    silver: { name: 'Silber', short: 'Silber' },
    bronze: { name: 'Bronze', short: 'Bronze' },
    cl: { name: 'Champions League', short: 'CL' },
    el: { name: 'Europa League', short: 'EL' },
    conf: { name: 'Conference League', short: 'Conf.' }
  };

  var ROUND_NAMES = { 2: 'Finale', 4: 'Halbfinale', 8: 'Viertelfinale' };

  // Playoff-Vorlagen: Klammern mit Startplatz (innerhalb der Liga) und Slots [Gruppenplatz, Gruppe] in Baum-Reihenfolge
  function cross4(r1, r2) { return [[r1, 0], [r2, 1], [r1, 1], [r2, 0]]; }
  function pair(r) { return [[r, 0], [r, 1]]; }
  function four(r) { return [[r, 0], [r, 2], [r, 1], [r, 3]]; }
  var QF4 = [[0, 0], [1, 1], [0, 2], [1, 3], [0, 1], [1, 0], [0, 3], [1, 2]];
  var PO = {
    p4x2: [{ from: 1, slots: cross4(0, 1) }, { from: 5, slots: cross4(2, 3) }],
    p5x2: [{ from: 1, slots: [[0, 0], [3, 1], [1, 1], [2, 0], [0, 1], [3, 0], [1, 0], [2, 1]] }, { from: 9, slots: pair(4) }],
    p6x2: [{ from: 1, slots: cross4(0, 1) }, { from: 5, slots: pair(2) }, { from: 7, slots: pair(3) }, { from: 9, slots: pair(4) }, { from: 11, slots: pair(5) }],
    p5x4: [{ from: 1, slots: QF4 }, { from: 9, slots: four(2) }, { from: 13, slots: four(3) }, { from: 17, slots: four(4) }],
    p6x4: [{ from: 1, slots: QF4 }, { from: 9, slots: four(2) }, { from: 13, slots: four(3) }, { from: 17, slots: four(4) }, { from: 21, slots: four(5) }]
  };

  function blueprint(n) {
    if (n === 16) {
      return {
        rounds: { 2: [
          { key: 'gold', groups: 2, from: [{ src: 'r1', rank: 0 }, { src: 'r1', rank: 1 }] },
          { key: 'silver', groups: 2, from: [{ src: 'r1', rank: 2 }, { src: 'r1', rank: 3 }] }
        ] },
        lastRound: 2,
        order: ['gold', 'silver'],
        po: { gold: 'p4x2', silver: 'p4x2' }
      };
    }
    var k = n / 32;
    return {
      rounds: {
        2: [
          { key: 'gold', groups: 2 * k, from: [{ src: 'r1', rank: 0 }] },
          { key: 'silver', groups: 4 * k, from: [{ src: 'r1', rank: 1 }, { src: 'r1', rank: 2 }] },
          { key: 'bronze', groups: 2 * k, from: [{ src: 'r1', rank: 3 }] }
        ],
        3: [
          { key: 'cl', groups: 2 * k, from: [{ src: 'gold', rank: 0 }, { src: 'gold', rank: 1 }, { src: 'gold', rank: 2 }, { src: 'silver', rank: 0 }] },
          { key: 'el', groups: 2 * k, from: [{ src: 'silver', rank: 1 }, { src: 'silver', rank: 2 }, { src: 'bronze', rank: 0 }, { src: 'gold', rank: 3 }] },
          { key: 'conf', groups: 2 * k, from: [{ src: 'silver', rank: 3 }, { src: 'bronze', rank: 1 }, { src: 'bronze', rank: 2 }, { src: 'bronze', rank: 3 }] }
        ]
      },
      lastRound: 3,
      order: ['cl', 'el', 'conf'],
      po: n === 32 ? { cl: 'p5x2', el: 'p6x2', conf: 'p5x2' } : { cl: 'p5x4', el: 'p6x4', conf: 'p5x4' }
    };
  }

  function bp(t) { return blueprint(t.teams.length); }

  function branchesOf(t, r) {
    if (r === 1) return [{ key: 'r1', groups: t.teams.length / 4 }];
    return bp(t).rounds[r] || [];
  }

  function rounds(t) { return bp(t).lastRound === 3 ? [1, 2, 3] : [1, 2]; }

  function groupLetter(g) { return String.fromCharCode(65 + g); }

  function groupLabel(branch, g) {
    return (branch === 'r1' ? '' : BRANCHES[branch].name + ' · ') + 'Gruppe ' + groupLetter(g);
  }

  /* ---------- Anlegen ---------- */

  function defaultPlace() {
    return { r1: 'all', gold: 'L1', silver: 'L1', bronze: 'L1', cl: 'L1', el: 'L1', conf: 'L1' };
  }

  function createTournament(opts) {
    opts = opts || {};
    var n = SIZES.indexOf(parseInt(opts.teamCount, 10)) >= 0 ? parseInt(opts.teamCount, 10) : 32;
    var t = {
      version: 2,
      format: 'multi',
      id: TL.uid(),
      name: opts.name || 'Neues Turnier',
      date: opts.date || '',
      venue: opts.venue || '',
      ageGroup: opts.ageGroup || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        gameMinutes: 12, slotMinutes: 17, pauseMinutes: 15,
        locations: [{ id: 'L1', name: opts.venue || 'Halle 1', fields: 4 }],
        place: defaultPlace(),
        rounds: { 1: { date: opts.date || '', start: '09:00' }, 2: { date: '', start: '' }, 3: { date: '', start: '' } }
      },
      teams: [], lots: {}, groups: [],
      stages: { 2: null, 3: null },
      po: {},
      results: {},
      info: TL.DEFAULT_INFO.map(function (r) { return { label: r.label, value: r.value }; })
    };
    buildTeams(t, n);
    return t;
  }

  function buildTeams(t, n) {
    var old = t.teams || [];
    t.teams = [];
    t.lots = {};
    for (var i = 0; i < n; i++) {
      var id = 't' + (i + 1);
      var prev = old[i];
      t.teams.push({ id: id, name: prev ? prev.name : 'Team ' + (i + 1), logo: prev && prev.logo });
      if (!t.teams[i].logo) delete t.teams[i].logo;
      t.lots[id] = Math.random();
    }
    t.groups = [];
    for (var g = 0; g < n / 4; g++) t.groups.push(t.teams.slice(g * 4, g * 4 + 4).map(function (x) { return x.id; }));
    t.stages = { 2: null, 3: null };
    t.po = {};
  }

  function hasResults(t) { return GE.hasResults(t); }

  function setTeamCount(t, n) {
    n = parseInt(n, 10);
    if (SIZES.indexOf(n) < 0 || n === t.teams.length || hasResults(t)) return false;
    buildTeams(t, n);
    return true;
  }

  function drawGroups(t) {
    if (hasResults(t)) return false;
    var ids = TL.shuffle(t.teams.map(function (x) { return x.id; }));
    t.groups = [];
    for (var g = 0; g < ids.length / 4; g++) t.groups.push(ids.slice(g * 4, g * 4 + 4));
    t.stages = { 2: null, 3: null };
    t.po = {};
    return true;
  }

  /* ---------- Gruppen & Spiele ---------- */

  function groupsOf(t, r, branch) {
    if (r === 1) return t.groups;
    return t.stages[r] ? t.stages[r][branch] : null;
  }

  // Alle Gruppenspiele einer Runde (ohne Zeiten). Vor dem Festlegen mit Platzhaltern.
  function rawGroupGames(t, r) {
    var out = [];
    branchesOf(t, r).forEach(function (b) {
      var groups = groupsOf(t, r, b.key);
      for (var g = 0; g < b.groups; g++) {
        var size = groups ? groups[g].length : (r === 1 ? 4 : groupSize(t, r, b));
        var ids = [];
        for (var p = 0; p < size; p++) ids.push(groups ? groups[g][p] : '?' + b.key + g + '-' + p);
        GE.roundRobin(ids).forEach(function (pairs, rr) {
          pairs.forEach(function (pr, m) {
            var real = !!groups;
            out.push({
              id: 'm' + r + '-' + b.key + '-g' + g + '-r' + rr + '-m' + m,
              round: r, branch: b.key, group: g, rr: rr, m: m,
              home: real ? pr[0] : null, away: real ? pr[1] : null,
              _h: pr[0], _a: pr[1],
              homeLabel: real ? null : groupLabel(b.key, g) + ' · Pos. ' + (parseInt(pr[0].split('-')[1], 10) + 1),
              awayLabel: real ? null : groupLabel(b.key, g) + ' · Pos. ' + (parseInt(pr[1].split('-')[1], 10) + 1),
              groupLabel: groupLabel(b.key, g)
            });
          });
        });
      }
    });
    return out;
  }

  function groupSize(t, r, b) {
    var total = 0;
    b.from.forEach(function (f) { total += sourceCount(t, f); });
    return total / b.groups;
  }

  function sourceCount(t, f) {
    if (f.src === 'r1') return t.teams.length / 4;
    var r2 = bp(t).rounds[2];
    for (var i = 0; i < r2.length; i++) if (r2[i].key === f.src) return r2[i].groups;
    return 0;
  }

  /* ---------- Playoffs ---------- */

  function poBranches(t) { return bp(t).order; }

  function poDefs(t, branch) {
    var tpl = PO[bp(t).po[branch]];
    var defs = [], counter = 0;
    function sub(refs, from, depth) {
      var m = refs.length;
      if (m < 2) return;
      var winners = [], losers = [], first = defs.length;
      for (var i = 0; i < m / 2; i++) {
        var id = 'ko-' + branch + '-' + (++counter);
        defs.push({ id: id, branch: branch, depth: depth, size: m, placeFrom: from, home: refs[i * 2], away: refs[i * 2 + 1], idx: i + 1, count: m / 2 });
        winners.push({ w: id });
        losers.push({ l: id });
      }
      if (m === 2) { defs[first].places = [from, from + 1]; return; }
      sub(winners, from, depth + 1);
      sub(losers, from + m / 2, depth + 1);
    }
    tpl.forEach(function (br, bi) {
      sub(br.slots.map(function (s, si) { return { slot: [bi, si], rank: s[0], group: s[1] }; }), br.from, 0);
    });
    defs.forEach(function (d) { d.label = poLabel(d); });
    return defs;
  }

  function poLabel(d) {
    var n = d.count > 1 ? ' ' + d.idx : '';
    if (d.placeFrom === 1) return (d.size === 2 ? 'Finale' : ROUND_NAMES[d.size] + n);
    if (d.size === 2) return d.placeFrom === 3 ? 'Spiel um Platz 3' : 'Spiel um Platz ' + d.placeFrom;
    return 'Platzierung ' + d.placeFrom + '–' + (d.placeFrom + d.size - 1) + ' · ' + (d.size === 4 ? 'Halbfinale' : 'Viertelfinale') + n;
  }

  function poSize(t, branch) {
    var tpl = PO[bp(t).po[branch]];
    var last = tpl[tpl.length - 1];
    return last.from + last.slots.length - 1;
  }

  function findDef(defs, id) {
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }

  function poOutcome(t, defs, id, memo) {
    if (memo[id] !== undefined) return memo[id];
    var d = findDef(defs, id);
    var home = poSide(t, defs, d.home, memo), away = poSide(t, defs, d.away, memo);
    var r = TL.getResult(t, id), out = null;
    if (home && away && TL.isPlayed(r)) {
      var hw = r.h > r.a ? true : r.a > r.h ? false : r.pen === 'h' ? true : r.pen === 'a' ? false : null;
      if (hw !== null) out = hw ? { winner: home, loser: away } : { winner: away, loser: home };
    }
    memo[id] = out;
    return out;
  }

  function poSide(t, defs, ref, memo) {
    if (ref.slot) {
      var seeds = t.po[defs[0].branch];
      return seeds ? seeds[ref.slot[0]][ref.slot[1]] || null : null;
    }
    var o = poOutcome(t, defs, ref.w || ref.l, memo);
    return o ? (ref.w ? o.winner : o.loser) : null;
  }

  function poSideLabel(defs, ref) {
    if (ref.slot) return (ref.rank + 1) + '. Gruppe ' + groupLetter(ref.group);
    var d = findDef(defs, ref.w || ref.l);
    return (ref.w ? 'Sieger ' : 'Verlierer ') + d.label;
  }

  function rawPoGames(t, branch) {
    var defs = poDefs(t, branch), memo = {};
    return defs.map(function (d) {
      return {
        id: d.id, round: bp(t).lastRound, branch: branch, depth: d.depth, size: d.size, placeFrom: d.placeFrom,
        label: d.label, places: d.places || null,
        home: poSide(t, defs, d.home, memo), away: poSide(t, defs, d.away, memo),
        homeLabel: poSideLabel(defs, d.home), awayLabel: poSideLabel(defs, d.away), isKo: true
      };
    });
  }

  /* ---------- Orte & Zeitplan ---------- */

  function locations(t) {
    var l = t.config.locations;
    return l && l.length ? l : [{ id: 'L1', name: 'Halle 1', fields: 4 }];
  }

  function locById(t, id) {
    var l = locations(t);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return l[0];
  }

  // Runde-1-Gruppen auf Orte verteilen (bei „alle Orte“: anteilig nach Feldern)
  function r1Location(t, g) {
    var p = t.config.place.r1;
    if (p && p !== 'all') return locById(t, p).id;
    var locs = locations(t), count = {}, out = [];
    locs.forEach(function (l) { count[l.id] = 0; });
    for (var i = 0; i <= g; i++) {
      var best = locs[0];
      locs.forEach(function (l) {
        if (count[l.id] / Math.max(1, l.fields) < count[best.id] / Math.max(1, best.fields)) best = l;
      });
      count[best.id]++;
      out.push(best.id);
    }
    return out[g];
  }

  function locOf(t, branch, g) {
    if (branch === 'r1') return r1Location(t, g);
    return locById(t, t.config.place[branch]).id;
  }

  function toMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }

  function fromMin(min) { return TL.addMinutes('00:00', min); }

  // Berechnet Zeit, Datum, Ort und Feld für alle Spiele
  function timeline(t) {
    var slotM = parseInt(t.config.slotMinutes, 10) || 17;
    var gameM = parseInt(t.config.gameMinutes, 10) || 12;
    var pause = parseInt(t.config.pauseMinutes, 10) || 0;
    var all = [], prevEnd = null, prevDate = '';
    rounds(t).forEach(function (r) {
      var rc = t.config.rounds[r] || {};
      var date = rc.date || prevDate || '';
      var start = toMin(rc.start);
      if (start == null) start = prevEnd != null && (!rc.date || rc.date === prevDate) ? prevEnd + pause : toMin('09:00');
      var games = rawGroupGames(t, r);
      var lastSlot = {};
      locations(t).forEach(function (loc) {
        var here = games.filter(function (g) { return locOf(t, g.branch, g.group) === loc.id; });
        var input = here.map(function (g, i) {
          return { round: g.rr, group: branchIndex(g.branch) * 100 + g.group, m: g.m, home: g._h, away: g._a, ref: g };
        });
        GE.schedule(input, Math.max(1, parseInt(loc.fields, 10) || 1)).forEach(function (x) {
          x.ref.slot = x.slot; x.ref.field = x.field; x.ref.loc = loc.id;
          x.ref.min = start + x.slot * slotM;
          lastSlot[loc.id] = Math.max(lastSlot[loc.id] == null ? -1 : lastSlot[loc.id], x.slot);
        });
      });
      // Playoffs in der letzten Runde (bzw. Runde 2 bei 16 Teams)
      var po = [];
      if (r === bp(t).lastRound) {
        poBranches(t).forEach(function (b) { po = po.concat(rawPoGames(t, b)); });
        locations(t).forEach(function (loc) {
          var here = po.filter(function (g) { return locOf(t, g.branch) === loc.id; });
          if (!here.length) return;
          var base = start + ((lastSlot[loc.id] == null ? -1 : lastSlot[loc.id]) + 1) * slotM + pause;
          var fields = Math.max(1, parseInt(loc.fields, 10) || 1);
          var slotBase = 0;
          var depths = {};
          here.forEach(function (g) { (depths[g.depth] = depths[g.depth] || []).push(g); });
          Object.keys(depths).sort(function (a, b) { return a - b; }).forEach(function (d) {
            var list = depths[d].sort(function (a, b) { return branchIndex(a.branch) - branchIndex(b.branch) || a.placeFrom - b.placeFrom; });
            list.forEach(function (g, i) {
              g.slot = slotBase + Math.floor(i / fields);
              g.field = (i % fields) + 1;
              g.loc = loc.id;
              g.min = base + g.slot * slotM;
            });
            slotBase += Math.ceil(list.length / fields);
          });
        });
      }
      var roundGames = games.concat(po);
      roundGames.forEach(function (g) { g.date = date; g.time = fromMin(g.min); });
      var end = null;
      roundGames.forEach(function (g) { end = Math.max(end == null ? 0 : end, g.min + slotM); });
      all = all.concat(roundGames);
      prevEnd = end;
      prevDate = date;
    });
    all.sort(function (a, b) {
      return (a.round - b.round) || ((a.date || '').localeCompare(b.date || '')) || (a.min - b.min) || (a.loc || '').localeCompare(b.loc || '') || (a.field - b.field);
    });
    all.forEach(function (g, i) { g.no = i + 1; g.gameMinutes = gameM; });
    return all;
  }

  function branchIndex(b) {
    return ['r1', 'gold', 'silver', 'bronze', 'cl', 'el', 'conf'].indexOf(b);
  }

  /* ---------- Tabellen & Fortschritt ---------- */

  function standings(t, r, branch, g, tl) {
    var groups = groupsOf(t, r, branch);
    if (!groups) return null;
    var games = (tl || timeline(t)).filter(function (x) { return !x.isKo && x.round === r && x.branch === branch && x.group === g; });
    var rows = TL.tableFromGames(t, groups[g], games);
    var complete = games.length > 0 && games.every(function (x) { return TL.isPlayed(TL.getResult(t, x.id)); });
    return { rows: rows, complete: complete };
  }

  function progress(t, filter, tl) {
    var games = (tl || timeline(t)).filter(filter);
    var real = games.filter(function (g) { return g.home && g.away; });
    var done = real.filter(function (g) { return TL.isPlayed(TL.getResult(t, g.id)); }).length;
    return { done: done, total: games.length };
  }

  function roundProgress(t, r, tl) {
    return progress(t, function (g) { return g.round === r && !g.isKo; }, tl);
  }

  function branchComplete(t, r, branch, tl) {
    if (!groupsOf(t, r, branch)) return false;
    var p = progress(t, function (g) { return g.round === r && g.branch === branch && !g.isKo; }, tl);
    return p.total > 0 && p.done === p.total;
  }

  function roundComplete(t, r, tl) {
    tl = tl || timeline(t);
    return branchesOf(t, r).every(function (b) { return branchComplete(t, r, b.key, tl); });
  }

  /* ---------- Gruppen der nächsten Runde bilden ---------- */

  // Teams eines Gruppenplatzes aus allen Gruppen einer Quelle, sortiert nach Leistung
  function sourceTeams(t, f, tl) {
    var r = f.src === 'r1' ? 1 : 2;
    var branch = f.src;
    var groups = groupsOf(t, r, branch);
    var out = [];
    groups.forEach(function (_, g) {
      var st = standings(t, r, branch, g, tl);
      var row = st.rows[f.rank];
      if (!row) return;
      var sp = row.sp || 1;
      out.push({ team: row.team, prev: branch + g, ppg: row.pts / sp, tdpg: row.td / sp, gfpg: row.gf / sp, lot: t.lots[row.team] });
    });
    out.sort(function (a, b) { return (b.ppg - a.ppg) || (b.tdpg - a.tdpg) || (b.gfpg - a.gfpg) || (a.lot - b.lot); });
    return out;
  }

  function conflicts(group) {
    var c = 0;
    for (var i = 0; i < group.length; i++) for (var j = i + 1; j < group.length; j++) if (group[i].prev === group[j].prev) c++;
    return c;
  }

  function computeStage(t, r, tl) {
    tl = tl || timeline(t);
    var stage = {};
    branchesOf(t, r).forEach(function (b) {
      var G = b.groups;
      var groups = [];
      for (var g = 0; g < G; g++) groups.push([]);
      var potIndex = 0;
      var bySource = [];
      b.from.forEach(function (f) {
        var list = sourceTeams(t, f, tl);
        var members = [];
        for (var k = 0; k < list.length; k += G) {
          var pot = list.slice(k, k + G);
          var order = potIndex % 2 === 0 ? pot : pot.slice().reverse();
          // Wiederholungsspiele innerhalb des Topfs vermeiden
          var assign = bestAssignment(groups, order);
          assign.forEach(function (team, g) { groups[g].push(team); members.push({ g: g, team: team }); });
          potIndex++;
        }
        bySource.push(members);
      });
      // Zweiter Durchgang: Teams gleicher Herkunft (gleicher Gruppenplatz) zwischen Gruppen tauschen, falls das Konflikte löst
      for (var pass = 0; pass < 4; pass++) {
        var improved = false;
        bySource.forEach(function (members) {
          for (var i = 0; i < members.length; i++) {
            for (var j = i + 1; j < members.length; j++) {
              var a = members[i], c = members[j];
              if (a.g === c.g) continue;
              var ga = groups[a.g], gc = groups[c.g];
              var before = conflicts(ga) + conflicts(gc);
              var ia = ga.indexOf(a.team), ic = gc.indexOf(c.team);
              ga[ia] = c.team; gc[ic] = a.team;
              var after = conflicts(ga) + conflicts(gc);
              if (after < before) {
                var tmp = a.g; a.g = c.g; c.g = tmp;
                improved = true;
              } else {
                ga[ia] = a.team; gc[ic] = c.team;
              }
            }
          }
        });
        if (!improved) break;
      }
      stage[b.key] = groups.map(function (grp) { return grp.map(function (x) { return x.team; }); });
    });
    return stage;
  }

  // Ordnet einen Topf (ein Team je Gruppe) so zu, dass möglichst wenige Wiederholungsspiele entstehen;
  // bei Gleichstand bleibt die Schlangen-Reihenfolge.
  function bestAssignment(groups, pot) {
    var assign = pot.slice();
    var improved = true, guard = 0;
    function cost(g, team) {
      var c = 0;
      groups[g].forEach(function (x) { if (x.prev === team.prev) c++; });
      return c;
    }
    while (improved && guard++ < 20) {
      improved = false;
      for (var i = 0; i < assign.length; i++) {
        for (var j = i + 1; j < assign.length; j++) {
          var before = cost(i, assign[i]) + cost(j, assign[j]);
          var after = cost(i, assign[j]) + cost(j, assign[i]);
          if (after < before) {
            var tmp = assign[i]; assign[i] = assign[j]; assign[j] = tmp;
            improved = true;
          }
        }
      }
    }
    return assign;
  }

  function computePo(t, branch, tl) {
    tl = tl || timeline(t);
    var r = bp(t).lastRound;
    var tpl = PO[bp(t).po[branch]];
    var tables = groupsOf(t, r, branch).map(function (_, g) { return standings(t, r, branch, g, tl).rows; });
    return tpl.map(function (br) {
      return br.slots.map(function (s) { return tables[s[1]][s[0]].team; });
    });
  }

  function clearPrefix(t, prefix) {
    Object.keys(t.results).forEach(function (k) { if (k.indexOf(prefix) === 0) delete t.results[k]; });
  }

  // Runde r festlegen (Gruppen bilden). Löscht spätere Runden.
  function lockRound(t, r) {
    var tl = timeline(t);
    if (!roundComplete(t, r - 1, tl)) return false;
    for (var x = r; x <= 3; x++) { clearPrefix(t, 'm' + x + '-'); t.stages[x] = null; }
    clearPrefix(t, 'ko-');
    t.po = {};
    t.stages[r] = computeStage(t, r, tl);
    return true;
  }

  function unlockRound(t, r) {
    for (var x = r; x <= 3; x++) { clearPrefix(t, 'm' + x + '-'); t.stages[x] = null; }
    clearPrefix(t, 'ko-');
    t.po = {};
  }

  function lockPo(t, branch) {
    var tl = timeline(t);
    if (!branchComplete(t, bp(t).lastRound, branch, tl)) return false;
    clearPrefix(t, 'ko-' + branch + '-');
    t.po[branch] = computePo(t, branch, tl);
    return true;
  }

  function unlockPo(t, branch) {
    clearPrefix(t, 'ko-' + branch + '-');
    delete t.po[branch];
  }

  function hasResultsWithPrefix(t, prefix) { return TL.hasResultsWithPrefix(t, prefix); }

  /* ---------- Endstand ---------- */

  function finalRanking(t) {
    var places = [];
    var offset = 0;
    poBranches(t).forEach(function (b) {
      var size = poSize(t, b);
      var defs = poDefs(t, b), memo = {};
      for (var i = 0; i < size; i++) places.push({ place: offset + i + 1, team: null, branch: b });
      defs.forEach(function (d) {
        if (!d.places) return;
        var o = poOutcome(t, defs, d.id, memo);
        if (!o) return;
        places[offset + d.places[0] - 1].team = o.winner;
        places[offset + d.places[1] - 1].team = o.loser;
      });
      offset += size;
    });
    return { places: places };
  }

  /* ---------- Info ---------- */

  function structureText(t) {
    var n = t.teams.length;
    if (n === 16) return 'Runde 1: 4 Gruppen à 4 · Runde 2: Gold (1.+2.) und Silber (3.+4.) mit je 2 Gruppen à 4 · danach Playoffs: Gold = Plätze 1–8, Silber = Plätze 9–16.';
    var k = n / 32;
    return 'Runde 1: ' + (n / 4) + ' Gruppen à 4 · Runde 2: Gold (alle 1., ' + 2 * k + ' Gruppen), Silber (2.+3., ' + 4 * k + ' Gruppen), Bronze (alle 4., ' + 2 * k + ' Gruppen) · ' +
      'Runde 3: Champions League (' + 2 * k + ' × 5), Europa League (' + 2 * k + ' × 6), Conference League (' + 2 * k + ' × 5) · danach Playoffs. ' +
      'Endstand: CL Plätze 1–' + poSize(t, 'cl') + ', EL ' + (poSize(t, 'cl') + 1) + '–' + (poSize(t, 'cl') + poSize(t, 'el')) + ', Conference ' + (poSize(t, 'cl') + poSize(t, 'el') + 1) + '–' + n + '.';
  }

  function timetable(t) {
    var tl = timeline(t);
    var gm = parseInt(t.config.gameMinutes, 10) || 12;
    var rows = [];
    var multiLoc = locations(t).length > 1;
    rounds(t).forEach(function (r) {
      locations(t).forEach(function (loc) {
        var g = tl.filter(function (x) { return x.round === r && x.loc === loc.id; });
        if (!g.length) return;
        var mins = g.map(function (x) { return x.min; });
        var branches = [];
        g.forEach(function (x) { var n = x.branch === 'r1' ? '' : BRANCHES[x.branch].name; if (n && branches.indexOf(n) < 0) branches.push(n); });
        rows.push({
          label: 'Runde ' + r + (multiLoc ? ' · ' + loc.name : '') + (branches.length ? ' (' + branches.join(', ') + ')' : ''),
          value: (g[0].date ? fmtDate(g[0].date) + ', ' : '') + fromMin(Math.min.apply(null, mins)) + ' – ca. ' + fromMin(Math.max.apply(null, mins) + gm)
        });
      });
    });
    return rows;
  }

  function fmtDate(iso) {
    var p = (iso || '').split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' : iso;
  }

  function validate(t) {
    if (!Array.isArray(t.teams) || SIZES.indexOf(t.teams.length) < 0) return 'Mehrstufig braucht 16, 32 oder 64 Teams.';
    if (!Array.isArray(t.groups) || t.groups.length !== t.teams.length / 4) return 'Gruppeneinteilung fehlt.';
    if (!t.config || !t.config.rounds) return 'Konfiguration fehlt.';
    if (!t.stages) t.stages = { 2: null, 3: null };
    if (!t.po) t.po = {};
    if (!t.results) t.results = {};
    if (!Array.isArray(t.info)) t.info = [];
    if (!t.config.place) t.config.place = defaultPlace();
    return null;
  }

  var api = {
    SIZES: SIZES,
    BRANCHES: BRANCHES,
    blueprint: blueprint,
    branchesOf: branchesOf,
    rounds: rounds,
    groupLabel: groupLabel,
    groupLetter: groupLetter,
    createTournament: createTournament,
    setTeamCount: setTeamCount,
    drawGroups: drawGroups,
    groupsOf: groupsOf,
    timeline: timeline,
    locations: locations,
    locById: locById,
    standings: standings,
    roundProgress: roundProgress,
    branchComplete: branchComplete,
    roundComplete: roundComplete,
    computeStage: computeStage,
    computePo: computePo,
    lockRound: lockRound,
    unlockRound: unlockRound,
    lockPo: lockPo,
    unlockPo: unlockPo,
    poBranches: poBranches,
    poSize: poSize,
    finalRanking: finalRanking,
    structureText: structureText,
    timetable: timetable,
    validate: validate,
    fmtDate: fmtDate,
    hasResultsWithPrefix: hasResultsWithPrefix
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ME = api;
})(this);
