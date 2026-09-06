import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAll, computeDayHours, scoreDay, lockPhaseStart, unopenedPhaseStart,
  currentOrgasmPrice, regenState, expiredRegenEvents }
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
  const r = scoreDay({ HT: 23.5, KK: 0.5 }, [], 0, ctxOf(s), true);
  assert.equal(r.durchgehend, true, 'unter der Schwelle von 1 h');
  assert.equal(r.offenH, 0.5);
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
  const { totals, days, settings } = computeAll(data, { now });
  assert.ok(days.length > 1000);
  // Fixpunkt: tagesnetto / (1 − decay). Ein Dauertag bringt am Deckel beider
  // Strecken (24 × 0,5 + 5 + 7) × 2 = 48, macht 48 / 0,03 = 1600. Aus den
  // Sätzen gerechnet statt hart hingeschrieben: die Aussage ist der Grenzwert,
  // nicht die Zahl.
  const P = settings.points;
  const grenzwert = (24 * 0.5 + P.bonusDurchgehend + P.bonusUngeoeffnetCap) * P.streakCap
    / (1 - P.formDecay);
  assert.ok(Math.abs(totals.form - grenzwert) < 1,
    `Form war ${totals.form}, erwartet ~${grenzwert}`);
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

test('Eine Unterbrechung beendet die verschlossene Phase nicht', () => {
  const s = S();
  const events = [
    ev('2026-03-01', '20:00', 'HT'),
    ev('2026-03-03', '09:00', 'CLEAN'),
    ev('2026-03-03', '09:20', 'HT'),
  ];
  const phase = lockPhaseStart(events, s, new Date('2026-03-04T12:00:00').getTime());
  assert.ok(phase, 'nach der Reinigung ist der Käfig wieder dran');
  assert.equal(new Date(phase.ms).toISOString().slice(0, 10), '2026-03-01',
    'die Phase zählt weiter ab dem ersten Käfig, nicht ab der Reinigung');
  assert.equal(phase.paused, false);
});

test('Während der Unterbrechung läuft die Phase weiter und meldet sich als pausiert', () => {
  const s = S();
  const events = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'CLEAN')];
  const phase = lockPhaseStart(events, s, new Date('2026-03-03T09:30:00').getTime());
  assert.ok(phase, 'zehn Minuten am Waschbecken sind kein Abbruch');
  assert.equal(new Date(phase.ms).toISOString().slice(0, 10), '2026-03-01');
  assert.equal(phase.model, 'HT', 'die Phase trägt weiter der Käfig, nicht die Reinigung');
  assert.equal(phase.paused, true);
  assert.equal(phase.pauseModel, 'CLEAN');
});

test('Eine Unterbrechung macht aus einem offenen Zustand keinen verschlossenen', () => {
  const s = S();
  const nachOffen = [ev('2026-03-01', '20:00', 'KK'), ev('2026-03-03', '09:00', 'CLEAN')];
  assert.equal(lockPhaseStart(nachOffen, s, new Date('2026-03-03T10:00:00').getTime()), null);

  const nurReinigung = [ev('2026-03-01', '20:00', 'CLEAN')];
  assert.equal(lockPhaseStart(nurReinigung, s, new Date('2026-03-01T21:00:00').getTime()), null,
    'ohne vorherigen Käfig bleibt der offene Startzustand stehen');
});

test('Ungeöffnet-Bonus: steigt mit der Strecke und bleibt unter dem Deckel', () => {
  const s = S();
  const P = s.points;
  const tag = (uoTage) => scoreDay({ HT: 24 }, [], 0, ctxOf(s), true, uoTage);
  assert.equal(tag(0).uoBonus, 0, 'ein Tag mit Öffnung bekommt nichts');
  assert.equal(tag(1).uoBonus, P.bonusUngeoeffnet);
  assert.equal(tag(3).uoBonus, 3 * P.bonusUngeoeffnet);
  assert.equal(tag(1000).uoBonus, P.bonusUngeoeffnetCap, 'der Deckel hält');
  assert.equal(tag(3).einnahmen, (24 * 0.5 + P.bonusDurchgehend + 3 * P.bonusUngeoeffnet) * 1,
    'der Zuschlag liegt in den Einnahmen und geht damit durch den Multiplikator');
});

test('Tageswertung: der Multiplikator wirkt auf Basis, Bonus und Zuschlag', () => {
  const s = S();
  const r = scoreDay({ HT: 24 }, [], 30, ctxOf(s), true, 4);
  // Genau diese Zerlegung zeigt die Aufschlüsselung in der App Zeile für Zeile;
  // wer hier etwas hinzufügt, muss es dort mit abziehen.
  assert.equal(r.einnahmen, (r.verdienstBasis + r.bonus + r.uoBonus) * r.mult);
});

