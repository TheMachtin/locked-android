import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCommand, resolveCommandModel, planCommand, currentStateAt,
  shortcutModels, commandUrl, webCommandUrl, MAX_SHORTCUTS, CMD_PARAMS,
  initialen, watchPayload, MAX_TILE_BUTTONS,
} from '../www/js/core/command.js';
import { normalizeSettings } from '../www/js/core/settings.js';

const S = normalizeSettings(null);
const JETZT = new Date('2026-09-03T10:20:00');

// =========================== LESEN ===========================
test('Das eigene Schema wird erkannt, der OAuth-Rücksprung nicht', () => {
  assert.deepEqual(parseCommand('locked://log?m=HT'),
    { modell: 'HT', zeit: null, datum: null, zeigen: false });
  assert.equal(parseCommand('locked://auth?code=abc&state=xyz'), null,
    'die Anmeldung darf nie als Eintrag gedeutet werden');
  assert.equal(parseCommand('locked://log'), null, 'ohne Modell ist es kein Kommando');
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
});

test('Die Web-Adresse trägt denselben Befehl als Parameter', () => {
  const c = parseCommand('https://themachtin.github.io/locked-android/?log=KK&t=07:05');
  assert.deepEqual(c, { modell: 'KK', zeit: '07:05', datum: null, zeigen: false });
  assert.equal(parseCommand('https://themachtin.github.io/locked-android/'), null);
  assert.equal(parseCommand('https://themachtin.github.io/locked-android/?code=abc'), null);
});

test('Lange und kurze Schreibweisen meinen dasselbe', () => {
  assert.deepEqual(
    parseCommand('locked://log?modell=HT&zeit=08:00&datum=2026-09-01&zeigen=1'),
    parseCommand('locked://log?m=HT&t=08:00&d=2026-09-01&app=1'));
  assert.equal(parseCommand('locked://log?m=HT&app=0').zeigen, false,
    '„app=0" heißt nicht „ja"');
});

test('Ein Fragment hinter der Abfrage stört nicht', () => {
  assert.equal(parseCommand('locked://log?m=HT#irgendwas').modell, 'HT');
});

// =========================== MODELL FINDEN ===========================
test('Das Modell wird über ID oder Namen gefunden', () => {
  assert.equal(resolveCommandModel(S, 'HT').id, 'HT');
  assert.equal(resolveCommandModel(S, 'ht').id, 'HT', 'Groß- und Kleinschreibung ist egal');
  assert.equal(resolveCommandModel(S, 'Holy Trainer').id, 'HT');
  assert.equal(resolveCommandModel(S, 'holytrainer').id, 'HT', 'Leerzeichen sind kein Unterschied');
  assert.equal(resolveCommandModel(S, 'Gibtsnicht'), null);
});

test('Ein archiviertes Modell bleibt für alte Shortcuts erreichbar', () => {
  const s = normalizeSettings({ models: [
    ...S.models.map(m => (m.id === 'PC' ? { ...m, archived: true } : m)),
  ] });
  assert.equal(resolveCommandModel(s, 'PC').id, 'PC');
  assert.ok(planCommand({ events: [] }, s, parseCommand('locked://log?m=PC'), JETZT).ok);
});

// =========================== PLANEN ===========================
test('Ohne Zeitangabe gilt jetzt', () => {
  const p = planCommand({ events: [] }, S, parseCommand('locked://log?m=HT'), JETZT);
  assert.ok(p.ok);
  assert.deepEqual(p.event, { date: '2026-09-03', time: '10:20', type: 'HT' });
  assert.equal(p.meldung, 'Holy Trainer 10:20 eingetragen');
});

test('Zeit und Datum lassen sich vorgeben — auch relativ', () => {
  const mit = (q) => planCommand({ events: [] }, S, parseCommand('locked://log?m=KK&' + q), JETZT).event;
  assert.deepEqual(mit('t=7:05'), { date: '2026-09-03', time: '07:05', type: 'KK' });
  assert.deepEqual(mit('t=0730'), { date: '2026-09-03', time: '07:30', type: 'KK' });
  assert.equal(mit('d=2026-08-30').date, '2026-08-30');
  assert.equal(mit('d=-1').date, '2026-09-02', '„-1" ist gestern');
  assert.equal(mit('d=gestern').date, '2026-09-02');
});

