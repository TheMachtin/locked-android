/**
 * Tests für den Berechnungskern (www/calc.js).
 * Ausführen: npm test
 *
 * "now" wird überall injiziert, damit die Fälle rund um den laufenden Tag
 * reproduzierbar bleiben — sonst hinge das Ergebnis an der Uhrzeit des Laufs.
 */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../www/calc.js');

/** Date aus lokaler Zeit — nicht new Date("...Z"), das wäre UTC. */
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0);
const ev = (date, time, type, extra) => Object.assign({ date, time, type }, extra || {});

// --------------------------------------------------------------- Datum/Zeit
test('timeToMin rechnet HH:MM in Minuten', () => {
  assert.strictEqual(C.timeToMin('00:00'), 0);
  assert.strictEqual(C.timeToMin('05:06'), 306);
  assert.strictEqual(C.timeToMin('23:59'), 1439);
});

test('isoOf nutzt lokale Zeit, nicht UTC', () => {
  // 00:30 lokal — toISOString() läge in UTC+X noch im Vortag
  assert.strictEqual(C.isoOf(at(2026, 8, 17, 0, 30)), '2026-08-17');
  assert.strictEqual(C.isoOf(at(2026, 1, 1, 23, 59)), '2026-01-01');
});

test('isoDateAdd überschreitet Monats- und Jahresgrenzen', () => {
  assert.strictEqual(C.isoDateAdd('2026-08-17', 1), '2026-08-18');
  assert.strictEqual(C.isoDateAdd('2026-08-31', 1), '2026-09-01');
  assert.strictEqual(C.isoDateAdd('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(C.isoDateAdd('2026-01-01', -1), '2025-12-31');
  // über die Sommerzeit-Umstellung (DE: 29.03.2026)
  assert.strictEqual(C.isoDateAdd('2026-03-28', 1), '2026-03-29');
  assert.strictEqual(C.isoDateAdd('2026-03-29', 1), '2026-03-30');
});

test('isoWeek liefert ISO-Kalenderwochen', () => {
  assert.strictEqual(C.isoWeek('2026-01-01'), '2026-W01');
  assert.strictEqual(C.isoWeek('2026-08-17'), '2026-W34');
});

// --------------------------------------------------------- computeDayHours
test('computeDayHours füllt ohne Events den ganzen Tag mit dem Startmodell', () => {
  const { hours, endModel } = C.computeDayHours([], 'HT');
  assert.strictEqual(hours.HT, 24);
  assert.strictEqual(hours.KK, 0);
  assert.strictEqual(endModel, 'HT');
});

test('computeDayHours teilt den Tag am Event auf', () => {
  const { hours, endModel } = C.computeDayHours([ev('2026-08-17', '06:00', 'HT')], 'KK');
  assert.strictEqual(hours.KK, 6);
  assert.strictEqual(hours.HT, 18);
  assert.strictEqual(endModel, 'HT');
});

test('computeDayHours ignoriert Orgasmus-Events beim Modellwechsel', () => {
  const { hours, endModel } = C.computeDayHours(
    [ev('2026-08-17', '10:00', 'OR'), ev('2026-08-17', '12:00', 'NS')], 'HT');
  assert.strictEqual(hours.HT, 12);
  assert.strictEqual(hours.NS, 12);
  assert.strictEqual(endModel, 'NS');
});

test('computeDayHours begrenzt auf endMin (laufender Tag)', () => {
  // Käfig 05:06 angelegt, jetzt ist 15:00 → nur bis 15:00 zählen
  const { hours } = C.computeDayHours([ev('2026-08-17', '05:06', 'HT')], 'KK', 15 * 60);
  assert.strictEqual(Math.round(hours.KK * 100) / 100, 5.1);
  assert.strictEqual(Math.round(hours.HT * 100) / 100, 9.9);
  assert.strictEqual(hours.KK + hours.HT, 15); // nichts über die Grenze hinaus
});

test('computeDayHours: Events nach der Grenze zählen nicht, setzen aber das Folgemodell', () => {
  const { hours, endModel } = C.computeDayHours([ev('2026-08-17', '22:00', 'NS')], 'HT', 15 * 60);
  assert.strictEqual(hours.HT, 15);
  assert.strictEqual(hours.NS, 0);
  assert.strictEqual(endModel, 'NS', 'der Folgetag muss mit NS starten');
});

test('computeDayHours mit endMin 0 zählt nichts (Zukunft)', () => {
  const { hours } = C.computeDayHours([ev('2026-08-17', '06:00', 'HT')], 'KK', 0);
  assert.strictEqual(Object.values(hours).reduce((a, b) => a + b, 0), 0);
});

// ------------------------------------------------------------- computeAll
test('computeAll liefert bei leeren Daten leere Struktur', () => {
  const r = C.computeAllFrom({ events: [], days: {} }, { now: at(2026, 8, 17) });
  assert.deepStrictEqual(r.days, []);
  assert.strictEqual(r.totals.tage, 0);
});

test('computeAll überspannt Lücken zwischen Events lückenlos', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-10', '09:00', 'HT')], days: {} },
    { now: at(2026, 8, 17, 12, 0) });
  const dates = r.days.map(d => d.date);
  assert.strictEqual(dates[0], '2026-08-10');
  assert.strictEqual(dates[dates.length - 1], '2026-08-17');
  assert.strictEqual(dates.length, 8);
});

