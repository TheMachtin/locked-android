import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAll, computeDayHours, scoreDay, lockPhaseStart, unopenedPhaseStart,
  unopenedRuns, unopenedMarks, currentOrgasmPrice, lastOrgasmMs, regenState, expiredRegenEvents }
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
  const r = scoreDay({ HT: 24 }, [], 50, ctxOf(s), [3]);
  assert.equal(r.verschlossenH, 24);
  assert.equal(r.offenH, 0);
  assert.equal(r.mult, 2, 'Deckel bei 2,0 ist nach 50 Tagen erreicht');
  assert.equal(r.uoBonus, 3);
  assert.equal(r.einnahmen, (24 * 0.5 + 3) * 2);
  assert.equal(r.kosten, 0);
});

test('Tageswertung: offene Stunden kosten', () => {
  const s = S();
  const r = scoreDay({ HT: 12, KK: 12 }, [], 0, ctxOf(s));
  assert.equal(r.stundenKosten, 12, 'KK kostet 1 Punkt je Stunde');
  assert.equal(r.uoBonus, 0, 'ohne vollendeten Block gibt es keinen Zuschlag');
  assert.equal(r.netto, 12 * 0.5 - 12);
});

test('Der Streak-Multiplikator ist gedeckelt und wächst nicht exponentiell', () => {
  const s = S();
  const werte = [0, 10, 50, 100, 365, 3650].map(n => scoreDay({ HT: 24 }, [], n, ctxOf(s)).mult);
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
  // Strecken (24 × 0,5 + 7) × 2 = 38, macht 38 / 0,03 ≈ 1267. Aus den
  // Sätzen gerechnet statt hart hingeschrieben: die Aussage ist der Grenzwert,
  // nicht die Zahl.
  const P = settings.points;
  const grenzwert = (24 * 0.5 + P.bonusUngeoeffnetCap) * P.streakCap / (1 - P.formDecay);
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

test('Ungeöffnet-Zuschlag: steigt mit der Blocknummer und bleibt unter dem Deckel', () => {
  const s = S();
  const P = s.points;
  const tag = (marks) => scoreDay({ HT: 24 }, [], 0, ctxOf(s), marks);
  assert.equal(tag([]).uoBonus, 0, 'ein Tag ohne vollendeten Block bekommt nichts');
  assert.equal(tag([1]).uoBonus, P.bonusUngeoeffnet);
  assert.equal(tag([3]).uoBonus, 3 * P.bonusUngeoeffnet);
  assert.equal(tag([1000]).uoBonus, P.bonusUngeoeffnetCap, 'der Deckel hält');
  assert.equal(tag([3]).einnahmen, (24 * 0.5 + 3 * P.bonusUngeoeffnet) * 1,
    'der Zuschlag liegt in den Einnahmen und geht damit durch den Multiplikator');
  assert.equal(tag([7, 8]).uoBonus, Math.min(7 * P.bonusUngeoeffnet, P.bonusUngeoeffnetCap)
    + Math.min(8 * P.bonusUngeoeffnet, P.bonusUngeoeffnetCap),
    'zwei Marken an einem Tag — 25-Stunden-Tag der Zeitumstellung — zählen beide');
  assert.equal(tag([7, 8]).uoTage, 8, 'angezeigt wird die höchste');
});

test('Tageswertung: der Multiplikator wirkt auf Stunden und Zuschlag', () => {
  const s = S();
  const r = scoreDay({ HT: 24 }, [], 30, ctxOf(s), [4]);
  // Genau diese Zerlegung zeigt die Aufschlüsselung in der App Zeile für Zeile;
  // wer hier etwas hinzufügt, muss es dort mit abziehen.
  assert.equal(r.einnahmen, (r.verdienstBasis + r.uoBonus) * r.mult);
});

test('Ungeöffnet-Zuschlag: der Satz 0 schaltet die Belohnung ab', () => {
  const s = normalizeSettings({ points: { bonusUngeoeffnet: 0 } });
  assert.equal(scoreDay({ HT: 24 }, [], 0, ctxOf(s), [99]).uoBonus, 0);
});

test('Strecken: ein Wechsel beendet, derselbe Käfig noch einmal nicht', () => {
  const s = S();
  const runs = unopenedRuns([
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-02', '08:00', 'HT'),   // kein Wechsel
    ev('2026-03-03', '09:00', 'NS'),   // Wechsel
    ev('2026-03-04', '09:00', 'KK'),   // Öffnung
    ev('2026-03-05', '09:00', 'CLEAN'),// Unterbrechung: keine Strecke
    ev('2026-03-06', '09:00', 'HT'),
  ], s);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map(r => r.model), ['HT', 'NS', 'HT']);
  assert.equal(new Date(runs[0].von).getDate(), 1, 'der zweite HT-Eintrag verschiebt den Beginn nicht');
  assert.equal(new Date(runs[0].bis).getDate(), 3);
  assert.equal(runs[2].bis, null, 'die letzte läuft noch');
});

test('Marken: alle 24 Stunden eine, unabhängig von Mitternacht', () => {
  const s = S();
  // Um 01:00 zugesperrt und 46 Stunden durchgehalten: kein einziger ganzer
  // Kalendertag, aber ein voller Tag am Verschluss.
  const marks = unopenedMarks([ev('2026-03-01', '01:00', 'HT')], s,
    new Date('2026-03-02T23:00:00'));
  assert.deepEqual(marks, { '2026-03-02': [1] });

  const laenger = unopenedMarks([ev('2026-03-01', '23:00', 'HT')], s,
    new Date('2026-03-04T12:00:00'));
  assert.deepEqual(laenger, { '2026-03-02': [1], '2026-03-03': [2] },
    'die Marke fällt auf 23:00 des jeweiligen Tages, nicht auf Mitternacht');
});

test('Marken: eine abgebrochene Strecke verliert nur den angefangenen Block', () => {
  const s = S();
  const marks = unopenedMarks([
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-03', '20:00', 'KK'),   // nach 60 h geöffnet
  ], s, new Date('2026-03-05T12:00:00'));
  assert.deepEqual(marks, { '2026-03-02': [1], '2026-03-03': [2] },
    'zwei volle Blöcke bleiben gutgeschrieben, der dritte war noch nicht um');
});

test('Marken: die Zukunft wird nicht vorweggenommen', () => {
  const s = S();
  const marks = unopenedMarks([ev('2026-03-01', '08:00', 'HT')], s,
    new Date('2026-03-02T07:59:00'));
  assert.deepEqual(marks, {}, 'eine Minute vor der Marke gibt es noch nichts');
});

test('Durchlauf: der Zuschlag fällt auf den Tag, an dem der Block voll wird', () => {
  const now = new Date('2026-03-06T23:59:00');
  const { byDate } = computeAll({ events: [ev('2026-03-01', '20:00', 'HT')] }, { now });
  assert.equal(byDate['2026-03-01'].uoTage, 0, 'am Tag des Anlegens ist noch nichts um');
  assert.equal(byDate['2026-03-02'].uoTage, 1);
  assert.equal(byDate['2026-03-05'].uoTage, 4);
  assert.equal(byDate['2026-03-05'].uoBonus, 4);
  assert.equal(byDate['2026-03-06'].uoBonus, 5);
});

test('Durchlauf: eine Reinigung bricht die Strecke, ein Orgasmus nicht', () => {
  const now = new Date('2026-03-08T23:59:00');
  const mitReinigung = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-04', '09:00', 'CLEAN'), ev('2026-03-04', '09:20', 'HT'),
  ] }, { now }).byDate;
  assert.equal(mitReinigung['2026-03-03'].uoTage, 2);
  assert.equal(mitReinigung['2026-03-04'].uoTage, 3,
    'der dritte Block war um 08:00 voll — die Reinigung um 09:00 kommt zu spät, um ihn zu nehmen');
  assert.equal(mitReinigung['2026-03-05'].uoTage, 1,
    'für die Reinigung kam der Käfig herunter: die Strecke zählt von vorn, nicht als vierter Tag');
  assert.equal(mitReinigung['2026-03-06'].uoTage, 2);

  const mitOrgasmus = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-04', '09:00', 'OR'),
  ] }, { now }).byDate;
  assert.equal(mitOrgasmus['2026-03-04'].uoTage, 3, 'ein Orgasmus sagt über den Verschluss nichts');
  assert.equal(mitOrgasmus['2026-03-04'].orgasmusfrei, false, 'der Orgasmus-Streak bricht sehr wohl');
});