test('Unlesbare Zeit oder Datum werden gemeldet, nicht geraten', () => {
  const p = planCommand({ events: [] }, S, parseCommand('locked://log?m=HT&t=25:00'), JETZT);
  assert.equal(p.ok, false);
  assert.match(p.fehler, /Zeit/);
  const q = planCommand({ events: [] }, S, parseCommand('locked://log?m=HT&d=letzten Dienstag'), JETZT);
  assert.equal(q.ok, false);
  assert.match(q.fehler, /Datum/);
  const r = planCommand({ events: [] }, S, parseCommand('locked://log?m=Käfig7'), JETZT);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /Unbekanntes Modell/);
});

test('Derselbe Auslöser in derselben Minute schreibt nicht zweimal', () => {
  const data = { events: [{ date: '2026-09-03', time: '10:20', type: 'HT' }] };
  const p = planCommand(data, S, parseCommand('locked://log?m=HT'), JETZT);
  assert.ok(p.ok);
  assert.equal(p.doppelt, true);
  assert.match(p.meldung, /stand schon/);
});

test('Derselbe Zustand wird eingetragen, aber als unverändert gemeldet', () => {
  const data = { events: [{ date: '2026-09-03', time: '08:00', type: 'HT' }] };
  const p = planCommand(data, S, parseCommand('locked://log?m=HT'), JETZT);
  assert.equal(p.doppelt, false, 'andere Minute — es ist ein eigener Eintrag');
  assert.equal(p.unveraendert, true);
  assert.equal(p.vorher.type, 'HT');
  assert.match(p.meldung, /Zustand war schon/);
});

test('Ein Wechsel ist kein unveränderter Zustand', () => {
  const data = { events: [{ date: '2026-09-03', time: '08:00', type: 'HT' }] };
  const p = planCommand(data, S, parseCommand('locked://log?m=KK'), JETZT);
  assert.equal(p.unveraendert, false);
  assert.equal(p.vorher.type, 'HT');
});

test('Ein Orgasmus-Ereignis kennt keinen Vorzustand', () => {
  const p = planCommand({ events: [] }, S, parseCommand('locked://log?m=OR'), JETZT);
  assert.ok(p.ok);
  assert.equal(p.model.kind, 'orgasm');
  assert.equal(p.vorher, null);
  assert.equal(p.unveraendert, false);
});

test('Ein späterer Eintrag ändert den Zustand des Vortags nicht', () => {
  const data = { events: [
    { date: '2026-09-02', time: '09:00', type: 'HT' },
    { date: '2026-09-03', time: '09:00', type: 'KK' },
  ] };
  const p = planCommand(data, S, parseCommand('locked://log?m=HT&d=-1&t=20:00'), JETZT);
  assert.equal(p.vorher.type, 'HT', 'maßgeblich ist der Stand zur Eintragszeit');
  assert.equal(p.unveraendert, true);
});

test('Eine Regeneration außer der Reihe wird eingetragen und gemeldet', () => {
  const laufend = { events: [{ date: '2026-09-03', time: '09:00', type: 'REG' }] };
  const a = planCommand(laufend, S, parseCommand('locked://log?m=REG'), JETZT);
  assert.equal(a.hinweis, 'eine läuft schon');
  assert.match(a.meldung, /läuft schon/);

  const gesperrt = { events: [
    { date: '2026-09-01', time: '09:00', type: 'REG' },
    { date: '2026-09-01', time: '12:00', type: 'KK' },
  ] };
  const b = planCommand(gesperrt, S, parseCommand('locked://log?m=REG'), JETZT);
  assert.equal(b.hinweis, 'Sperrfrist läuft noch');
  assert.deepEqual(b.event, { date: '2026-09-03', time: '10:20', type: 'REG' },
    'gemeldet, nicht verweigert — geschehen ist geschehen');

  const frei = planCommand({ events: [] }, S, parseCommand('locked://log?m=REG'), JETZT);
  assert.equal(frei.hinweis, null);
});

test('Ein gewöhnliches Modell trägt keinen Regenerations-Hinweis', () => {
  const laufend = { events: [{ date: '2026-09-03', time: '09:00', type: 'REG' }] };
  assert.equal(planCommand(laufend, S, parseCommand('locked://log?m=HT'), JETZT).hinweis, null);
});

