/**
 * Was die Oberfläche rechnet, statt nur anzeigt: die Farbskala des Kalenders
 * und die vier Uhren des Statusblocks. Beides ist frei von DOM und lässt sich
 * deshalb hier prüfen — die Zahlen darin sind Aussagen über die Daten, keine
 * Gestaltung.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  heatScale, heatBand, aggregatePeriods, mittlererAbstand, kalenderMonate, heatmap, tragezeitBalken,
  vortagsLauf, dayTimeline,
} from '../www/js/ui/charts.js';
import { statusContext, statusItems, statusKompakt } from '../www/js/ui/status.js';
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

test('Die Kachel „Orgasmusfrei" läuft über ein Ereignis hinweg, das keiner ist', () => {
  const settings = normalizeSettings({
    models: [
      { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'KK', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
      { id: 'OR', kind: 'orgasm', label: 'Orgasmus', priceMin: 15, priceMax: 60 },
      { id: 'EM', kind: 'orgasm', label: 'Erguss', priceMin: 8, priceMax: 8, streakFactor: 1 },
    ],
  });
  const now = new Date('2026-03-13T12:00:00');
  const events = [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-09', '21:00', 'EM')];
  const { days, byDate } = computeAll({ events, settings }, { now });
  const [, , orgasmusfrei, mult] =
    statusItems(statusContext('2026-03-13', { days, byDate, settings, events, now }));

  assert.equal(orgasmusfrei.days, 13, 'die Strecke reißt am 9. nicht ab');
  assert.equal(orgasmusfrei.since, 'keiner erfasst', 'ein Erguss ist kein letzter Orgasmus');
  assert.equal(mult.text, '× 1,24', 'zwölf Tage davor, ungebrochen');
});

test('Der Erguss steht nicht in den Orgasmus-Balken', () => {
  const settings = normalizeSettings({
    models: [
      { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'KK', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
      { id: 'OR', kind: 'orgasm', label: 'Orgasmus', priceMin: 15, priceMax: 60 },
      { id: 'EM', kind: 'orgasm', label: 'Erguss', priceMin: 8, priceMax: 8, streakFactor: 1 },
    ],
  });
  const events = [ev('2026-01-05', '08:00', 'HT'),
    ev('2026-01-10', '12:00', 'EM'), ev('2026-01-20', '12:00', 'OR')];
  const { days } = computeAll({ events, settings }, { now: new Date('2026-01-31T12:00:00') });
  const [jan] = aggregatePeriods(days, 'month');
  assert.equal(jan.orgasmen, 1);
  assert.equal(jan.abstand, null, 'der Erguss ist kein Vorgänger, zu dem sich ein Abstand messen ließe');
});


// =========================== HEUTE: DIE DREI UHREN ===========================
test('Die Zeile oben zeigt dieselben Uhren wie die Kacheln, nur kürzer', () => {
  const s = S();
  const events = [ev('2026-03-01', '08:00', 'HT'), ev('2026-02-25', '10:00', 'OR')];
  const now = new Date('2026-03-09T14:30:00');
  const { days, byDate, settings } = computeAll({ events, settings: s }, { now });
  const ctx = statusContext('2026-03-09', { days, byDate, settings, events, now });
  const [verschl, ungeoeffnet, ofrei] = statusKompakt(ctx);

  assert.equal(verschl.wert, '8 T 6 h', '„8 T 6 h" statt „8 T (198 h)"');
  assert.equal(verschl.label, 'verschlossen');
  assert.equal(ungeoeffnet.wert, '8 T 6 h');
  assert.equal(ungeoeffnet.zusatz, '+7 heute', 'der Zuschlag steht an der Strecke, die ihn bringt');
  assert.equal(ofrei.wert, '12 T');
  assert.equal(ofrei.zusatz, statusItems(ctx)[3].text, 'der Multiplikator kommt aus derselben Rechnung');
  assert.match(ofrei.deckel, /Deckel/);
});

test('Offen heißt in der Zeile: keine Dauer, sondern „gerade offen"', () => {
  const s = S();
  const events = [ev('2026-03-01', '08:00', 'KK')];
  const now = new Date('2026-03-02T08:00:00');
  const { days, byDate, settings } = computeAll({ events, settings: s }, { now });
  const [verschl, ungeoeffnet] = statusKompakt(statusContext('2026-03-02', { days, byDate, settings, events, now }));
  assert.equal(verschl.wert, '—');
  assert.equal(verschl.label, 'gerade offen');
  assert.equal(ungeoeffnet.wert, '—');
});

test('Während einer Reinigung läuft „verschlossen" weiter und sagt, warum', () => {
  const s = S();
  const events = [ev('2026-03-01', '08:00', 'HT'), ev('2026-03-02', '07:50', 'CLEAN')];
  const now = new Date('2026-03-02T08:00:00');
  const { days, byDate, settings } = computeAll({ events, settings: s }, { now });
  const [verschl] = statusKompakt(statusContext('2026-03-02', { days, byDate, settings, events, now }));
  assert.equal(verschl.label, 'verschlossen');
  assert.equal(verschl.zusatz, 'Reinigung');
  assert.equal(verschl.wert, '1 T 0 h');
});

// =========================== HEUTE: WAS VOM VORTAG LÄUFT ===========================
test('Nach einem Wechsel am Morgen steht das Modell vom Vortag weiter in der Liste', () => {
  const s = S();
  const events = [ev('2026-03-01', '21:00', 'HT'), ev('2026-03-02', '07:30', 'NS')];
  const { byDate, settings } = computeAll({ events, settings: s }, { now: new Date('2026-03-02T12:00:00') });
  const tag = byDate['2026-03-02'];

  assert.deepEqual(vortagsLauf(tag, settings), { id: 'HT', bis: 450 });
  // Die Zeile beschreibt das erste Stück des Balkens — dieselbe Strecke, sonst
  // stünde unter dem Balken etwas anderes, als er zeigt.
  assert.match(dayTimeline(tag, settings, 720), /<title>Holy Trainer 00:00–07:30<\/title>/);
});

test('Ohne Wechsel läuft das Modell vom Vortag durch — ein Orgasmus ist kein Wechsel', () => {
  const s = S();
  const events = [ev('2026-03-01', '21:00', 'HT'), ev('2026-03-02', '06:00', 'OR'),
    ev('2026-03-03', '06:00', 'OR'), ev('2026-03-03', '09:15', 'KK')];
  const { byDate, settings } = computeAll({ events, settings: s }, { now: new Date('2026-03-04T12:00:00') });

  assert.deepEqual(vortagsLauf(byDate['2026-03-02'], settings), { id: 'HT', bis: 1440 });
  assert.deepEqual(vortagsLauf(byDate['2026-03-03'], settings), { id: 'HT', bis: 555 },
    'der Orgasmus um 06:00 beendet den Lauf nicht, der Wechsel um 09:15 schon');
  assert.deepEqual(vortagsLauf(byDate['2026-03-04'], settings), { id: 'KK', bis: 1440 });
});

test('Ein Wechsel um 00:00 lässt vom Vortag nichts übrig', () => {
  const s = S();
  const events = [ev('2026-03-01', '21:00', 'HT'), ev('2026-03-02', '00:00', 'NS')];
  const { byDate, settings } = computeAll({ events, settings: s }, { now: new Date('2026-03-02T12:00:00') });
  assert.equal(vortagsLauf(byDate['2026-03-02'], settings), null);
});

// =========================== VERLAUF ===========================
test('Der mittlere Abstand zählt den ersten Orgasmus nicht als 0', () => {
  const s = S();
  const events = [
    ev('2026-01-05', '08:00', 'HT'),
    ev('2026-01-10', '21:00', 'OR'),
    ev('2026-02-09', '21:00', 'OR'),
    ev('2026-02-19', '21:00', 'OR'),
  ];
  const { days } = computeAll({ events, settings: s }, { now: new Date('2026-02-20T12:00:00') });
  assert.ok(Math.abs(mittlererAbstand(days) - 20) < 0.01, '(30 + 10) / 2');
  const nurJanuar = days.filter(d => d.date < '2026-02-01');
  assert.equal(mittlererAbstand(nurJanuar), null, 'ein einzelner Orgasmus hat keinen Abstand');
});

test('Der Kalender zeigt nur die Monate vom ersten bis zum letzten mit Daten', () => {
  assert.deepEqual(kalenderMonate(['2026-08-14', '2026-10-02', '2026-09-01']), { von: 7, bis: 9 });
  const s = S();
  const events = [ev('2026-08-14', '08:00', 'HT')];
  const { days, settings } = computeAll({ events, settings: s }, { now: new Date('2026-10-02T12:00:00') });
  const zellen = (heatmap(days, settings).match(/class="hm-cell"/g) || []).length;
  assert.equal(zellen, 31 + 30 + 31, 'August bis Oktober, nicht das ganze Jahr');
});

test('Die Tragezeit als Balken: Anteile in der Reihenfolge der Stunden', () => {
  const s = S();
  const { html, gesamt } = tragezeitBalken({ HT: 30, NS: 10, OR: 5 }, s);
  assert.equal(gesamt, 40, 'ein Ereignis hat keine Tragezeit');
  assert.ok(html.indexOf('width:75.00%') < html.indexOf('width:25.00%'), 'der größere Anteil zuerst');
  assert.equal(tragezeitBalken({}, s).gesamt, 0);
});
