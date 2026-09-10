/**
 * Was die Oberfläche rechnet, statt nur anzeigt: die Farbskala des Kalenders
 * und die vier Uhren des Statusblocks. Beides ist frei von DOM und lässt sich
 * deshalb hier prüfen — die Zahlen darin sind Aussagen über die Daten, keine
 * Gestaltung.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { heatScale, heatBand, aggregatePeriods } from '../www/js/ui/charts.js';
import { statusContext, statusItems } from '../www/js/ui/status.js';
import { computeAll } from '../www/js/core/calc.js';
import { normalizeSettings } from '../www/js/core/settings.js';

const S = () => normalizeSettings(null);
const ev = (date, time, type) => ({ date, time, type });
const zeichenVon = (netto, scale) => heatBand(netto, scale).zeichen;

test('Kalenderskala: die Schwellen kommen aus den eigenen Sätzen', () => {
  const scale = heatScale(S());
  // Standard: 24 h × 0,5 = 12 („voll"), (12 + 7) × 2 = 38 („best"),
  // „+++" auf halbem Weg dazwischen.
  assert.equal(scale[3].bis, 12, 'ein ganzer verschlossener Tag beendet das Band „+"');
  assert.equal(scale[4].bis, 25);
  assert.equal(scale[0].bis, -12);
});

test('Kalenderskala: ein ganzer verschlossener Tag mit Strecke ist „++"', () => {
  const s = S();
  const scale = heatScale(s);
  // Der achte Tag am Stück: 24 h × 0,5 plus gedeckelter Zuschlag von 7.
  assert.equal(zeichenVon(24 * 0.5 + 7, scale), '++');
  assert.equal(zeichenVon(12, scale), '++', 'genau ein voller Tag ist schon „++"');
  assert.equal(zeichenVon(11, scale), '+');
  assert.equal(zeichenVon(30, scale), '+++', 'erst mit Multiplikator wird es „+++"');
  assert.equal(zeichenVon(2, scale), '0');
  assert.equal(zeichenVon(-1, scale), '−');
  assert.equal(zeichenVon(-30, scale), '−−');
  assert.equal(heatBand(null, scale), null, 'nichts erfasst hat keine Farbe');
});

test('Kalenderskala: halbierter Satz halbiert die Schwellen', () => {
  const s = S();
  for (const m of s.models) if (m.locked) m.rate = 0.25;
  const scale = heatScale(s);
  assert.equal(scale[3].bis, 6);
  assert.equal(zeichenVon(7, scale), '++', 'derselbe Tag bleibt derselbe Tag');
});

test('Statusblock: dieselben Uhren wie die Aufschlüsselung sie bezahlt', () => {
  const s = S();
  const events = [ev('2026-03-01', '08:00', 'HT'), ev('2026-02-25', '10:00', 'OR')];
  const now = new Date('2026-03-09T08:00:00');
  const { days, byDate, settings } = computeAll({ events, settings: s }, { now });
  const items = statusItems(statusContext('2026-03-09', { days, byDate, settings, events, now }));

  const [verschlossen, ungeoeffnet, orgasmusfrei, mult] = items;
  assert.equal(verschlossen.days, 8, 'acht vollendete 24-h-Abschnitte am Käfig');
  assert.equal(ungeoeffnet.days, 8, 'ohne Wechsel läuft die Strecke gleich lang');
  assert.equal(orgasmusfrei.days, 12, 'der laufende Tag zählt mit');
  // Der Multiplikator des Tages kennt nur die Tage *davor* — elf, nicht zwölf.
  assert.equal(mult.text, '× 1,22');
  assert.match(ungeoeffnet.since, /^\+7 heute/, 'der Zuschlag steht an der Strecke');
});

test('Statusblock: offen ist offen, auch mitten in einer Reinigung', () => {
  const s = S();
  const events = [ev('2026-03-01', '08:00', 'KK')];
  const now = new Date('2026-03-02T08:00:00');
  const { days, byDate, settings } = computeAll({ events, settings: s }, { now });
  const items = statusItems(statusContext('2026-03-02', { days, byDate, settings, events, now }));
  assert.equal(items[0].days, 0);
  assert.equal(items[0].since, 'gerade offen');
  assert.equal(items[1].since, 'gerade offen');
});


// =========================== JE ZEITRAUM ===========================
test('Die Zusammenfassung je Zeitraum zählt dieselben Tage zusammen', () => {
  const s = S();
  const events = [
    ev('2026-01-05', '08:00', 'HT'),
    ev('2026-01-20', '09:00', 'KK'),
    ev('2026-01-20', '21:00', 'OR'),
    ev('2026-01-21', '07:00', 'NS'),
    ev('2026-02-14', '21:00', 'OR'),
  ];
  const now = new Date('2026-02-20T12:00:00');
  const { days } = computeAll({ events, settings: s }, { now });

  const monate = aggregatePeriods(days, 'month');
  assert.deepEqual(monate.map(m => m.key), ['2026-01', '2026-02']);
  assert.equal(monate[0].orgasmen, 1);
  assert.equal(monate[1].orgasmen, 1);
  // Die Summe über alle Zeiträume ist die Summe über alle Tage — sonst fiele
  // ein Tag zwischen zwei Balken heraus.
  const summe = monate.reduce((a, m) => a + m.netto, 0);
  const direkt = days.filter(d => d.zaehlt).reduce((a, d) => a + d.netto, 0);
  assert.ok(Math.abs(summe - direkt) < 1e-9);
  assert.equal(monate.reduce((a, m) => a + m.tage, 0), days.filter(d => d.zaehlt).length);
});

test('Der erste erfasste Orgasmus hat keinen Abstand und zieht keinen Schnitt herunter', () => {
  const s = S();
  const events = [
    ev('2026-01-05', '08:00', 'HT'),
    ev('2026-01-10', '21:00', 'OR'),   // der erste: Abstand unendlich
    ev('2026-02-09', '21:00', 'OR'),   // 30 Tage später
  ];
  const { days } = computeAll({ events, settings: s }, { now: new Date('2026-02-20T12:00:00') });
  const [jan, feb] = aggregatePeriods(days, 'month');
  assert.equal(jan.abstand, null, 'ohne Vorgänger gibt es keinen Abstand zu mitteln');
  assert.ok(Math.abs(feb.abstand - 30) < 0.01);
});

test('Wochen und Tage schneiden denselben Bestand anders auf', () => {
  const s = S();
  const events = [ev('2026-01-05', '08:00', 'HT'), ev('2026-01-20', '09:00', 'KK')];
  const { days } = computeAll({ events, settings: s }, { now: new Date('2026-01-25T12:00:00') });
  const tage = aggregatePeriods(days, 'day');
  const wochen = aggregatePeriods(days, 'week');
  assert.equal(tage.length, days.filter(d => d.zaehlt).length);
  assert.ok(wochen.length < tage.length);
  assert.equal(wochen.reduce((a, w) => a + w.tage, 0), tage.length);
  assert.ok(wochen[0].label.startsWith('KW'));
});
