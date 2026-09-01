import test from 'node:test';
import assert from 'node:assert/strict';

import { migrate, importLegacyData, leereDaten, DATA_VERSION } from '../www/js/core/migrate.js';
import { computeLegacy, freezeLegacy, refreezeLegacy } from '../www/js/core/legacy.js';
import { computeAll } from '../www/js/core/calc.js';

const ev = (date, time, type, extra) => ({ date, time, type, ...extra });
const NOW = new Date('2026-08-31T14:00:00');

const altbestand = () => ({
  version: 2,
  events: [
    ev('2026-06-01', '08:00', 'HT'),
    ev('2026-06-20', '22:00', 'OR'),
    ev('2026-07-04', '09:00', 'KK'),
    ev('2026-07-04', '11:00', 'NS'),
    ev('2026-08-30', '23:00', 'OR'),
  ],
  days: { '2026-06-15': { keinKG: true } },
});

test('Migration setzt Einstellungen und Version', () => {
  const { data, migriert } = migrate(altbestand(), { now: NOW });
  assert.equal(migriert, true);
  assert.equal(data.version, DATA_VERSION);
  assert.ok(data.settings.models.length > 0);
  assert.ok(data.settings.updatedAt);
});

test('Der Stichtag wird abgeleitet, nicht gespeichert', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  assert.equal('startedAt' in data, false, 'kein festgeschriebenes Datum in der Datei');
  const { startedAt } = computeAll(data, { now: NOW });
  assert.equal(startedAt, '2026-08-31', 'ergibt sich aus dem Archiv: der Tag nach dessen Ende');
});

test('Ohne Archiv zählt alles — auch nachgetragene Tage', () => {
  // Der eigentliche Alltagsfall: App heute zum ersten Mal gestartet, dann die
  // letzten beiden Tage nachgetragen. Ohne alte Ära gibt es nichts abzutrennen.
  const { data } = migrate({ version: 2, events: [] }, { now: NOW });
  data.events.push(ev('2026-08-29', '08:00', 'HT'), ev('2026-08-30', '09:00', 'NS'));
  const { startedAt, byDate, totals } = computeAll(data, { now: NOW });
  assert.equal(startedAt, '2026-08-29');
  assert.equal(byDate['2026-08-29'].zaehlt, true);
  assert.equal(byDate['2026-08-30'].zaehlt, true);
  assert.ok(totals.konto > 0, 'die nachgetragenen Tage landen im Konto');
});

test('Ein von Hand gesetzter Stichtag schlägt die Ableitung', () => {
  const { data } = migrate({ version: 2, events: [] }, { now: NOW });
  data.events.push(ev('2026-08-29', '08:00', 'HT'));
  data.settings.startedAt = '2026-08-31';
  const { startedAt, byDate } = computeAll(data, { now: NOW });
  assert.equal(startedAt, '2026-08-31');
  assert.equal(byDate['2026-08-29'].zaehlt, false);
});

test('Migration friert die alte Ära ein', () => {
  const { data, legacyErzeugt } = migrate(altbestand(), { now: NOW });
  assert.equal(legacyErzeugt, true);
  assert.equal(data.legacy.formel, 'locked-1.x');
  assert.equal(data.legacy.stichtag, '2026-08-31');
  assert.ok(data.legacy.punkte > 0);
  assert.ok(data.legacy.bis < '2026-08-31', 'der Umstiegstag gehört schon zur neuen Ära');
});

test('Migration ist idempotent — der Stichtag verschiebt sich nie', () => {
  const erste = migrate(altbestand(), { now: NOW }).data;
  const punkte = erste.legacy.punkte;
  const spaeter = new Date('2027-01-01T10:00:00');
  const zweite = migrate(erste, { now: spaeter });
  assert.equal(zweite.migriert, false);
  assert.equal(zweite.legacyErzeugt, false);
  assert.equal(zweite.data.legacy.punkte, punkte, 'das Archiv ist unveränderlich');
  assert.equal(computeAll(zweite.data, { now: spaeter }).startedAt, '2026-08-31',
    'der abgeleitete Stichtag hängt am Archiv und wandert nicht mit dem Datum mit');
});

