import test from 'node:test';
import assert from 'node:assert/strict';

import { pendingEscalation, escalationEvents, lastRealInteractionMs } from '../www/js/core/escalation.js';
import { normalizeSettings } from '../www/js/core/settings.js';

const ev = (date, time, type, extra) => ({ date, time, type, ...extra });

test('Automatisch erzeugte Einträge zählen nicht als Interaktion', () => {
  const events = [
    ev('2026-03-01', '10:00', 'HT'),
    ev('2026-03-05', '12:00', 'OR', { auto_inactivity: true }),
  ];
  const ms = lastRealInteractionMs(events);
  assert.equal(new Date(ms).toISOString().slice(0, 10), '2026-03-01');
});

test('Vor Ablauf der Frist wird nichts vorgeschlagen', () => {
  const data = { events: [ev('2026-03-01', '10:00', 'HT')] };
  const v = pendingEscalation(data, { now: new Date('2026-03-03T10:00:00') });
  assert.equal(v.faellig, false);
});

test('Nach der Frist werden Öffnung und Orgasmen vorgeschlagen, aber nichts geschrieben', () => {
  const events = [ev('2026-03-01', '10:00', 'HT')];
  const v = pendingEscalation({ events }, { now: new Date('2026-03-07T10:00:00') });
  assert.equal(v.faellig, true);
  assert.equal(v.offen.date, '2026-03-05', 'vier Tage nach der letzten Interaktion');
  assert.equal(v.offen.type, 'KK');
  assert.equal(v.orgasmen.length, 2, 'ab dem Tag nach der Öffnung: 06. und 07.');
  assert.deepEqual(v.orgasmen.map(o => o.date), ['2026-03-06', '2026-03-07']);
  assert.equal(events.length, 1, 'die Daten bleiben unangetastet');
});

test('Ein verworfener Vorschlag setzt die Frist neu', () => {
  const data = {
    events: [ev('2026-03-01', '10:00', 'HT')],
    meta: { escalationDismissedAt: '2026-03-07T10:00:00' },
  };
  assert.equal(pendingEscalation(data, { now: new Date('2026-03-08T10:00:00') }).faellig, false);
  assert.equal(pendingEscalation(data, { now: new Date('2026-03-12T10:00:00') }).faellig, true);
});

test('Übernommene Vorschläge tauchen nicht doppelt auf', () => {
  const events = [ev('2026-03-01', '10:00', 'HT')];
  const now = new Date('2026-03-07T10:00:00');
  const v = pendingEscalation({ events }, { now });
  events.push(...escalationEvents(v));
  const nachher = pendingEscalation({ events }, { now });
  assert.equal(nachher.faellig, false);
});

test('Erzeugte Events sind als automatisch und geschätzt markiert', () => {
  const v = pendingEscalation({ events: [ev('2026-03-01', '10:00', 'HT')] },
    { now: new Date('2026-03-06T10:00:00') });
  const out = escalationEvents(v);
  assert.ok(out.every(e => e.auto_inactivity));
  assert.ok(out.filter(e => e.type === 'OR').every(e => e.time_estimated));
});

test('Die Regel folgt der Registry: eigener offener Zustand, eigene Frist', () => {
  const settings = normalizeSettings({
    models: [
      { id: 'KAEFIG', label: 'Käfig', rate: 0.5, locked: true },
      { id: 'FREI', label: 'Frei', rate: -1, isOpen: true },
      { id: 'KOMMEN', kind: 'orgasm', label: 'Orgasmus' },
    ],
    rules: { inactivityAutoDays: 2 },
  });
  const v = pendingEscalation({ events: [ev('2026-03-01', '10:00', 'KAEFIG')] },
    { now: new Date('2026-03-04T10:00:00'), settings });
  assert.equal(v.offen.type, 'FREI');
  assert.equal(v.offen.date, '2026-03-03', 'zwei Tage statt vier');
  assert.equal(v.orgasmen[0].type, 'KOMMEN');
});
