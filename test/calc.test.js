import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAll, computeDayHours, scoreDay, lockPhaseStart, currentOrgasmPrice, regenState, expiredRegenEvents }
  from '../www/js/core/calc.js';
import { normalizeSettings, modelMap, defaultSettings, orgasmPrice } from '../www/js/core/settings.js';

const ev = (date, time, type, extra) => ({ date, time, type, ...extra });
const S = () => normalizeSettings(null);
const ctxOf = (s) => ({ settings: s, map: modelMap(s) });

test('Tagesstunden: Zustand läuft aus dem Vortag weiter', () => {
  const s = S();
  const { hours, endModel } = computeDayHours(
    [ev('2026-03-02', '08:00', 'KK'), ev('2026-03-02', '10:00', 'HT')], 'NS', 1440, ctxOf(s));
  assert.equal(hours.NS, 8);
  assert.equal(hours.KK, 2);
  assert.equal(hours.HT, 14);
  assert.equal(endModel, 'HT');
});

test('Tagesstunden: heute zählt nur bis zur Grenze, spätere Events setzen den Folgetag', () => {
  const s = S();
  const { hours, endModel } = computeDayHours(
    [ev('2026-03-02', '20:00', 'KK')], 'HT', 12 * 60, ctxOf(s));
  assert.equal(hours.HT, 12);
  assert.equal(hours.KK ?? 0, 0);
  assert.equal(endModel, 'KK', 'das spätere Event bestimmt trotzdem den Startzustand von morgen');
});

test('Tageswertung: Einnahmen mal Multiplikator, Kosten unmultipliziert', () => {
  const s = S();
  const r = scoreDay({ HT: 24 }, [], 50, ctxOf(s), true);
  assert.equal(r.verschlossenH, 24);
  assert.equal(r.offenH, 0);
  assert.equal(r.mult, 2, 'Deckel bei 2,0 ist nach 50 Tagen erreicht');
  assert.equal(r.bonus, 5);
  assert.equal(r.einnahmen, (24 * 0.5 + 5) * 2);
  assert.equal(r.kosten, 0);
});

test('Tageswertung: offene Stunden kosten, Bonus entfällt', () => {
  const s = S();
  const r = scoreDay({ HT: 12, KK: 12 }, [], 0, ctxOf(s), true);
  assert.equal(r.stundenKosten, 12, 'KK kostet 1 Punkt je Stunde');
  assert.equal(r.bonus, 0);
  assert.equal(r.netto, 12 * 0.5 - 12);
});

test('Tageswertung: kurze Öffnung behält den Bonus', () => {
  const s = S();
  const r = scoreDay({ HT: 23.5, CLEAN: 0.5 }, [], 0, ctxOf(s), true);
  assert.equal(r.durchgehend, true, 'unter der Schwelle von 1 h');
  assert.equal(r.stundenKosten, 0, 'Reinigung kostet nichts');
  assert.equal(r.bonus, 5);
});

test('Der Streak-Multiplikator ist gedeckelt und wächst nicht exponentiell', () => {
  const s = S();
  const werte = [0, 10, 50, 100, 365, 3650].map(n => scoreDay({ HT: 24 }, [], n, ctxOf(s), true).mult);
  assert.deepEqual(werte, [1, 1.2, 2, 2, 2, 2]);
});

test('Orgasmus-Preis fällt mit der Wartezeit und bleibt zwischen Min und Max', () => {
  const or = defaultSettings().models.find(m => m.id === 'OR');
  const p0 = orgasmPrice(or, 0, 1);
  const p7 = orgasmPrice(or, 7, 1);
  const p30 = orgasmPrice(or, 30, 1);
  assert.equal(p0, 60);
  assert.equal(p7, 37.5, 'nach einer Halbwertszeit die halbe Spanne');
  assert.ok(p30 < p7 && p30 > or.priceMin);
  assert.equal(orgasmPrice(or, Infinity, 1), or.priceMin, 'ohne Vorgänger der Mindestpreis');
});

test('Durchlauf: Konto läuft mit, Form-Wert klingt ab', () => {
  const now = new Date('2026-03-10T23:59:00');
  const data = { events: [ev('2026-03-01', '00:00', 'HT')] };
  const { days, totals } = computeAll(data, { now });
  assert.equal(days.length, 10);
  assert.ok(days.every(d => d.verschlossenH > 23));
  // Konto ist die Summe der Nettos
  const summe = days.reduce((s, d) => s + d.netto, 0);
  assert.ok(Math.abs(totals.konto - summe) < 1e-9);
  // Form liegt unter dem Konto, weil ältere Tage abklingen
  assert.ok(totals.form < totals.konto);
});

test('Durchlauf: der Form-Wert läuft gegen einen Grenzwert statt zu explodieren', () => {
  const now = new Date('2029-01-01T23:59:00');
  const data = { events: [ev('2026-01-01', '00:00', 'HT')] };
  const { totals, days } = computeAll(data, { now });
  assert.ok(days.length > 1000);
  // Fixpunkt: tagesnetto / (1 − decay). Bei 34/Tag und 0,97 sind das ~1133.
  assert.ok(totals.form > 1000 && totals.form < 1200, `Form war ${totals.form}`);
});

test('Durchlauf: vor dem Stichtag zählt nichts ins Konto', () => {
  const now = new Date('2026-03-10T23:59:00');
  const data = { settings: { startedAt: '2026-03-05' }, events: [ev('2026-03-01', '00:00', 'HT')] };
  const { byDate, totals } = computeAll(data, { now });
  assert.equal(byDate['2026-03-01'].zaehlt, false);
  assert.equal(byDate['2026-03-01'].netto, 0);
  assert.ok(byDate['2026-03-01'].verschlossenH > 23, 'Stunden werden trotzdem erfasst');
  assert.equal(byDate['2026-03-05'].zaehlt, true);
  assert.equal(totals.kalendertage, 6);
});

