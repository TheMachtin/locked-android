/**
 * Tests für den Sync-Merge (www/merge.js).
 * Der interessante Teil ist die Unterscheidung "gelöscht" vs. "neu angelegt" —
 * die geht nur mit gemeinsamer Basis.
 */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../www/merge.js');

const ev = (date, time, type) => ({ date, time, type });
const keys = list => list.map(M.eventKey).sort();

test('ohne Konflikt bleibt alles erhalten', () => {
  const base = { events: [ev('2026-08-10', '08:00', 'HT')], days: {}, notes: {} };
  const r = M.mergeData(base, base, base);
  assert.strictEqual(r.data.events.length, 1);
});

test('Events beider Geräte werden vereinigt', () => {
  const base   = { events: [ev('2026-08-10', '08:00', 'HT')], days: {}, notes: {} };
  const local  = { events: [ev('2026-08-10', '08:00', 'HT'), ev('2026-08-11', '09:00', 'NS')], days: {}, notes: {} };
  const remote = { events: [ev('2026-08-10', '08:00', 'HT'), ev('2026-08-12', '10:00', 'KK')], days: {}, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(keys(r.data.events),
    keys([ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS'), ev('2026-08-12','10:00','KK')]));
  assert.strictEqual(r.stats.uebernommen, 1, 'ein Event kam vom anderen Gerät');
});

test('lokale Löschung kehrt nicht zurück', () => {
  const base   = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const local  = { events: [ev('2026-08-10','08:00','HT')], days: {}, notes: {} };   // NS gelöscht
  const remote = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(keys(r.data.events), keys([ev('2026-08-10','08:00','HT')]));
  assert.strictEqual(r.stats.entfernt, 1);
});

test('Löschung auf dem anderen Gerät wird übernommen', () => {
  const base   = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const local  = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const remote = { events: [ev('2026-08-10','08:00','HT')], days: {}, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(keys(r.data.events), keys([ev('2026-08-10','08:00','HT')]));
});

test('geänderte Uhrzeit gewinnt gegen den alten Stand', () => {
  const base   = { events: [ev('2026-08-10','08:00','HT')], days: {}, notes: {} };
  const local  = { events: [ev('2026-08-10','09:30','HT')], days: {}, notes: {} };  // korrigiert
  const remote = { events: [ev('2026-08-10','08:00','HT')], days: {}, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(keys(r.data.events), keys([ev('2026-08-10','09:30','HT')]));
});

test('ohne Basis wird konservativ vereinigt (nichts geht verloren)', () => {
  const local  = { events: [ev('2026-08-10','08:00','HT')], days: {}, notes: {} };
  const remote = { events: [ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const r = M.mergeData(null, local, remote);
  assert.strictEqual(r.data.events.length, 2);
  assert.strictEqual(r.stats.basisBekannt, false);
});

test('Ergebnis ist chronologisch sortiert', () => {
  const local  = { events: [ev('2026-08-12','10:00','KK')], days: {}, notes: {} };
  const remote = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-11','09:00','NS')], days: {}, notes: {} };
  const r = M.mergeData(null, local, remote);
  assert.deepStrictEqual(r.data.events.map(e => e.date),
    ['2026-08-10', '2026-08-11', '2026-08-12']);
});

// ------------------------------------------------------------- Flags (days)
test('Flags: jede Seite bringt ihre eigenen Tage ein', () => {
  const base   = { events: [], days: {}, notes: {} };
  const local  = { events: [], days: { '2026-08-10': { keinKG: true } }, notes: {} };
  const remote = { events: [], days: { '2026-08-11': { orgasmusfrei: false } }, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(r.data.days, {
    '2026-08-10': { keinKG: true },
    '2026-08-11': { orgasmusfrei: false },
  });
  assert.deepStrictEqual(r.stats.konflikte, []);
});

test('Flags: unveränderte Seite überschreibt die geänderte nicht', () => {
  const base   = { events: [], days: { '2026-08-10': { hoursLocked: 8 } }, notes: {} };
  const local  = { events: [], days: { '2026-08-10': { hoursLocked: 8 } }, notes: {} };
  const remote = { events: [], days: { '2026-08-10': { hoursLocked: 12 } }, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(r.data.days['2026-08-10'], { hoursLocked: 12 });
});

test('Flags: bei beidseitiger Änderung gewinnt lokal und wird gemeldet', () => {
  const base   = { events: [], days: { '2026-08-10': { hoursLocked: 8 } }, notes: {} };
  const local  = { events: [], days: { '2026-08-10': { hoursLocked: 10 } }, notes: {} };
  const remote = { events: [], days: { '2026-08-10': { hoursLocked: 12 } }, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(r.data.days['2026-08-10'], { hoursLocked: 10 });
  assert.deepStrictEqual(r.stats.konflikte, ['days:2026-08-10']);
});

test('Flags: lokal entfernter Override bleibt entfernt', () => {
  const base   = { events: [], days: { '2026-08-10': { keinKG: true } }, notes: {} };
  const local  = { events: [], days: {}, notes: {} };
  const remote = { events: [], days: { '2026-08-10': { keinKG: true } }, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.strictEqual('2026-08-10' in r.data.days, false);
});

test('Notizen werden genauso zusammengeführt', () => {
  const base   = { events: [], days: {}, notes: {} };
  const local  = { events: [], days: {}, notes: { '2026-08-10': 'lokal' } };
  const remote = { events: [], days: {}, notes: { '2026-08-11': 'remote' } };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(r.data.notes, { '2026-08-10': 'lokal', '2026-08-11': 'remote' });
});

test('realistischer Fall: zwei Geräte, je ein neuer Eintrag, eine Korrektur', () => {
  const base = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-10','20:00','OR')],
                 days: {}, notes: {} };
  // Handy: Orgasmus-Zeit korrigiert + neuer Eintrag
  const local = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-10','21:15','OR'),
                           ev('2026-08-11','07:00','NS')], days: {}, notes: {} };
  // Browser: anderer neuer Eintrag
  const remote = { events: [ev('2026-08-10','08:00','HT'), ev('2026-08-10','20:00','OR'),
                            ev('2026-08-12','06:30','KK')], days: {}, notes: {} };
  const r = M.mergeData(base, local, remote);
  assert.deepStrictEqual(keys(r.data.events), keys([
    ev('2026-08-10','08:00','HT'),
    ev('2026-08-10','21:15','OR'),   // Korrektur erhalten
    ev('2026-08-11','07:00','NS'),   // vom Handy
    ev('2026-08-12','06:30','KK'),   // vom Browser
  ]));
});
