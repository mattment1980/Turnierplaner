// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
global.TL = require('../js/logic.js');
global.GE = require('../js/engine.js');
const ME = require('../js/multi.js');

const num = id => parseInt(id.slice(1), 10);
// Stärkeres Team (kleinere Nummer) gewinnt 2:0
function playRound(t, r) {
  ME.timeline(t).filter(g => g.round === r && !g.isKo && g.home).forEach(g => {
    t.results[g.id] = num(g.home) < num(g.away) ? { h: 2, a: 0 } : { h: 0, a: 2 };
  });
}
function playPo(t, branch) {
  for (let i = 0; i < 6; i++) {
    ME.timeline(t).filter(g => g.isKo && g.branch === branch && g.home && g.away && !t.results[g.id]).forEach(g => {
      t.results[g.id] = num(g.home) < num(g.away) ? { h: 1, a: 1, pen: 'h' } : { h: 0, a: 1 };
    });
  }
}
function allPairs(groups) {
  const s = new Set();
  groups.forEach(g => g.forEach((a, i) => g.slice(i + 1).forEach(b => s.add([a, b].sort().join('-')))));
  return s;
}

test('16 Teams: Gold/Silber, Playoffs, Endstand 1–16', () => {
  const t = ME.createTournament({ teamCount: 16 });
  assert.strictEqual(ME.timeline(t).filter(g => g.round === 1).length, 24);
  playRound(t, 1);
  assert.ok(ME.lockRound(t, 2));
  assert.deepStrictEqual(t.stages[2].gold.map(g => g.length), [4, 4]);
  // Gold = alle 1. und 2.
  const r1 = t.groups.map((_, g) => ME.standings(t, 1, 'r1', g).rows.map(r => r.team));
  const top2 = new Set(r1.flatMap(r => r.slice(0, 2)));
  t.stages[2].gold.flat().forEach(id => assert.ok(top2.has(id)));
  // je Gold-Gruppe 2 Erste + 2 Zweite, keine Wiederholungsspiele aus Runde 1
  const r1pairs = allPairs(t.groups);
  t.stages[2].gold.forEach(g => {
    assert.strictEqual(g.filter(id => r1.some(r => r[0] === id)).length, 2);
    g.forEach((a, i) => g.slice(i + 1).forEach(b => assert.ok(!r1pairs.has([a, b].sort().join('-')), 'Wiederholungsspiel ' + a + '-' + b)));
  });
  playRound(t, 2);
  ['gold', 'silver'].forEach(b => { assert.ok(ME.lockPo(t, b)); playPo(t, b); });
  const po = ME.timeline(t).filter(g => g.isKo);
  assert.strictEqual(po.length, 16, 'je Ast 2 HF + F + P3 + 2 HF(5–8) + P5 + P7');
  const fr = ME.finalRanking(t);
  assert.strictEqual(fr.places.length, 16);
  assert.ok(fr.places.every(p => p.team));
  assert.strictEqual(new Set(fr.places.map(p => p.team)).size, 16);
  assert.strictEqual(fr.places[0].team, 't1');
  // jedes Team: 3 + 3 + 2 Spiele
  const count = {};
  ME.timeline(t).forEach(g => { [g.home, g.away].forEach(x => { if (x) count[x] = (count[x] || 0) + 1; }); });
  Object.values(count).forEach(c => assert.strictEqual(c, 8));
});