test('Das neue Konto startet bei null', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  const { totals, byDate, startedAt } = computeAll(data, { now: NOW });
  const ersterTag = byDate[startedAt];
  assert.ok(Math.abs(totals.konto - ersterTag.netto) < 1e-9,
    'am Stichtag ist das Konto genau der Ertrag dieses einen Tages');
  assert.equal(byDate['2026-06-01'].zaehlt, false);
});

test('Die Events überleben den Schnitt vollständig', () => {
  const alt = altbestand();
  const { data } = migrate(alt, { now: NOW });
  assert.equal(data.events.length, alt.events.length);
  const { byDate } = computeAll(data, { now: NOW });
  assert.ok(byDate['2026-06-15'].hours.HT > 0,
    'Tragestunden werden auch vor dem Stichtag noch berechnet');
  assert.ok(byDate['2026-08-31'].prevEndModel,
    'der Zustand läuft über den Schnitt hinweg in die neue Ära');
});

test('Die Summen des Dashboards zählen nur die neue Ära', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  const { totals } = computeAll(data, { now: NOW });
  // Sonst stünde eine Kachel über die neue Ära neben einem Donut über alles.
  assert.ok(totals.stundenVerschlossen < 48, `waren ${totals.stundenVerschlossen} h`);
  const summe = Object.values(totals.hoursByModel).reduce((a, b) => a + b, 0);
  assert.ok(summe < 48, 'Tragezeit je Modell folgt demselben Zeitraum');
  assert.ok(data.legacy.stundenVerschlossen > 1000, 'die Zeit davor steht im Archiv');
});

test('Eine frische Installation bekommt kein Archiv', () => {
  const leer = leereDaten(NOW);
  assert.equal('legacy' in leer, false);
  const { data, legacyErzeugt } = migrate({ version: 2, events: [] }, { now: NOW });
  assert.equal(legacyErzeugt, false);
  assert.equal('legacy' in data, false, 'wer diese Punkte nie verdient hat, sieht sie auch nicht');
});

test('Das Archiv steckt in den Daten, nicht im Programm', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  const uebertragen = JSON.parse(JSON.stringify(data));
  delete uebertragen.legacy;
  const { data: ohne } = migrate(uebertragen, { now: new Date('2027-05-05') });
  assert.equal('legacy' in ohne, false,
    'ohne den Eintrag in der Datei taucht das Archiv nirgends wieder auf');
});

test('Nachträglicher Import einer 1.x-Datei ergänzt Events und friert dann ein', () => {
  const frisch = leereDaten(NOW);
  frisch.events.push(ev('2026-08-31', '12:00', 'HT'));
  const { data, uebernommen, legacyErzeugt } = importLegacyData(frisch, altbestand(), { now: NOW });
  assert.equal(uebernommen, 5);
  assert.equal(legacyErzeugt, true);
  assert.equal(data.events.length, 6);
  assert.ok(data.events.every((e, i, a) => i === 0 || (a[i - 1].date + a[i - 1].time) <= (e.date + e.time)),
    'Events bleiben chronologisch');
});

test('Ein Import schiebt die schon eingetragenen 2.0-Tage nicht ins Archiv', () => {
  // Zwei Tage in 2.0 gearbeitet, dann die alte Historie nachgeladen: die zwei
  // Tage gehören weiter zur neuen Ära.
  const frisch = leereDaten(NOW);
  frisch.events.push(ev('2026-08-29', '08:00', 'HT'), ev('2026-08-30', '09:00', 'NS'));
  const { data, legacyErzeugt } = importLegacyData(frisch, altbestand(), { now: NOW });
  assert.equal(legacyErzeugt, true);
  assert.equal(data.legacy.bis, '2026-08-28', 'das Archiv endet vor dem ersten 2.0-Tag');
  const { startedAt, byDate } = computeAll(data, { now: NOW });
  assert.equal(startedAt, '2026-08-29');
  assert.equal(byDate['2026-08-29'].zaehlt, true);
  assert.equal(byDate['2026-06-01'].zaehlt, false, 'die alte Historie zählt weiterhin nicht');
});