test('Durchlauf: zwei Orgasmen am selben Tag kosten beide, der zweite fast den Höchstpreis', () => {
  const now = new Date('2026-03-02T23:59:00');
  const data = {
    events: [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-02', '10:00', 'OR'), ev('2026-03-02', '13:00', 'OR')],
  };
  const { byDate } = computeAll(data, { now });
  const d = byDate['2026-03-02'];
  assert.equal(d.orgasmen.length, 2);
  assert.ok(d.orgasmen[1].price > 55, 'drei Stunden Abstand → nahe am Höchstpreis');
  assert.ok(d.orgasmKosten > 70);
  assert.ok(d.netto < 0);
});

test('Durchlauf: heutige Orgasmen in der Zukunft kosten noch nichts', () => {
  const now = new Date('2026-03-02T09:00:00');
  const data = { events: [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-02', '20:00', 'OR')] };
  const { byDate } = computeAll(data, { now });
  assert.equal(byDate['2026-03-02'].orgasmen.length, 0);
});

test('Unbekannte Event-Typen kippen die Berechnung nicht', () => {
  const now = new Date('2026-03-02T23:59:00');
  const data = { events: [ev('2026-03-01', '00:00', 'GIBTSNICHT')] };
  const { totals, byDate } = computeAll(data, { now });
  assert.equal(byDate['2026-03-01'].verschlossenH, 0, 'unbekannt gilt als offen');
  assert.equal(byDate['2026-03-01'].kosten, 0, 'und als punkteneutral');
  assert.ok(Number.isFinite(totals.konto));
});

test('Verschlossen-Phase läuft über Mitternacht und über Modellwechsel', () => {
  const s = S();
  const events = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'NS')];
  const ref = new Date('2026-03-04T12:00:00').getTime();
  const phase = lockPhaseStart(events, s, ref);
  assert.equal(phase.model, 'NS');
  assert.equal(new Date(phase.ms).toISOString().slice(0, 10), '2026-03-01');
});

test('Verschlossen-Phase endet beim Öffnen', () => {
  const s = S();
  const events = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'KK')];
  assert.equal(lockPhaseStart(events, s, new Date('2026-03-04T12:00:00').getTime()), null);
});

test('Aktueller Orgasmus-Preis richtet sich nach dem letzten Eintrag', () => {
  const s = S();
  const data = { events: [ev('2026-03-01', '12:00', 'OR')] };
  const p = currentOrgasmPrice(data, s, new Date('2026-03-08T12:00:00').getTime());
  assert.equal(p.abstandTage, 7);
  assert.equal(Math.round(p.price * 10) / 10, 37.5);
});

test('Regeneration: Fenster, Sperrfrist und Zeitüberschreitung', () => {
  const s = S();
  const data = { events: [ev('2026-03-01', '10:00', 'REG')] };
  assert.equal(regenState(data, s, new Date('2026-03-01T15:00:00')).state, 'active');
  assert.equal(regenState(data, s, new Date('2026-03-02T00:00:00')).state, 'cooldown');
  assert.equal(regenState(data, s, new Date('2026-03-08T00:00:00')).state, 'available');

  const nach = expiredRegenEvents(data, s, new Date('2026-03-02T00:00:00'));
  assert.equal(nach.length, 1);
  assert.equal(nach[0].type, 'KK');
  assert.equal(nach[0].time, '22:00', '12 Stunden nach 10:00');
});

test('Regeneration folgt der Registry: umbenannt und mit anderem Fenster', () => {
  const s = normalizeSettings({
    models: [
      { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'PAUSE', kind: 'model', label: 'Auszeit', rate: 0, locked: false, regen: true, windowH: 3, cooldownD: 1 },
      { id: 'OFFEN', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
    ],
  });
  const data = { events: [ev('2026-03-01', '10:00', 'PAUSE')] };
  assert.equal(regenState(data, s, new Date('2026-03-01T12:00:00')).state, 'active');
  const nach = expiredRegenEvents(data, s, new Date('2026-03-01T20:00:00'));
  assert.equal(nach[0].type, 'OFFEN', 'trägt den konfigurierten offenen Zustand ein');
  assert.equal(nach[0].time, '13:00');
});

test('Der allererste Tag zählt erst ab dem ersten Eintrag', () => {
  const now = new Date('2026-03-02T00:00:00');
  // Erster Käfig um 20:00 — die 20 Stunden davor sind unbekannt, nicht "offen".
  const data = { events: [ev('2026-03-01', '20:00', 'HT')] };
  const { byDate } = computeAll(data, { now });
  const d = byDate['2026-03-01'];
  assert.equal(d.offenH, 0, 'keine Strafstunden für Zeit ohne Datengrundlage');
  assert.equal(d.verschlossenH, 4);
  assert.ok(d.netto > 0, `wäre sonst ${d.netto}`);
});

test('Ab dem zweiten Tag zählt der Tag wieder ab Mitternacht', () => {
  const now = new Date('2026-03-03T00:00:00');
  const data = { events: [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-02', '06:00', 'KK')] };
  const { byDate } = computeAll(data, { now });
  const d = byDate['2026-03-02'];
  assert.equal(d.verschlossenH, 6, 'der Käfig läuft aus dem Vortag durch');
  assert.equal(d.offenH, 18);
});
