// Ausführen mit: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../js/logic.js');

function playAll(t, phase, fn) {
  TL.phaseGames(t, phase).forEach((g, i) => { t.results[g.id] = fn(g, i); });
}

test('Spielplan Phase 1 entspricht dem Excel', () => {
  const t = TL.createTournament();
  const games = TL.phaseGames(t, 1);
  assert.strictEqual(games.length, 24);
  const name = id => TL.teamName(t, id);
  // Spiel 1: 9:00, Feld 1, Team 4 vs Team 1
  assert.deepStrictEqual([games[0].time, games[0].field, name(games[0].home), name(games[0].away)], ['09:00', 1, 'Team 4', 'Team 1']);
  // Spiel 5: 9:17 Gruppe 3: Team 12 vs Team 9
  assert.deepStrictEqual([games[4].time, name(games[4].home), name(games[4].away)], ['09:17', 'Team 12', 'Team 9']);
  assert.strictEqual(games[23].time, '10:25');
  // jede Paarung genau einmal
  for (let g = 0; g < 4; g++) {
    const pairs = new Set(games.filter(x => x.group === g).map(x => [x.home, x.away].sort().join('-')));
    assert.strictEqual(pairs.size, 6);
  }
});

test('Tabelle: 3/1/0 Punkte, Sortierung Punkte > TD > Tore', () => {
  const t = TL.createTournament();
  // Gruppe 1: Heimteam gewinnt immer 2:0
  playAll(t, 1, () => ({ h: 2, a: 0 }));
  const tab = TL.standings(t, 1, 0);
  tab.forEach(r => assert.strictEqual(r.sp, 3));
  const total = tab.reduce((s, r) => s + r.pts, 0);
  assert.strictEqual(total, 18);
});

test('Mehr erzielte Tore entscheiden vor direktem Vergleich', () => {
  const t = TL.createTournament();
  const games = TL.phaseGames(t, 1).filter(g => g.group === 0);
  const ids = t.groups1[0]; // t1..t4
  const set = (a, b, ga, gb) => {
    const g = games.find(x => (x.home === a && x.away === b) || (x.home === b && x.away === a));
    t.results[g.id] = g.home === a ? { h: ga, a: gb } : { h: gb, a: ga };
  };
  // t1 und t2 je 6 Punkte, TD +2, aber t2 mehr Tore; t1 schlägt t2 im direkten Vergleich
  set('t1', 't2', 1, 0);
  set('t1', 't3', 1, 0);
  set('t1', 't4', 0, 1);  // t1: 6 P, 2:1 -> TD +1
  set('t2', 't3', 5, 0);
  set('t2', 't4', 0, 3);  // t2: 3 P
  set('t3', 't4', 0, 0);
  let tab = TL.standings(t, 1, 0);
  assert.strictEqual(tab[0].team, 't4'); // 7 Punkte
  // jetzt Gleichstand Punkte/TD, Unterschied nur bei Toren
  t.results = {};
  set('t1', 't2', 2, 2);
  set('t1', 't3', 1, 0);
  set('t2', 't3', 3, 2);
  set('t1', 't4', 0, 0);
  set('t2', 't4', 0, 0);
  set('t3', 't4', 0, 0);
  tab = TL.standings(t, 1, 0);
  // t1: 5 P, 3:2 ; t2: 5 P, 5:4 -> beide TD +1, t2 mehr Tore
  assert.strictEqual(tab[0].team, 't2');
  assert.strictEqual(tab[1].team, 't1');
});