test('computeAll nimmt den heutigen Tag auch ohne Event mit (UTC-Falle)', () => {
  // 00:30 lokal: das UTC-Datum wäre in DE noch der Vortag gewesen
  const r = C.computeAllFrom(
    { events: [ev('2026-08-16', '09:00', 'HT')], days: {} },
    { now: at(2026, 8, 17, 0, 30) });
  assert.ok(r.byDate['2026-08-17'], 'der laufende Tag fehlt in der Berechnung');
});

test('computeAll: Modell läuft über den Tageswechsel weiter', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-15', '20:00', 'NS')], days: {} },
    { now: at(2026, 8, 17, 12, 0) });
  assert.strictEqual(r.byDate['2026-08-16'].hours.NS, 24, 'Folgetag komplett NS');
  assert.strictEqual(r.byDate['2026-08-16'].prevEndModel, 'NS');
});

test('computeAll: laufender Tag zählt nur bis jetzt', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-16', '00:00', 'HT')], days: {} },
    { now: at(2026, 8, 17, 6, 0) });
  assert.strictEqual(r.byDate['2026-08-16'].stundenVerschlossen, 24);
  assert.strictEqual(r.byDate['2026-08-17'].stundenVerschlossen, 6);
});

test('Streaks wachsen nach vortag * 1.07 + basis und brechen beim Orgasmus', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'HT'), ev('2026-08-13', '10:00', 'OR')], days: {} },
    { now: at(2026, 8, 15, 12, 0) });
  const of = d => r.byDate[d].ofStreak;
  assert.strictEqual(Math.round(of('2026-08-10') * 1000) / 1000, 3);          // Basis
  assert.strictEqual(Math.round(of('2026-08-11') * 1000) / 1000, 6.21);       // 3*1.07+3
  assert.strictEqual(of('2026-08-13'), 0, 'Orgasmus setzt die Streak zurück');
  assert.strictEqual(Math.round(of('2026-08-14') * 1000) / 1000, 3);          // startet neu
});

test('Punkte setzen sich aus Streaks, Stunden und Abzügen zusammen', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'HT'), ev('2026-08-10', '20:00', 'OR')], days: {} },
    { now: at(2026, 8, 10, 23, 59) });
  const d = r.byDate['2026-08-10'];
  assert.strictEqual(d.hadOrgasm, true);
  assert.strictEqual(d.orgasmusfrei, false);
  assert.strictEqual(d.ofStreak, 0);
  // Stunden bis 23:59 = 23.983… → *0.5, minus 10 für den Orgasmus
  const erwartet = d.stundenVerschlossen * C.POINTS.hourLocked + C.POINTS.orgasm;
  assert.ok(Math.abs(d.punkte - erwartet) < 1e-9, `${d.punkte} != ${erwartet}`);
});

test('keinKG greift erst über 12 h offen und kostet 5 Punkte', () => {
  const kurz = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'KK'), ev('2026-08-10', '10:00', 'HT')], days: {} },
    { now: at(2026, 8, 11, 12, 0) }).byDate['2026-08-10'];
  assert.strictEqual(kurz.keinKG, false, '10 h offen ist noch kein "nicht verschlossen"');

  const lang = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'KK'), ev('2026-08-10', '13:00', 'HT')], days: {} },
    { now: at(2026, 8, 11, 12, 0) }).byDate['2026-08-10'];
  assert.strictEqual(lang.keinKG, true, '13 h offen zählt als "nicht verschlossen"');
});

