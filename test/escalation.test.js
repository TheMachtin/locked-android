/**
 * Tests für die Inaktivitäts-Vorschläge (www/calc.js).
 * Kernpunkt: es darf nichts geschrieben werden, bevor der Nutzer zugestimmt hat.
 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../www/calc.js');

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0);
const ev = (date, time, type, extra) => Object.assign({ date, time, type }, extra || {});

test('ohne Events gibt es nichts vorzuschlagen', () => {
  const r = C.pendingEscalation({ events: [] }, { now: at(2026, 8, 20) });
  assert.strictEqual(r.faellig, false);
  assert.strictEqual(r.anzahl, 0);
});

test('innerhalb der Frist passiert nichts', () => {
  const r = C.pendingEscalation(
    { events: [ev('2026-08-18', '08:00', 'HT')] },
    { now: at(2026, 8, 21, 7, 0) });   // knapp unter 4 Tagen
  assert.strictEqual(r.faellig, false);
  assert.strictEqual(r.orgasmen.length, 0);
});

test('nach 4 Tagen wird ein KK-Eintrag vorgeschlagen — aber nicht geschrieben', () => {
  const data = { events: [ev('2026-08-10', '08:00', 'HT')] };
  const r = C.pendingEscalation(data, { now: at(2026, 8, 14, 9, 0) });
  assert.strictEqual(r.faellig, true);
  assert.deepStrictEqual(r.kk, { date: '2026-08-14', time: '08:00' });
  assert.strictEqual(data.events.length, 1, 'die Eingabedaten dürfen sich nicht ändern');
});

test('pro Tag nach der Frist kommt ein Orgasmus-Vorschlag dazu', () => {
  const r = C.pendingEscalation(
    { events: [ev('2026-08-10', '08:00', 'HT')] },
    { now: at(2026, 8, 17, 12, 0) });
  assert.deepStrictEqual(r.orgasmen.map(o => o.date),
    ['2026-08-15', '2026-08-16', '2026-08-17']);
  assert.strictEqual(r.anzahl, 4, 'ein KK plus drei Orgasmen');
});

test('bereits übernommene Vorschläge werden nicht doppelt angeboten', () => {
  const r = C.pendingEscalation({ events: [
    ev('2026-08-10', '08:00', 'HT'),
    ev('2026-08-14', '08:00', 'KK', { auto_inactivity: true }),
    ev('2026-08-15', '12:00', 'OR', { auto_inactivity: true }),
  ] }, { now: at(2026, 8, 16, 12, 0) });
  assert.strictEqual(r.kk, null, 'KK ist schon da');
  assert.deepStrictEqual(r.orgasmen.map(o => o.date), ['2026-08-16']);
});

test('automatisch erzeugte Einträge verlängern die Frist nicht', () => {
  // Nur Auto-Einträge nach dem letzten echten → Anker bleibt der echte Eintrag
  const r = C.pendingEscalation({ events: [
    ev('2026-08-10', '08:00', 'HT'),
    ev('2026-08-14', '08:00', 'KK', { auto_inactivity: true }),
  ] }, { now: at(2026, 8, 15, 12, 0) });
  assert.strictEqual(r.anchorMs, new Date('2026-08-10T08:00:00').getTime());
});

test('ein verworfener Vorschlag setzt die Uhr neu', () => {
  const data = {
    events: [ev('2026-08-10', '08:00', 'HT')],
    meta: { escalationDismissedAt: new Date(at(2026, 8, 15, 10, 0)).toISOString() },
  };
  // 2 Tage nach dem Verwerfen: noch nichts fällig, obwohl der Eintrag 7 Tage her ist
  assert.strictEqual(C.pendingEscalation(data, { now: at(2026, 8, 17, 12, 0) }).faellig, false);
  // 5 Tage nach dem Verwerfen: wieder fällig
  assert.strictEqual(C.pendingEscalation(data, { now: at(2026, 8, 20, 12, 0) }).faellig, true);
});

test('escalationEvents markiert alles als automatisch erzeugt', () => {
  const vorschlag = C.pendingEscalation(
    { events: [ev('2026-08-10', '08:00', 'HT')] },
    { now: at(2026, 8, 16, 12, 0) });
  const evs = C.escalationEvents(vorschlag);
  assert.strictEqual(evs.length, vorschlag.anzahl);
  assert.ok(evs.every(e => e.auto_inactivity === true), 'sonst zählen sie später als echt');
  assert.strictEqual(evs[0].type, 'KK');
  assert.ok(evs.slice(1).every(e => e.type === 'OR' && e.time_estimated === true));
});

test('lastRealInteractionMs nimmt den spätesten echten Eintrag', () => {
  const ms = C.lastRealInteractionMs([
    ev('2026-08-10', '08:00', 'HT'),
    ev('2026-08-12', '20:00', 'NS'),
    ev('2026-08-14', '12:00', 'OR', { auto_inactivity: true }),
  ]);
  assert.strictEqual(ms, new Date('2026-08-12T20:00:00').getTime());
});