test('Direkter Vergleich bei kompletter Gleichheit', () => {
  const t = TL.createTournament();
  const games = TL.phaseGames(t, 1).filter(g => g.group === 0);
  const set = (a, b, ga, gb) => {
    const g = games.find(x => (x.home === a && x.away === b) || (x.home === b && x.away === a));
    t.results[g.id] = g.home === a ? { h: ga, a: gb } : { h: gb, a: ga };
  };
  set('t1', 't2', 0, 1); // t2 gewinnt direkt
  set('t1', 't3', 1, 0);
  set('t1', 't4', 1, 0);
  set('t2', 't3', 0, 1);
  set('t2', 't4', 1, 0);
  set('t3', 't4', 0, 1);
  // t1: 6P 2:1, t2: 6P 2:1 -> direkter Vergleich t2
  const tab = TL.standings(t, 1, 0);
  assert.strictEqual(tab[0].team, 't2');
  assert.strictEqual(tab[0].note, 'direkter Vergleich');
});

test('Phase 2: neue Gruppen gemischt, Tore/Punkte nur innerhalb der Phase', () => {
  const t = TL.createTournament();
  playAll(t, 1, () => ({ h: 9, a: 0 }));
  t.groups2 = TL.computeGroups2(t);
  // jede neue Gruppe enthält Teams aus 4 verschiedenen alten Gruppen
  const oldGroup = id => t.groups1.findIndex(g => g.includes(id));
  t.groups2.forEach(g => assert.strictEqual(new Set(g.map(oldGroup)).size, 4));
  // alle 16 Teams genau einmal
  assert.strictEqual(new Set(t.groups2.flat()).size, 16);
  // Phase 2 ohne Ergebnisse -> alle 0
  for (let g = 0; g < 4; g++) {
    TL.standings(t, 2, g).forEach(r => {
      assert.strictEqual(r.sp, 0); assert.strictEqual(r.gf, 0); assert.strictEqual(r.pts, 0);
    });
  }
  playAll(t, 2, () => ({ h: 1, a: 1 }));
  for (let g = 0; g < 4; g++) {
    TL.standings(t, 2, g).forEach(r => {
      assert.strictEqual(r.sp, 3); assert.strictEqual(r.gf, 3); assert.strictEqual(r.pts, 3);
    });
  }
});

test('Finalrunde: Paarungen und Endstand 1–16', () => {
  const t = TL.createTournament();
  playAll(t, 1, (g) => ({ h: g.no % 3, a: (g.no + 1) % 3 }));
  t.groups2 = TL.computeGroups2(t);
  playAll(t, 2, (g) => ({ h: (g.no * 7) % 4, a: (g.no * 3) % 4 }));
  t.koSeeds = TL.computeKoSeeds(t);
  let ko = TL.koGames(t);
  assert.strictEqual(ko[0].home, t.koSeeds[0][0]);
  assert.strictEqual(ko[0].away, t.koSeeds[2][1]);
  assert.strictEqual(ko[8].home, null); // Halbfinale noch offen
  // alle Spiele: Heim gewinnt, Spiel ko1 per Neunmeter für Gast
  TL.KO_GAMES.forEach(d => { t.results[d.id] = { h: 2, a: 1 }; });
  t.results.ko1 = { h: 1, a: 1, pen: 'a' };
  ko = TL.koGames(t);
  assert.strictEqual(ko[8].home, t.koSeeds[2][1]); // Gast aus VF1 im HF1
  const ranking = TL.finalRanking(t);
  assert.strictEqual(new Set(ranking.map(r => r.team)).size, 16);
  assert.ok(ranking.every(r => r.team));
  // Unentschieden ohne Neunmeter -> kein Sieger
  t.results.ko17 = { h: 0, a: 0 };
  assert.strictEqual(TL.finalRanking(t)[0].team, null);
});

test('Zeitplan wird aus Spielzeiten berechnet', () => {
  const t = TL.createTournament();
  const tt = TL.timetable(t);
  assert.strictEqual(tt[0].value, '09:00 – ca. 10:37');
  assert.strictEqual(tt[1].value, '11:00 – ca. 12:37');
  t.config.fields = 2;
  const games = TL.phaseGames(t, 1);
  assert.strictEqual(games[23].time, TL.addMinutes('09:00', 11 * 17));
});