// =========================== ZUSTAND ===========================
test('Ohne Historie ist der Zustand offen', () => {
  const z = currentStateAt([], S, JETZT.getTime());
  assert.equal(z.type, 'KK');
  assert.equal(z.ms, null);
});

test('Orgasmus-Ereignisse sagen nichts über den Verschluss', () => {
  const evs = [
    { date: '2026-09-03', time: '08:00', type: 'HT' },
    { date: '2026-09-03', time: '09:00', type: 'OR' },
  ];
  assert.equal(currentStateAt(evs, S, JETZT.getTime()).type, 'HT');
});

// =========================== LAUNCHER ===========================
test('Kurzbefehle enthalten keine Ereignisse mit Preis', () => {
  const liste = shortcutModels(S);
  assert.ok(liste.length <= MAX_SHORTCUTS);
  assert.ok(!liste.some(m => m.kind === 'orgasm'),
    'ein Fehlgriff am Handgelenk darf keine Punkte kosten');
});

test('Der offene Zustand bekommt immer einen Platz', () => {
  const liste = shortcutModels(S, 2);
  assert.equal(liste.length, 2);
  assert.ok(liste.some(m => m.isOpen), 'sonst führte kein Kurzbefehl wieder heraus');
  assert.equal(liste[0].id, 'HT', 'davor bleibt die Reihenfolge der Registry');
});

test('Archivierte Modelle stehen nicht im Launcher', () => {
  const s = normalizeSettings({ models: S.models.map(m => (m.id === 'HT' ? { ...m, archived: true } : m)) });
  assert.ok(!shortcutModels(s).some(m => m.id === 'HT'));
});

// =========================== UHR ===========================
test('Zwei Buchstaben stehen für einen Namen', () => {
  assert.equal(initialen('Holy Trainer'), 'HT');
  assert.equal(initialen('Neosteel'), 'NE');
  assert.equal(initialen('Nicht verschlossen'), 'NV');
  assert.equal(initialen('Cobra Variante A'), 'CV');
  assert.equal(initialen('  '), '•', 'ein leerer Name lässt den Knopf nicht leer');
});

test('Die Uhr bekommt Modelle und den aktuellen Zustand', () => {
  const data = { events: [{ date: '2026-09-03', time: '08:00', type: 'HT' }] };
  const p = watchPayload(data, S, MAX_TILE_BUTTONS, JETZT);
  assert.ok(p.models.length <= MAX_TILE_BUTTONS);
  assert.deepEqual(p.models[0], { id: 'HT', label: 'Holy Trainer', kurz: 'HT', color: '#84cc16' });
  assert.ok(!p.models.some(m => m.id === 'OR'),
    'was Punkte kostet, gehört nicht auf einen Knopf ohne Rückfrage');
  assert.ok(p.models.some(m => m.id === 'KK'), 'der Weg heraus ist immer dabei');
  assert.deepEqual(p.jetzt, { id: 'HT', label: 'Holy Trainer', seit: '08:00' });
});

test('Ohne Historie meldet die Uhr den offenen Zustand', () => {
  const p = watchPayload({ events: [] }, S, MAX_TILE_BUTTONS, JETZT);
  assert.equal(p.jetzt.id, 'KK');
  assert.equal(p.jetzt.seit, '', 'nichts vorzuweisen ist besser als eine erfundene Uhrzeit');
});

test('Die Web-App kennt alle Parameter, die sie aufräumen muss', () => {
  for (const name of ['log', 'm', 't', 'zeit', 'd', 'datum', 'app']) {
    assert.ok(CMD_PARAMS.includes(name), `${name} bliebe sonst in der Adresse stehen`);
  }
});

test('Die Adressen sind fertig zum Kopieren', () => {
  assert.equal(commandUrl('HT'), 'locked://log?m=HT');
  assert.equal(webCommandUrl('https://themachtin.github.io/locked-android/', 'KK'),
    'https://themachtin.github.io/locked-android/?log=KK');
  assert.equal(webCommandUrl('http://localhost:3000/?x=1#weg', 'KK'),
    'http://localhost:3000/?x=1&log=KK');
});