test('Ungeöffnet-Bonus: ohne verschlossene Stunden gibt es ihn nicht', () => {
  const s = S();
  assert.equal(scoreDay({ KK: 24 }, [], 0, ctxOf(s), true, 5).uoBonus, 0);
});

test('Ungeöffnet-Bonus: der Deckel lässt sich mit 0 abschalten', () => {
  const s = normalizeSettings({ points: { bonusUngeoeffnet: 0 } });
  assert.equal(scoreDay({ HT: 24 }, [], 0, ctxOf(s), true, 99).uoBonus, 0);
});

test('Durchlauf: die Strecke zählt Tag für Tag hoch und bricht beim Wechsel', () => {
  const now = new Date('2026-03-06T23:59:00');
  const data = { events: [
    ev('2026-03-01', '08:00', 'HT'),   // an dem Tag ging er zu: der Tag war offen
    ev('2026-03-04', '09:00', 'NS'),   // Wechsel: Bruch
  ] };
  const { byDate } = computeAll(data, { now });
  assert.equal(byDate['2026-03-01'].ungeoeffnet, false, 'der Tag des Anlegens zählt nicht');
  assert.equal(byDate['2026-03-02'].uoTage, 1);
  assert.equal(byDate['2026-03-03'].uoTage, 2);
  assert.equal(byDate['2026-03-04'].uoTage, 0, 'der Wechseltag bricht die Strecke');
  assert.equal(byDate['2026-03-05'].uoTage, 1, 'und beginnt sie neu');
  assert.equal(byDate['2026-03-06'].uoTage, 2);
});

test('Durchlauf: eine Reinigung bricht die Strecke, ein Orgasmus nicht', () => {
  const now = new Date('2026-03-06T23:59:00');
  const mitReinigung = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-04', '09:00', 'CLEAN'), ev('2026-03-04', '09:20', 'HT'),
  ] }, { now }).byDate;
  assert.equal(mitReinigung['2026-03-03'].uoTage, 2);
  assert.equal(mitReinigung['2026-03-04'].uoTage, 0, 'für die Reinigung kam der Käfig herunter');
  assert.equal(mitReinigung['2026-03-05'].uoTage, 1);

  const mitOrgasmus = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-04', '09:00', 'OR'),
  ] }, { now }).byDate;
  assert.equal(mitOrgasmus['2026-03-04'].uoTage, 3, 'ein Orgasmus sagt über den Verschluss nichts');
  assert.equal(mitOrgasmus['2026-03-04'].orgasmusfrei, false, 'der Orgasmus-Streak bricht sehr wohl');
});

test('Durchlauf: derselbe Käfig zweimal am Tag ist kein Wechsel', () => {
  const now = new Date('2026-03-04T23:59:00');
  const { byDate } = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-03', '07:00', 'HT'), ev('2026-03-03', '19:00', 'HT'),
  ] }, { now });
  assert.equal(byDate['2026-03-03'].uoTage, 2);
  assert.equal(byDate['2026-03-04'].uoTage, 3);
});

test('Durchlauf: heute ist der Zuschlag vorläufig, die Öffnung am Abend nimmt ihn weg', () => {
  const heute = { events: [ev('2026-03-01', '08:00', 'HT')] };
  const mittags = computeAll(heute, { now: new Date('2026-03-03T12:00:00') }).byDate['2026-03-03'];
  assert.ok(mittags.uoBonus > 0);
  assert.equal(mittags.uoVorlaeufig, true);

  const geoeffnet = { events: [ev('2026-03-01', '08:00', 'HT'), ev('2026-03-03', '20:00', 'KK')] };
  const abends = computeAll(geoeffnet, { now: new Date('2026-03-03T21:00:00') }).byDate['2026-03-03'];
  assert.equal(abends.uoBonus, 0);
  assert.equal(abends.ungeoeffnet, false);
});

test('Totals: längste ungeöffnete Strecke und Summe der Zuschläge', () => {
  const now = new Date('2026-03-10T23:59:00');
  const { totals } = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-05', '09:00', 'NS'),
  ] }, { now });
  assert.equal(totals.bestUoStreak.days, 5, '06.–10. März sind fünf ganze Tage');
  assert.equal(totals.bestUoStreak.end, '2026-03-10');
  assert.equal(totals.tageUngeoeffnet, 8, 'plus 02.–04. März vor dem Wechsel');
  assert.ok(totals.uoEinnahmen > 0);
});

