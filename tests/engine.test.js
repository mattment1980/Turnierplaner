// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
global.TL = require('../js/logic.js');
const GE = require('../js/engine.js');

function playAll(t, fn) {
  GE.stageGames(t).forEach((g, i) => { t.results[g.id] = fn(g, i); });
}
// stärkeres Team = kleinere Nummer gewinnt
const byStrength = (t) => (g) => {
  const n = id => parseInt(id.slice(1), 10);
  return n(g.home) < n(g.away) ? { h: 2, a: 0 } : { h: 0, a: 2 };
};

test('Rundenturnier: jede Paarung genau einmal, kein Team doppelt pro Runde', () => {
  for (const n of [3, 4, 5, 6, 7, 10]) {
    const ids = Array.from({ length: n }, (_, i) => 't' + i);
    const rounds = GE.roundRobin(ids);
    const pairs = new Set();
    rounds.forEach(r => {
      const seen = new Set();
      r.forEach(([a, b]) => { assert.ok(!seen.has(a) && !seen.has(b)); seen.add(a); seen.add(b); pairs.add([a, b].sort().join('-')); });
    });
    assert.strictEqual(pairs.size, n * (n - 1) / 2, 'n=' + n);
  }
});

test('Liga: einfach und Hin-/Rückrunde', () => {
  const t = GE.createTournament('league', { teamCount: 6 });
  assert.strictEqual(GE.stageGames(t).length, 15);
  t.config.double = true;
  const games = GE.stageGames(t);
  assert.strictEqual(games.length, 30);
  // jede Paarung zweimal, einmal mit vertauschtem Heimrecht
  const key = g => g.home + '>' + g.away;
  const set = new Set(games.map(key));
  games.forEach(g => assert.ok(set.has(g.away + '>' + g.home)));
});

test('Zeitplan: kein Team zweimal im selben Slot, möglichst nicht direkt hintereinander', () => {
  const t = GE.createTournament('groups', { teamCount: 16 });
  t.config.fields = 4;
  const games = GE.stageGames(t);
  const bySlot = {};
  games.forEach(g => (bySlot[g.slot] = bySlot[g.slot] || []).push(g));
  let backToBack = 0;
  Object.keys(bySlot).forEach(s => {
    const teams = bySlot[s].flatMap(g => [g.home, g.away]);
    assert.strictEqual(new Set(teams).size, teams.length);
    assert.ok(bySlot[s].length <= 4);
    const prev = bySlot[s - 1];
    if (prev) {
      const p = new Set(prev.flatMap(g => [g.home, g.away]));
      backToBack += teams.filter(x => p.has(x)).length;
    }
  });
  assert.strictEqual(backToBack, 0, '4 Gruppen à 4 auf 4 Feldern: keine Doppelspiele');
  assert.strictEqual(games.length, 24);
});

test('WM-Format 4x4, 2 weiter: Viertelfinale mit 8, keine Gruppengegner in Runde 1', () => {
  const t = GE.createTournament('groups', { teamCount: 16 });
  assert.strictEqual(t.groups.length, 4);
  playAll(t, byStrength(t));
  const plan = GE.koPlan(t);
  assert.deepStrictEqual([plan.size, plan.fill], [8, 0]);
  t.koSeeds = GE.computeKoSeeds(t);
  assert.strictEqual(t.koSeeds.length, 8);
  const groupOf = id => t.groups.findIndex(g => g.includes(id));
  for (let i = 0; i < 8; i += 2) assert.notStrictEqual(groupOf(t.koSeeds[i]), groupOf(t.koSeeds[i + 1]));
  const ko = GE.koGames(t);
  assert.strictEqual(ko.length, 8, 'VF 4 + HF 2 + Platz 3 + Finale');
  assert.ok(ko.every(g => g.no > 24));
});