test('32 Teams: Runde 2/3 Zusammensetzung, Playoffs, Endstand 1–32', () => {
  const t = ME.createTournament({ teamCount: 32 });
  playRound(t, 1);
  ME.lockRound(t, 2);
  assert.deepStrictEqual([t.stages[2].gold.length, t.stages[2].silver.length, t.stages[2].bronze.length], [2, 4, 2]);
  // Silber: jede Gruppe 2× Zweiter + 2× Dritter
  const r1 = t.groups.map((_, g) => ME.standings(t, 1, 'r1', g).rows.map(r => r.team));
  const rankOf = id => r1.find(r => r.includes(id)).indexOf(id);
  t.stages[2].silver.forEach(g => assert.deepStrictEqual(g.map(rankOf).sort(), [1, 1, 2, 2]));
  playRound(t, 2);
  ME.lockRound(t, 3);
  assert.deepStrictEqual(t.stages[3].cl.map(g => g.length), [5, 5]);
  assert.deepStrictEqual(t.stages[3].el.map(g => g.length), [6, 6]);
  assert.deepStrictEqual(t.stages[3].conf.map(g => g.length), [5, 5]);
  // Gold-Vierte in der Europa League
  const gold4 = t.stages[2].gold.map((_, g) => ME.standings(t, 2, 'gold', g).rows[3].team);
  gold4.forEach(id => assert.ok(t.stages[3].el.flat().includes(id)));
  assert.strictEqual(new Set([...t.stages[3].cl.flat(), ...t.stages[3].el.flat(), ...t.stages[3].conf.flat()]).size, 32);
  playRound(t, 3);
  ['cl', 'el', 'conf'].forEach(b => { assert.ok(ME.lockPo(t, b)); playPo(t, b); });
  // CL: QF 1A–4B usw.
  const cl = t.stages[3].cl.map((_, g) => ME.standings(t, 3, 'cl', g).rows.map(r => r.team));
  assert.deepStrictEqual(t.po.cl[0].slice(0, 2), [cl[0][0], cl[1][3]]);
  const fr = ME.finalRanking(t);
  assert.strictEqual(fr.places.length, 32);
  assert.ok(fr.places.every(p => p.team), 'alle 32 Plätze belegt');
  assert.strictEqual(new Set(fr.places.map(p => p.team)).size, 32);
  assert.strictEqual(fr.places[10].branch, 'el');
  assert.strictEqual(fr.places[22].branch, 'conf');
  const po = ME.timeline(t).filter(g => g.isKo);
  assert.strictEqual(po.filter(g => g.branch === 'cl').length, 13, 'CL: QF4 + HF2 + F + P3 + HF5–8 2 + P5 + P7 + P9');
  assert.strictEqual(po.filter(g => g.branch === 'el').length, 8, 'EL: HF2 + F + P3 + 4 Platzierungsspiele');
});

test('64 Teams: Gruppenzahlen und jeder hat mindestens 2 Playoff-Spiele', () => {
  const t = ME.createTournament({ teamCount: 64 });
  playRound(t, 1); ME.lockRound(t, 2);
  assert.deepStrictEqual(['gold', 'silver', 'bronze'].map(b => t.stages[2][b].length), [4, 8, 4]);
  playRound(t, 2); ME.lockRound(t, 3);
  assert.deepStrictEqual(['cl', 'el', 'conf'].map(b => t.stages[3][b].map(g => g.length).join('')), ['5555', '6666', '5555']);
  playRound(t, 3);
  ['cl', 'el', 'conf'].forEach(b => { ME.lockPo(t, b); playPo(t, b); });
  const count = {};
  ME.timeline(t).filter(g => g.isKo).forEach(g => [g.home, g.away].forEach(x => { count[x] = (count[x] || 0) + 1; }));
  assert.strictEqual(Object.keys(count).length, 64);
  Object.values(count).forEach(c => assert.ok(c >= 2));
  const fr = ME.finalRanking(t);
  assert.ok(fr.places.every(p => p.team));
  assert.strictEqual(new Set(fr.places.map(p => p.team)).size, 64);
});

test('Mehrere Orte und zwei Tage', () => {
  const t = ME.createTournament({ teamCount: 32 });
  t.config.locations = [{ id: 'L1', name: 'Halle A', fields: 4 }, { id: 'L2', name: 'Halle B', fields: 2 }];
  t.config.place.silver = 'L2';
  t.config.rounds[2] = { date: '2027-01-17', start: '09:00' };
  const tl = ME.timeline(t);
  const r1 = tl.filter(g => g.round === 1);
  assert.ok(r1.some(g => g.loc === 'L1') && r1.some(g => g.loc === 'L2'), 'Runde 1 auf beide Orte verteilt');
  assert.ok(r1.filter(g => g.loc === 'L1').length > r1.filter(g => g.loc === 'L2').length, 'mehr Gruppen am Ort mit mehr Feldern');
  const silver = tl.filter(g => g.round === 2 && g.branch === 'silver');
  assert.ok(silver.every(g => g.loc === 'L2' && g.date === '2027-01-17'));
  assert.strictEqual(silver[0].time, '09:00');
  const gold = tl.filter(g => g.round === 2 && g.branch === 'gold');
  assert.ok(gold.every(g => g.loc === 'L1'));
  // kein Feld doppelt belegt
  const seen = new Set();
  tl.forEach(g => { const k = g.date + g.loc + g.field + g.min; assert.ok(!seen.has(k), 'Feld doppelt: ' + k); seen.add(k); });
  const tt = ME.timetable(t);
  assert.ok(tt.length >= 4);
});