test('Ungeöffnet endet beim Modellwechsel, verschlossen läuft weiter', () => {
  const s = S();
  const events = [
    ev('2026-03-01', '20:00', 'HT'),
    ev('2026-03-03', '09:00', 'NS'),
  ];
  const ref = new Date('2026-03-04T12:00:00').getTime();
  assert.equal(new Date(lockPhaseStart(events, s, ref).ms).toISOString().slice(0, 10), '2026-03-01');
  const uo = unopenedPhaseStart(events, s, ref);
  assert.equal(uo.model, 'NS');
  assert.equal(new Date(uo.ms).toISOString().slice(0, 10), '2026-03-03',
    'für den Wechsel musste der Käfig auf — die Strecke beginnt dort neu');
});

test('Ungeöffnet: derselbe Käfig zweimal eingetragen ist kein Wechsel', () => {
  const s = S();
  const events = [
    ev('2026-03-01', '20:00', 'HT'),
    ev('2026-03-02', '08:00', 'HT'),
    ev('2026-03-03', '08:00', 'HT'),
  ];
  const uo = unopenedPhaseStart(events, s, new Date('2026-03-04T12:00:00').getTime());
  assert.equal(new Date(uo.ms).toISOString().slice(0, 10), '2026-03-01',
    'der Lauf beginnt beim ersten der gleichen Einträge');
});

test('Ungeöffnet: eine Unterbrechung setzt zurück, die verschlossene Phase nicht', () => {
  const s = S();
  const events = [
    ev('2026-03-01', '20:00', 'HT'),
    ev('2026-03-03', '09:00', 'CLEAN'),
    ev('2026-03-03', '09:20', 'HT'),
  ];
  const ref = new Date('2026-03-04T12:00:00').getTime();
  assert.equal(new Date(lockPhaseStart(events, s, ref).ms).toISOString().slice(0, 10), '2026-03-01');
  const uo = unopenedPhaseStart(events, s, ref);
  assert.equal(new Date(uo.ms).getHours(), 9);
  assert.equal(new Date(uo.ms).getMinutes(), 20,
    'die Reinigung steht in der Datei, weil der Käfig dafür herunter kam');
});

test('Ungeöffnet: während der Unterbrechung und im offenen Zustand läuft nichts', () => {
  const s = S();
  const inReinigung = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'CLEAN')];
  assert.equal(unopenedPhaseStart(inReinigung, s, new Date('2026-03-03T09:30:00').getTime()), null);

  const offen = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'KK')];
  assert.equal(unopenedPhaseStart(offen, s, new Date('2026-03-04T12:00:00').getTime()), null);

  assert.equal(unopenedPhaseStart([], s, Date.now()), null, 'ohne Historie ist der Startzustand offen');
});

test('Ungeöffnet: ein Orgasmus für sich öffnet nichts', () => {
  const s = S();
  const events = [ev('2026-03-01', '20:00', 'HT'), ev('2026-03-03', '09:00', 'OR')];
  const uo = unopenedPhaseStart(events, s, new Date('2026-03-04T12:00:00').getTime());
  assert.equal(new Date(uo.ms).toISOString().slice(0, 10), '2026-03-01',
    'wer dafür aufgemacht hat, trägt die Öffnung ein — das Ereignis selbst sagt nichts');
});

test('Ungeöffnet ist nie länger als verschlossen', () => {
  const s = S();
  const events = [
    ev('2026-03-01', '08:00', 'HT'), ev('2026-03-01', '20:00', 'NS'),
    ev('2026-03-02', '07:00', 'CLEAN'), ev('2026-03-02', '07:30', 'NS'),
    ev('2026-03-03', '12:00', 'HT'),
  ];
  const ref = new Date('2026-03-04T18:00:00').getTime();
  const lock = lockPhaseStart(events, s, ref);
  const uo = unopenedPhaseStart(events, s, ref);
  assert.ok(uo.ms >= lock.ms);
});

test('Unterbrechungsstunden zählen weder als verschlossen noch als offen', () => {
  const s = S();
  const r = scoreDay({ HT: 21, CLEAN: 3 }, [], 0, ctxOf(s), true);
  assert.equal(r.verschlossenH, 21);
  assert.equal(r.offenH, 0, 'die Reinigung ist keine Öffnung');
  assert.equal(r.pauseH, 3);
  assert.equal(r.bonus, 5, 'der Durchgehend-Bonus überlebt drei Stunden Reinigung');
  assert.equal(r.stundenKosten, 0);
  assert.equal(r.einnahmen, 21 * 0.5 + 5, 'verdient wird in der Pause nichts');
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