test('WM-Format 3 Gruppen, 2 weiter: 2 beste Dritte rücken nach', () => {
  const t = GE.createTournament('groups', { teamCount: 12 });
  GE.setGroupCount(t, 3);
  assert.deepStrictEqual(t.groups.map(g => g.length), [4, 4, 4]);
  const plan = GE.koPlan(t);
  assert.deepStrictEqual([plan.size, plan.direct, plan.fill], [8, 6, 2]);
  playAll(t, byStrength(t));
  t.koSeeds = GE.computeKoSeeds(t);
  const thirds = GE.allStandings(t).map(s => s.rows[2].team);
  const inKo = t.koSeeds.filter(id => thirds.includes(id));
  assert.strictEqual(inKo.length, 2);
});

test('Unterschiedlich große Gruppen (14 Teams = 5+5+4)', () => {
  const t = GE.createTournament('groups', { teamCount: 14 });
  GE.setGroupCount(t, 3);
  assert.deepStrictEqual(t.groups.map(g => g.length), [5, 5, 4]);
  assert.strictEqual(GE.stageGames(t).length, 10 + 10 + 6);
  assert.deepStrictEqual(GE.groupWarnings(t), []);
});

test('Platzierungsmodi und Endstand', () => {
  for (const [mode, games] of [['final', 7], ['third', 8], ['all', 12]]) {
    const t = GE.createTournament('groups', { teamCount: 16 });
    t.config.placement = mode;
    playAll(t, byStrength(t));
    t.koSeeds = GE.computeKoSeeds(t);
    const ko = GE.koGames(t);
    assert.strictEqual(ko.length, games, mode);
    ko.forEach(g => { t.results[g.id] = { h: 1, a: 1, pen: 'h' }; });
    const fr = GE.finalRanking(t);
    assert.strictEqual(fr.places.length, 16);
    assert.ok(fr.places.every(p => p.team), mode + ': alle Plätze belegt');
    assert.strictEqual(new Set(fr.places.map(p => p.team)).size, 16);
    if (mode === 'final') assert.strictEqual(fr.places[3].place, 3, 'Halbfinal-Verlierer teilen Platz 3');
    if (mode === 'all') assert.deepStrictEqual(fr.places.slice(0, 8).map(p => p.place), [1, 2, 3, 4, 5, 6, 7, 8]);
  }
});

test('Liga mit K.-o. (Top 4) und ohne', () => {
  const t = GE.createTournament('league', { teamCount: 8 });
  assert.strictEqual(GE.hasKo(t), false);
  playAll(t, byStrength(t));
  let fr = GE.finalRanking(t);
  assert.strictEqual(fr.places[0].team, 't1');
  assert.strictEqual(fr.provisional, false);
  t.config.koSize = 4;
  t.koSeeds = GE.computeKoSeeds(t);
  assert.deepStrictEqual(t.koSeeds, ['t1', 't4', 't2', 't3']);
  const ko = GE.koGames(t);
  assert.strictEqual(ko.length, 4);
  ko.forEach(g => { t.results[g.id] = { h: 0, a: 3 }; }); // Außenseiter gewinnen
  fr = GE.finalRanking(t);
  assert.strictEqual(fr.places.length, 8);
  assert.ok(fr.places.every(p => p.team));
  assert.strictEqual(fr.places[4].team, 't5', 'Plätze 5–8 aus der Ligatabelle');
});

test('Teamanzahl ändern und Teams verschieben', () => {
  const t = GE.createTournament('groups', { teamCount: 12 });
  GE.setTeamCount(t, 15);
  assert.strictEqual(t.teams.length, 15);
  assert.strictEqual(t.groups.flat().length, 15);
  GE.setTeamCount(t, 10);
  assert.strictEqual(t.groups.flat().length, 10);
  const id = t.groups[0][0];
  GE.moveTeam(t, id, 1);
  assert.ok(t.groups[1].includes(id));
  t.results['x'] = { h: 1, a: 0 };
  assert.strictEqual(GE.setTeamCount(t, 12), false, 'nach Ergebnissen gesperrt');
});

test('Zeitplan K.-o. beginnt nach der Gruppenphase', () => {
  const t = GE.createTournament('groups', { teamCount: 16 });
  const games = GE.stageGames(t);
  const ko = GE.koGames(t, games);
  const lastGroup = games[games.length - 1].time;
  assert.ok(ko[0].time > lastGroup);
  const tt = GE.timetable(t);
  assert.ok(tt[0].value.startsWith('09:00'));
});