test('Overrides schlagen die Auto-Ableitung — auch der Wert false', () => {
  const data = {
    events: [ev('2026-08-10', '10:00', 'OR')],
    days: { '2026-08-10': { orgasmusfrei: true, hoursLocked: 8 } },
  };
  const d = C.computeAllFrom(data, { now: at(2026, 8, 11, 12, 0) }).byDate['2026-08-10'];
  assert.strictEqual(d.orgasmusfrei, true, 'Override gewinnt gegen das OR-Event');
  assert.strictEqual(d.stundenVerschlossen, 8, 'hoursLocked schlägt die Ableitung');
  assert.ok(d.ofStreak > 0, 'Streak läuft trotz Orgasmus weiter');

  const aus = C.computeAllFrom(
    { events: [], days: { '2026-08-10': { orgasmusfrei: false } } },
    { now: at(2026, 8, 11, 12, 0) }).byDate['2026-08-10'];
  assert.strictEqual(aus.orgasmusfrei, false, 'false darf nicht als "nicht gesetzt" gelten');
});

test('Tage mit reiner Flag-Markierung gehen nicht verloren', () => {
  const r = C.computeAllFrom(
    { events: [], days: { '2026-08-10': { keinKG: true } } },
    { now: at(2026, 8, 12, 12, 0) });
  assert.ok(r.byDate['2026-08-10']);
  assert.strictEqual(r.byDate['2026-08-10'].tracked, true);
});

// ---------------------------------------------------------------- Totals
test('Totals zählen Orgasmen inklusive automatisch erzeugter', () => {
  const r = C.computeAllFrom({
    events: [
      ev('2026-08-10', '10:00', 'OR'),
      ev('2026-08-10', '22:00', 'OR'),
      ev('2026-08-11', '12:00', 'OR', { auto_inactivity: true }),
    ], days: {},
  }, { now: at(2026, 8, 12, 12, 0) });
  assert.strictEqual(r.totals.orgasmen, 3);
  assert.strictEqual(r.totals.orgasmenAuto, 1);
  assert.strictEqual(r.totals.tageMitOrgasmus, 2, 'zwei Tage, drei Orgasmen');
});

test('Totals: Punktestand hängt am letzten Tag *mit Eintrag*, nicht am letzten Tag', () => {
  // Dokumentiert bewusst das heutige Verhalten: Tage ohne eigenen Eintrag sammeln
  // sehr wohl Punkte (cumPunkte läuft weiter, Streak und Stunden zählen), gelten
  // aber nicht als "tracked". totals.punkte bleibt deshalb auf dem Stand des
  // letzten Tages mit Eintrag stehen und hinkt dem tatsächlichen Stand hinterher.
  const r = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'HT')], days: {} },
    { now: at(2026, 8, 12, 12, 0) });
  const letzterTag = r.days[r.days.length - 1];
  const letzterMitEintrag = r.days.filter(d => d.tracked).slice(-1)[0];

  assert.strictEqual(r.totals.punkte, letzterMitEintrag.cumPunkte);
  assert.strictEqual(letzterMitEintrag.date, '2026-08-10');
  assert.ok(letzterTag.cumPunkte > r.totals.punkte,
    'der laufende Stand liegt über dem angezeigten Punktestand');
  assert.strictEqual(r.totals.kalendertage, r.days.length);
});

test('Totals: längste Streak wird samt Enddatum festgehalten', () => {
  const r = C.computeAllFrom(
    { events: [ev('2026-08-10', '00:00', 'HT'), ev('2026-08-14', '10:00', 'OR')], days: {} },
    { now: at(2026, 8, 20, 12, 0) });
  assert.strictEqual(r.totals.bestOfStreak.days, 6, '15.–20.08. ist die längere Serie');
  assert.strictEqual(r.totals.bestOfStreak.end, '2026-08-20');
});

test('groupByDay sortiert die Events eines Tages nach Uhrzeit', () => {
  const by = C.groupByDay([
    ev('2026-08-10', '22:00', 'NS'),
    ev('2026-08-10', '06:00', 'HT'),
    ev('2026-08-11', '09:00', 'KK'),
  ]);
  assert.deepStrictEqual(by['2026-08-10'].map(e => e.time), ['06:00', '22:00']);
  assert.strictEqual(by['2026-08-11'].length, 1);
});
