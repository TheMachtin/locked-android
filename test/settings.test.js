import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSettings, defaultSettings, idFromLabel, cleanId, idFolgtNamen, openModelId,
  lockedIds, pauseIds, lockKind, applyLockKind, resolveModel, modelMap, orgasmPrice,
  SETTINGS_SCHEMA,
} from '../www/js/core/settings.js';

test('Standardregistry ist gültig und deckt die alten Typen ab', () => {
  const s = normalizeSettings(null);
  const ids = s.models.map(m => m.id);
  for (const alt of ['HT', 'PC', 'NS', 'KK', 'REG', 'OR']) {
    assert.ok(ids.includes(alt), `${alt} fehlt — alte Events wären nicht auflösbar`);
  }
  assert.equal(openModelId(s), 'KK');
  assert.deepEqual([...lockedIds(s)].sort(), ['HT', 'NS', 'PC', 'REG']);
});

test('Die Reinigung ist eine Unterbrechung, kein offener Zustand', () => {
  const s = normalizeSettings(null);
  assert.deepEqual([...pauseIds(s)], ['CLEAN']);
  assert.equal(lockKind(s.models.find(m => m.id === 'CLEAN')), 'pause');
  assert.ok(!lockedIds(s).has('CLEAN'), 'sie ist auch keine verschlossene Zeit');
  assert.notEqual(openModelId(s), 'CLEAN');
});

test('Verschlossen und Unterbrechung schließen sich aus', () => {
  const s = normalizeSettings({ models: [
    { id: 'A', label: 'A', rate: 0.5, locked: true, pause: true },
    { id: 'B', label: 'B', isOpen: true, pause: true, locked: true },
  ] });
  const a = s.models.find(m => m.id === 'A');
  assert.equal(lockKind(a), 'locked', 'verschlossen schlägt die Unterbrechung');
  const b = s.models.find(m => m.id === 'B');
  assert.equal(lockKind(b), 'open', 'der offene Zustand ist weder das eine noch das andere');
});

test('Der offene Zustand wird nicht aus den Unterbrechungen gewählt', () => {
  const s = normalizeSettings({ models: [
    { id: 'A', label: 'Käfig', rate: 0.5, locked: true },
    { id: 'P', label: 'Pause', rate: 0, pause: true },
    { id: 'O', label: 'Ohne', rate: -1 },
  ] });
  assert.equal(openModelId(s), 'O');
  assert.equal(lockKind(s.models.find(m => m.id === 'P')), 'pause', 'die Pause bleibt eine Pause');
});

test('Schema-Nachzug: die Reinigung aus einer alten Datei wird zur Unterbrechung — einmal', () => {
  const alt = { models: [
    { id: 'HT', kind: 'model', label: 'Holy Trainer', rate: 0.5, locked: true },
    { id: 'CLEAN', kind: 'model', label: 'Reinigung', rate: 0, locked: false },
    { id: 'KK', kind: 'model', label: 'Nicht verschlossen', rate: -1, isOpen: true },
  ] };
  const nachgezogen = normalizeSettings(alt);
  assert.equal(lockKind(nachgezogen.models.find(m => m.id === 'CLEAN')), 'pause');
  assert.equal(nachgezogen.schema, SETTINGS_SCHEMA, 'die Fassung steht danach in der Datei');

  // Wer sie danach von Hand wieder auf offen stellt, behält das.
  const vonHand = JSON.parse(JSON.stringify(nachgezogen));
  applyLockKind(vonHand.models.find(m => m.id === 'CLEAN'), 'open');
  assert.equal(lockKind(normalizeSettings(vonHand).models.find(m => m.id === 'CLEAN')), 'open',
    'der Nachzug läuft nicht bei jedem Start erneut');
});

test('Schema-Nachzug fasst nur die Reinigung an', () => {
  const s = normalizeSettings({ models: [
    { id: 'HT', kind: 'model', label: 'Holy Trainer', rate: 0.5, locked: true },
    { id: 'AUS', kind: 'model', label: 'Auszeit', rate: 0 },
    { id: 'KK', kind: 'model', label: 'Nicht verschlossen', rate: -1, isOpen: true },
  ] });
  assert.equal(lockKind(s.models.find(m => m.id === 'AUS')), 'open');
});

test('Eine neuere Fassung wird nicht heruntergestuft', () => {
  const s = normalizeSettings({ schema: 99, models: [
    { id: 'CLEAN', kind: 'model', label: 'Reinigung', rate: 0 },
    { id: 'KK', kind: 'model', label: 'Offen', rate: -1, isOpen: true },
  ] });
  assert.equal(s.schema, 99);
  assert.equal(lockKind(s.models.find(m => m.id === 'CLEAN')), 'open',
    'ihr Nachzug ist dort längst gelaufen — hier wäre er ein Rückschritt');
});

test('Doppelte IDs werden entdoppelt', () => {
  const s = normalizeSettings({ models: [
    { id: 'HT', label: 'A' }, { id: 'HT', label: 'B' },
  ] });
  assert.equal(new Set(s.models.map(m => m.id)).size, s.models.length);
});

