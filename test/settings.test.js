import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSettings, defaultSettings, idFromLabel, openModelId,
  lockedIds, resolveModel, modelMap, orgasmPrice,
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