test('Import erkennt Dubletten', () => {
  const frisch = leereDaten(NOW);
  const einmal = importLegacyData(frisch, altbestand(), { now: NOW }).data;
  const nochmal = importLegacyData(einmal, altbestand(), { now: NOW });
  assert.equal(nochmal.uebernommen, 0);
  assert.equal(nochmal.data.events.length, 5);
});

test('Alte Formel: der Streak wächst exponentiell — genau deshalb ist sie eingefroren', () => {
  const events = [ev('2026-01-01', '00:00', 'HT')];
  const kurz = computeLegacy({ events }, '2026-02-01');
  const lang = computeLegacy({ events }, '2026-07-01');
  const tageFaktor = lang.kalendertage / kurz.kalendertage;
  assert.ok(lang.punkte / kurz.punkte > tageFaktor * 100,
    'fünfmal so lang, aber weit mehr als hundertfach so viele Punkte');
});

test('Alte Formel respektiert die manuellen Tages-Markierungen von damals', () => {
  const events = [ev('2026-01-01', '00:00', 'HT'), ev('2026-01-05', '10:00', 'OR')];
  const ohne = computeLegacy({ events }, '2026-01-10');
  const mit = computeLegacy({ events, days: { '2026-01-05': { orgasmusfrei: true } } }, '2026-01-10');
  assert.ok(mit.punkte > ohne.punkte, 'ein gesetztes Flag hebt den damaligen Streak');
});

test('freezeLegacy läuft nur, solange es kein Archiv gibt', () => {
  const data = altbestand();
  const erst = freezeLegacy(data, '2026-08-31');
  assert.ok(erst);
  assert.equal(freezeLegacy({ ...data, legacy: erst }, '2026-08-31'), null);
});

test('Stichtag verschieben rechnet das Archiv neu — kein Tag zählt doppelt', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  const vorher = data.legacy;
  assert.equal(vorher.bis, '2026-08-30', 'Archiv endet am Tag vor dem Stichtag');

  // Zwei Tage zurück: der 29. und 30.08. sollen in die neue Ära wechseln.
  const zurueck = refreezeLegacy(data, '2026-08-29');
  assert.equal(zurueck.bis, '2026-08-28');
  assert.ok(zurueck.punkte < vorher.punkte, 'kürzere alte Ära, weniger Punkte');

  // Mit dem passenden Stichtag entsteht weder Lücke noch Überlappung.
  const neu = { ...data, legacy: zurueck, settings: { ...data.settings, startedAt: '2026-08-29' } };
  const { startedAt, byDate } = computeAll(neu, { now: NOW });
  assert.equal(startedAt, '2026-08-29');
  assert.equal(byDate['2026-08-29'].zaehlt, true, 'der Tag nach dem Archiv zählt neu');
  assert.equal(byDate['2026-08-28'].zaehlt, false, 'der letzte Archivtag zählt nicht auch noch');
});

test('Ein Stichtag vor allen Einträgen lässt das Archiv entfallen', () => {
  const { data } = migrate(altbestand(), { now: NOW });
  assert.equal(refreezeLegacy(data, '2026-01-01'), null, 'davor liegt nichts mehr');
});

test('refreezeLegacy rechnet auch dann, wenn schon ein Archiv da ist', () => {
  // freezeLegacy verweigert das bewusst (einmaliger Umstieg), refreeze nicht.
  const { data } = migrate(altbestand(), { now: NOW });
  assert.equal(freezeLegacy(data, '2026-08-15'), null);
  assert.ok(refreezeLegacy(data, '2026-08-15'));
});