test('Genau ein offener Zustand — auch wenn die Datei keinen oder mehrere nennt', () => {
  const keiner = normalizeSettings({ models: [
    { id: 'A', label: 'A', rate: 0.5, locked: true },
    { id: 'B', label: 'B', rate: 0, locked: false },
  ] });
  assert.equal(keiner.models.filter(m => m.isOpen).length, 1);
  assert.equal(openModelId(keiner), 'B', 'ein nicht verschlossenes Modell wird bevorzugt');

  const mehrere = normalizeSettings({ models: [
    { id: 'A', label: 'A', isOpen: true }, { id: 'B', label: 'B', isOpen: true },
  ] });
  assert.equal(mehrere.models.filter(m => m.isOpen).length, 1);
});

test('Der offene Zustand kann nicht archiviert werden', () => {
  const s = normalizeSettings({ models: [
    { id: 'A', label: 'A', rate: 0.5, locked: true },
    { id: 'OFF', label: 'Offen', isOpen: true, archived: true },
  ] });
  assert.equal(s.models.find(m => m.isOpen).archived, false);
});

test('Höchstens ein Regenerations-Modell', () => {
  const s = normalizeSettings({ models: [
    { id: 'A', label: 'A', regen: true }, { id: 'B', label: 'B', regen: true },
    { id: 'O', label: 'O', isOpen: true },
  ] });
  assert.equal(s.models.filter(m => m.regen).length, 1);
});

test('Unsinnige Zahlen werden auf brauchbare Werte gezogen', () => {
  const s = normalizeSettings({
    models: [{ id: 'A', label: 'A', rate: 'viel' }, { id: 'O', label: 'O', isOpen: true }],
    points: { streakCap: -3, formDecay: 5, bonusMaxOffenH: 99, streakK: NaN },
  });
  assert.equal(s.models[0].rate, 0);
  assert.ok(s.points.streakCap >= 1);
  assert.ok(s.points.formDecay < 1);
  assert.equal(s.points.bonusMaxOffenH, 24);
  assert.equal(s.points.streakK, defaultSettings().points.streakK);
});

test('Leere Modell-Liste fällt auf die Standards zurück', () => {
  assert.deepEqual(
    normalizeSettings({ models: [] }).models.map(m => m.id),
    defaultSettings().models.map(m => m.id));
});

test('IDs aus Namen sind kollisionsfrei und vertragen Umlaute', () => {
  assert.equal(idFromLabel('Neuer Käfig', []), 'NEUERK');
  assert.equal(idFromLabel('Öse', []), 'OESE');
  const zweite = idFromLabel('Neuer Käfig', ['NEUERK']);
  assert.notEqual(zweite, 'NEUERK');
});

test('Eine von Hand getippte ID wird auf das Erlaubte gestutzt', () => {
  assert.equal(cleanId(' sm '), 'SM');
  assert.equal(cleanId('s-m!'), 'SM');
  assert.equal(cleanId('viel zu langer text'), 'VIELZULA', 'acht Zeichen sind die Grenze');
  assert.equal(cleanId('---'), '', 'daraus wird keine ID — die Oberfläche muss das melden');
});

test('Eine selbst gesetzte ID wandert beim Umbenennen nicht mit', () => {
  // Der Fall, der das Feld nötig macht: zwei Varianten desselben Käfigs. Aus den
  // Namen entstünden STEELW und STEELW2 — zwei Adressen, die niemand auseinanderhält.
  const s = normalizeSettings({ models: [
    { kind: 'model', id: 'SM', label: 'Steelworxx mit',  locked: true, rate: 0.5 },
    { kind: 'model', id: 'SO', label: 'Steelworxx ohne', locked: true, rate: 0.5 },
    { kind: 'model', id: 'KK', label: 'Nicht verschlossen', isOpen: true, rate: -1 },
  ] });
  assert.deepEqual(s.models.map(m => m.id), ['SM', 'SO', 'KK'], 'kurze IDs überleben das Laden');

  const andere = ['SO', 'KK'];
  assert.equal(idFolgtNamen(s.models[0], 'Steelworxx mit', andere), false,
    'SM ist nicht das, was aus dem Namen entstünde — also von Hand gesetzt');
  assert.equal(idFolgtNamen({ id: 'STEELW' }, 'Steelworxx mit', andere), true,
    'STEELW dagegen folgt dem Namen und dürfte ihm weiter folgen');
});

test('Unbekannte IDs lösen sich in ein neutrales Ersatzmodell auf', () => {
  const s = normalizeSettings(null);
  const m = resolveModel(s, modelMap(s), 'WEGGELOESCHT');
  assert.equal(m.rate, 0);
  assert.equal(m.locked, false);
  assert.equal(m.unknown, true);
});

test('Preis-Grenzen: Max unter Min wird angehoben statt invertiert', () => {
  const s = normalizeSettings({ models: [
    { id: 'O', label: 'O', isOpen: true },
    { id: 'OR', kind: 'orgasm', label: 'Orgasmus', priceMin: 40, priceMax: 10 },
  ] });
  const or = s.models.find(m => m.id === 'OR');
  assert.ok(or.priceMax >= or.priceMin);
  assert.ok(orgasmPrice(or, 0, 1) >= or.priceMin);
});

test('Ein flacher Preis ist einstellbar (Min = Max)', () => {
  const or = { priceMin: 25, priceMax: 25, halflifeDays: 7, repeatFactor: 1 };
  assert.equal(orgasmPrice(or, 0, 1), 25);
  assert.equal(orgasmPrice(or, 999, 1), 25);
});