test('Durchlauf: heute zählt nur, was bis jetzt abgelaufen ist — und das endgültig', () => {
  const data = { events: [ev('2026-03-01', '08:00', 'HT')] };
  const vorher = computeAll(data, { now: new Date('2026-03-03T07:00:00') }).byDate['2026-03-03'];
  assert.equal(vorher.uoBonus, 0, 'die Marke um 08:00 ist noch nicht gefallen');
  const nachher = computeAll(data, { now: new Date('2026-03-03T09:00:00') }).byDate['2026-03-03'];
  assert.equal(nachher.uoTage, 2);

  // Eine Öffnung am Abend nimmt den vollendeten Block nicht mehr weg — genau
  // das war an Kalendertagen anders.
  const geoeffnet = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'), ev('2026-03-03', '20:00', 'KK'),
  ] }, { now: new Date('2026-03-03T21:00:00') }).byDate['2026-03-03'];
  assert.equal(geoeffnet.uoTage, 2);
  assert.equal(geoeffnet.uoBonus, 2);
});

test('Totals: längste Strecke und Summe der Zuschläge', () => {
  const now = new Date('2026-03-10T23:59:00');
  const { totals } = computeAll({ events: [
    ev('2026-03-01', '08:00', 'HT'),
    ev('2026-03-05', '09:00', 'NS'),
  ] }, { now });
  assert.equal(totals.bestUoStreak.days, 5, 'die zweite Strecke läuft seit dem 5.');
  assert.equal(totals.bestUoStreak.end, '2026-03-10');
  assert.equal(totals.tageUngeoeffnet, 9, '4 volle Tage vor dem Wechsel, 5 danach');
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
  const r = scoreDay({ HT: 21, CLEAN: 3 }, [], 0, ctxOf(s));
  assert.equal(r.verschlossenH, 21);
  assert.equal(r.offenH, 0, 'die Reinigung ist keine Öffnung');
  assert.equal(r.pauseH, 3);
  assert.equal(r.stundenKosten, 0, 'sie kostet auch keine offenen Stunden');
  assert.equal(r.einnahmen, 21 * 0.5, 'verdient wird in der Pause nichts');
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

// =========================== EREIGNIS OHNE ORGASMUS ===========================
/** Registry mit einem zweiten Ereignis, das die Strecke nicht bricht. */
const mitEmission = (streakFactor = 1) => normalizeSettings({
  models: [
    { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
    { id: 'KK', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
    { id: 'OR', kind: 'orgasm', label: 'Orgasmus', priceMin: 15, priceMax: 60, halflifeDays: 7 },
    { id: 'EM', kind: 'orgasm', label: 'Erguss ohne Orgasmus',
      priceMin: 8, priceMax: 8, halflifeDays: 7, streakFactor },
  ],
});

test('Ereignis mit Faktor 1: kostet, bricht die Strecke aber nicht', () => {
  const s = mitEmission(1);
  const events = [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-11', '21:00', 'EM')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-13T00:00:00') });

  const tag = byDate['2026-03-11'];
  assert.equal(tag.orgasmusfrei, true, 'kein Orgasmus, also orgasmusfrei');
  assert.equal(tag.orgasmKosten, 8, 'den Preis kostet es trotzdem');
  assert.ok(tag.netto > 0, 'ein voll verschlossener Tag trägt sich auch mit dem Preis');

  // Der Multiplikator wächst über den Tag hinweg weiter: 11 orgasmusfreie Tage
  // vor dem 12. → 1 + 0,02 × 11.
  assert.equal(byDate['2026-03-12'].mult, 1 + 0.02 * 11);
});

test('Ereignis mit Faktor 0 verhält sich wie der Orgasmus', () => {
  const s = mitEmission(0);
  const events = [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-11', '21:00', 'EM')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-13T00:00:00') });
  assert.equal(byDate['2026-03-11'].orgasmusfrei, false);
  assert.equal(byDate['2026-03-12'].mult, 1, 'die Strecke beginnt wieder bei null');
});

