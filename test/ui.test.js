/**
 * Was die Oberfläche rechnet, statt nur anzeigt: die Farbskala des Kalenders
 * und die vier Uhren des Statusblocks. Beides ist frei von DOM und lässt sich
 * deshalb hier prüfen — die Zahlen darin sind Aussagen über die Daten, keine
 * Gestaltung.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { heatScale, heatBand } from '../www/js/ui/charts.js';
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
