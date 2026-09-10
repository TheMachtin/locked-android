/**
 * Der Zeitraum des Dashboards: welcher Tag gehört zum Ausschnitt, was steht
 * zwischen den Pfeilen, und wohin führt ein Klick darauf.
 *
 * Das sind Aussagen über Daten, kein Aussehen — sie gehören geprüft. Der
 * heikle Teil ist das Blättern an den Rändern: eine Auswahl, die außerhalb der
 * erfassten Spanne steht, muss den Weg zurück behalten.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeZeitraum, zeitraumMatch, zeitraumRange, zeitraumShift, zeitraumLabel,
  zeitraumText, kannBlaettern, ankerBeimWechsel, defaultSkala, quartalOf, ankerOf,
} from '../www/js/ui/zeitraum.js';

const Z = (ebene, anker) => normalizeZeitraum({ ebene, anker }, '2026-09-10');

test('Der Anker rastet auf den Anfang seiner Einheit ein', () => {
  // Sonst zeigte „‹" je nach Klickweg auf verschiedene Nachbarn.
  assert.equal(Z('month', '2026-03-17').anker, '2026-03-01');
  assert.equal(Z('quarter', '2026-08-05').anker, '2026-07-01');
  assert.equal(Z('year', '2026-08-05').anker, '2026-01-01');
  assert.equal(ankerOf('quarter', '2026-12-31'), '2026-10-01');
  assert.equal(quartalOf('2026-01-01'), 1);
  assert.equal(quartalOf('2026-12-31'), 4);
});

test('Unsinn im Speicher ergibt einen benutzbaren Ausschnitt', () => {
  assert.deepEqual(normalizeZeitraum(null, '2026-09-10'), { ebene: 'all', anker: '2026-01-01' });
  assert.equal(normalizeZeitraum({ ebene: 'jahrzehnt' }, '2026-09-10').ebene, 'all');
  assert.equal(normalizeZeitraum({ ebene: 'month', anker: 'gestern' }, '2026-09-10').anker, '2026-09-01');
});

test('Der Ausschnitt trennt genau an seinen Rändern', () => {
  const q = Z('quarter', '2026-08-05');
  assert.deepEqual(zeitraumRange(q), { von: '2026-07-01', bis: '2026-09-30' });
  assert.ok(zeitraumMatch(q, '2026-07-01'));
  assert.ok(zeitraumMatch(q, '2026-09-30'));
  assert.ok(!zeitraumMatch(q, '2026-06-30'));
  assert.ok(!zeitraumMatch(q, '2026-10-01'));
  assert.ok(zeitraumMatch(Z('all'), '1999-01-01'), 'alles heißt alles');
});

test('Februar behält seine Länge, auch im Schaltjahr', () => {
  assert.equal(zeitraumRange(Z('month', '2026-02-10')).bis, '2026-02-28');
  assert.equal(zeitraumRange(Z('month', '2028-02-10')).bis, '2028-02-29');
});

test('Blättern springt um genau eine Einheit', () => {
  assert.equal(zeitraumShift(Z('month', '2026-01-15'), -1).anker, '2025-12-01');
  assert.equal(zeitraumShift(Z('quarter', '2026-01-15'), -1).anker, '2025-10-01');
  assert.equal(zeitraumShift(Z('year', '2026-01-15'), 1).anker, '2027-01-01');
  assert.equal(zeitraumShift(Z('all'), 1).ebene, 'all', 'in „Alles" gibt es nichts zu blättern');
});

test('Die Pfeile sperren am Rand der erfassten Spanne', () => {
  const grenzen = { von: '2026-05-13', bis: '2026-09-10' };
  const sep = Z('month', '2026-09-01');
  assert.ok(kannBlaettern(sep, -1, grenzen));
  assert.ok(!kannBlaettern(sep, 1, grenzen), 'in die Zukunft gibt es nichts zu sehen');
  assert.ok(!kannBlaettern(Z('month', '2026-05-01'), -1, grenzen));
});

test('Eine Auswahl außerhalb der Daten behält den Weg zurück', () => {
  // Sonst klemmt sie in einem leeren Monat fest, in dem beide Pfeile grau sind.
  const grenzen = { von: '2026-05-13', bis: '2026-09-10' };
  const jan = Z('month', '2026-01-15');
  assert.ok(kannBlaettern(jan, 1, grenzen), 'vorwärts führt zu den Daten hin');
  assert.ok(!kannBlaettern(jan, -1, grenzen), 'rückwärts führt weiter weg');
  const dez = Z('month', '2026-12-15');
  assert.ok(kannBlaettern(dez, -1, grenzen));
  assert.ok(!kannBlaettern(dez, 1, grenzen));
});

test('Feiner werden heißt: derselbe Zeitpunkt, kleinerer Ausschnitt', () => {
  const heute = '2026-09-10';
  const jahr = Z('year', '2026-01-01');
  assert.equal(ankerBeimWechsel(jahr, 'quarter', heute), heute, 'heute liegt in 2026');
  const alt = Z('year', '2024-01-01');
  assert.equal(ankerBeimWechsel(alt, 'quarter', heute), '2024-12-31',
    'außerhalb: der zuletzt betrachtete Rand, nicht der Jahresanfang');
  assert.equal(ankerBeimWechsel(Z('all'), 'year', heute), heute);
});

test('Aufschrift und Unterzeile nennen den Ausschnitt', () => {
  assert.equal(zeitraumLabel(Z('all')), 'Alles');
  assert.equal(zeitraumLabel(Z('year', '2026-05-01')), '2026');
  assert.equal(zeitraumLabel(Z('quarter', '2026-08-05')), 'Q3 2026');
  assert.equal(zeitraumLabel(Z('month', '2026-03-17')), 'Mär 2026');
  assert.equal(zeitraumText(Z('all')), 'seit dem Stichtag');
  assert.equal(zeitraumText(Z('month', '2026-03-17')), 'im März 2026');
});

test('Die Auflösung passt zur Ebene', () => {
  // Ein Monat in Monatsbalken wäre ein einzelner Balken, „alles" in Tagesbalken
  // wären tausend.
  assert.equal(defaultSkala('month'), 'day');
  assert.equal(defaultSkala('quarter'), 'week');
  assert.equal(defaultSkala('year'), 'month');
  assert.equal(defaultSkala('all'), 'month');
});
