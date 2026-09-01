import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeData, mergeEvents, mergeMap, mergeSettings, eventKey } from '../www/js/core/merge.js';

const ev = (date, time, type) => ({ date, time, type });
const A = ev('2026-03-01', '08:00', 'HT');
const B = ev('2026-03-01', '20:00', 'KK');
const C = ev('2026-03-02', '09:00', 'NS');

test('Ohne Basis wird vereinigt — nichts geht verloren', () => {
  const { events } = mergeEvents(null, [A], [B]);
  assert.equal(events.length, 2);
});

test('Mit Basis wird eine Löschung als Löschung erkannt', () => {
  const { events, stats } = mergeEvents([A, B], [A], [A, B]);
  assert.deepEqual(events.map(eventKey), [eventKey(A)]);
  assert.equal(stats.entfernt, 1);
});

test('Neuanlagen beider Seiten kommen zusammen', () => {
  const { events, stats } = mergeEvents([A], [A, B], [A, C]);
  assert.equal(events.length, 3);
  assert.equal(stats.hinzu, 1);
});

test('Bei beidseitiger Änderung einer Markierung gewinnt lokal', () => {
  const konflikte = [];
  const out = mergeMap({ x: 1 }, { x: 2 }, { x: 3 }, k => konflikte.push(k));
  assert.equal(out.x, 2);
  assert.deepEqual(konflikte, ['x']);
});

test('Einstellungen: der jüngere Stand gewinnt als Ganzes', () => {
  const alt = { models: [{ id: 'A' }], updatedAt: '2026-01-01T00:00:00Z' };
  const neu = { models: [{ id: 'B' }], updatedAt: '2026-06-01T00:00:00Z' };
  assert.equal(mergeSettings(alt, neu), neu);
  assert.equal(mergeSettings(neu, alt), neu);
  assert.equal(mergeSettings(null, alt), alt);
  assert.equal(mergeSettings(alt, null), alt);
});

test('Einstellungen überleben den Merge — sonst fiele die Registry auf Standard zurück', () => {
  const settings = { models: [{ id: 'X', label: 'Mein Käfig' }], updatedAt: '2026-06-01T00:00:00Z' };
  const { data } = mergeData(
    { events: [A] },
    { events: [A], settings },
    { events: [A, B] });
  assert.deepEqual(data.settings, settings);
});

test('Das Archiv überlebt den Merge und wird nie überschrieben', () => {
  const legacy = { punkte: 12345, formel: 'locked-1.x' };
  const nurRemote = mergeData(null, { events: [] }, { events: [], legacy });
  assert.deepEqual(nurRemote.data.legacy, legacy);

  const beide = mergeData(null, { events: [], legacy }, { events: [], legacy: { punkte: 999 } });
  assert.equal(beide.data.legacy.punkte, 12345, 'der lokale Schnappschuss bleibt stehen');
});

test('Der Stichtag folgt den Einstellungen: die jüngere Bearbeitung gewinnt', () => {
  const { data } = mergeData(null,
    { events: [], settings: { startedAt: '2026-08-31', updatedAt: '2026-08-31T00:00:00Z' } },
    { events: [], settings: { startedAt: '2026-09-15', updatedAt: '2026-09-15T00:00:00Z' } });
  assert.equal(data.settings.startedAt, '2026-09-15');
});

test('meta: der spätere Verwurf gewinnt', () => {
  const { data } = mergeData(null,
    { events: [], meta: { escalationDismissedAt: '2026-03-01T10:00:00Z' } },
    { events: [], meta: { escalationDismissedAt: '2026-03-05T10:00:00Z' } });
  assert.equal(data.meta.escalationDismissedAt, '2026-03-05T10:00:00Z');
});

test('Ein vollständiger Datensatz verliert beim Merge kein Feld', () => {
  const lokal = {
    version: 3,
    events: [A], days: { '2026-03-01': { note: 'x' } }, notes: { '2026-03-02': 'y' },
    meta: { escalationDismissedAt: '2026-03-01T00:00:00Z' },
    settings: { models: [{ id: 'A' }], updatedAt: '2026-08-31T00:00:00Z' },
    legacy: { punkte: 1 },
  };
  const { data } = mergeData(null, lokal, { events: [B] });
  for (const key of Object.keys(lokal)) {
    assert.ok(key in data, `${key} fehlt nach dem Merge`);
  }
  assert.equal(data.events.length, 2);
});