test('Ereignis mit Faktor 0,5 lässt die halbe Strecke stehen', () => {
  const s = mitEmission(0.5);
  const events = [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-11', '21:00', 'EM')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-13T00:00:00') });
  // 11 Tage standen vor dem 11.; die Hälfte davon, abgerundet, bleibt.
  assert.equal(byDate['2026-03-12'].mult, 1 + 0.02 * 5);
});

test('Der strengste Eintrag des Tages bestimmt, was von der Strecke bleibt', () => {
  const s = mitEmission(1);
  const events = [ev('2026-03-01', '00:00', 'HT'),
    ev('2026-03-11', '09:00', 'EM'), ev('2026-03-11', '21:00', 'OR')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-13T00:00:00') });
  assert.equal(byDate['2026-03-11'].orgasmusfrei, false, 'der Orgasmus am Abend wiegt schwerer');
  assert.equal(byDate['2026-03-12'].mult, 1);
});

test('Der Preisabstand zählt über ein geschontes Ereignis hinweg', () => {
  const s = mitEmission(1);
  const events = [ev('2026-03-01', '12:00', 'OR'), ev('2026-03-07', '12:00', 'EM'),
    ev('2026-03-08', '12:00', 'OR')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-09T00:00:00') });
  const zweiter = byDate['2026-03-08'].orgasmen.find(o => o.model.id === 'OR');
  assert.equal(zweiter.abstandTage, 7, 'sieben Tage zurück zum letzten Orgasmus, nicht einer zum Erguss');

  // Und dieselbe Auskunft an der Kachel und im Jetzt-Block.
  const ref = new Date('2026-03-08T00:00:00').getTime();
  assert.equal(lastOrgasmMs(events, s, ref), new Date('2026-03-01T12:00:00').getTime());
  assert.equal(currentOrgasmPrice({ events }, s, ref).model.id, 'OR');
});

test('Der Aufschlag je weiterem am Tag zählt je Ereignisart', () => {
  const s = normalizeSettings({
    models: [
      { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'KK', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
      { id: 'OR', kind: 'orgasm', label: 'Orgasmus',
        priceMin: 20, priceMax: 20, halflifeDays: 7, repeatFactor: 2 },
      { id: 'EM', kind: 'orgasm', label: 'Erguss', priceMin: 8, priceMax: 8, streakFactor: 1 },
    ],
  });
  const events = [ev('2026-03-01', '00:00', 'HT'),
    ev('2026-03-02', '09:00', 'EM'), ev('2026-03-02', '21:00', 'OR')];
  const { byDate } = computeAll({ events, settings: s }, { now: new Date('2026-03-03T00:00:00') });
  const or = byDate['2026-03-02'].orgasmen.find(o => o.model.id === 'OR');
  assert.equal(or.price, 20, 'der Erguss macht den Orgasmus nicht zum zweiten');
});

test('Kennzahlen trennen Orgasmen von Ereignissen, die keine sind', () => {
  const s = mitEmission(1);
  const events = [ev('2026-03-01', '00:00', 'HT'),
    ev('2026-03-05', '21:00', 'EM'), ev('2026-03-09', '21:00', 'OR')];
  const { totals } = computeAll({ events, settings: s }, { now: new Date('2026-03-10T00:00:00') });
  assert.equal(totals.orgasmen, 1);
  assert.equal(totals.sonstigeEreignisse, 1);
  assert.equal(totals.tageMitOrgasmus, 1, 'der 5. ist kein Tag mit Orgasmus');
  assert.ok(totals.orgasmKosten > 8, 'beide Preise stehen in den Kosten');
});

test('Ein Ereignis darf nichts kosten und bleibt trotzdem verzeichnet', () => {
  // Der Vermerk: kein Orgasmus, kein Preis, keine verschobene Zahl — und
  // trotzdem in der Datei, in den Kennzahlen und in der Zeitleiste des Tages.
  const s = normalizeSettings({
    models: [
      { id: 'HT', kind: 'model', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'KK', kind: 'model', label: 'Offen', rate: -1, locked: false, isOpen: true },
      { id: 'OR', kind: 'orgasm', label: 'Orgasmus', priceMin: 15, priceMax: 60 },
      { id: 'EM', kind: 'orgasm', label: 'Erguss ohne Orgasmus',
        priceMin: 0, priceMax: 0, streakFactor: 1 },
    ],
  });
  const now = new Date('2026-03-13T00:00:00');
  const ohne = computeAll({ events: [ev('2026-03-01', '00:00', 'HT')], settings: s }, { now });
  const mit = computeAll({
    events: [ev('2026-03-01', '00:00', 'HT'), ev('2026-03-09', '21:00', 'EM')], settings: s,
  }, { now });

  assert.equal(mit.totals.konto, ohne.totals.konto, 'am Konto ändert der Vermerk nichts');
  assert.equal(mit.byDate['2026-03-09'].orgasmKosten, 0);
  assert.equal(mit.byDate['2026-03-09'].orgasmusfrei, true);
  // Verzeichnet ist er trotzdem — sonst wäre er nicht von „nicht eingetragen"
  // zu unterscheiden.
  assert.equal(mit.totals.sonstigeEreignisse, 1);
  assert.equal(mit.totals.orgasmen, 0);
  assert.equal(mit.byDate['2026-03-09'].events.length, 1);
});
