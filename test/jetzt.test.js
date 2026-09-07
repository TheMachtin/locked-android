/**
 * Das Paket für die Live-Ansicht.
 *
 * Die entscheidende Frage steht gleich im ersten Test: zeigt die Anzeigeseite
 * dasselbe wie das Dashboard? Sie rechnet aus einer Handvoll Zeitstempel, das
 * Dashboard aus der ganzen Historie — wenn die beiden auseinanderlaufen, sieht
 * der Zuschauer etwas, das es nicht gibt.
 *
 * Danach die Eigenschaft, die das Paket überhaupt teilbar macht: es enthält den
 * Zustand, nicht die Geschichte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAll } from '../www/js/core/calc.js';
import { normalizeSettings } from '../www/js/core/settings.js';
import { statusContext, statusItems } from '../www/js/ui/status.js';
import { jetztPayload, jetztWerte, istJetztPayload } from '../www/js/core/jetzt.js';
import { jetztItems, payloadKodieren, payloadDekodieren } from '../www/js/ui/jetzt.js';
import { normalizeOrdner } from '../www/js/sync/paths.js';

const ev = (date, time, type) => ({ date, time, type });

/** Ein Stand mit laufender Strecke: seit dem 1. verschlossen, Orgasmus davor. */
function fall(now) {
  const data = {
    events: [
      ev('2026-03-01', '08:00', 'HT'),
      ev('2026-02-26', '22:00', 'OR'),
      ev('2026-02-26', '21:00', 'KK'),
      ev('2026-02-20', '09:00', 'HT'),
    ],
    settings: normalizeSettings(null),
  };
  const berechnet = computeAll(data, now);
  return { data, berechnet };
}

const JETZT = new Date('2026-03-05T14:30:00');

test('Live-Ansicht und Dashboard zeigen dieselben vier Kacheln', () => {
  const { data, berechnet } = fall(JETZT);

  const ctx = statusContext('2026-03-05', {
    days: berechnet.days, byDate: berechnet.byDate,
    settings: berechnet.settings, events: data.events, now: JETZT,
  });
  const ausHistorie = statusItems(ctx);
  const ausPaket = jetztItems(jetztPayload(data, berechnet, JETZT), JETZT);

  assert.equal(ausPaket.length, ausHistorie.length);
  for (let i = 0; i < ausHistorie.length; i++) {
    const a = ausHistorie[i], b = ausPaket[i];
    assert.equal(b.label, a.label, `Kachel ${i}: Beschriftung`);
    assert.equal(b.days, a.days, `Kachel ${i} (${a.label}): Tage`);
    assert.equal(b.text ?? null, a.text ?? null, `Kachel ${i} (${a.label}): Text`);
    // Die Millisekunden dürfen sich nicht unterscheiden — beide Seiten rechnen
    // gegen denselben Bezugszeitpunkt.
    assert.equal(b.ms, a.ms, `Kachel ${i} (${a.label}): Dauer`);
  }
});

test('Der Multiplikator im Paket ist der des Dashboards', () => {
  const { data, berechnet } = fall(JETZT);
  const w = jetztWerte(jetztPayload(data, berechnet, JETZT), JETZT);
  assert.equal(w.mult, berechnet.byDate['2026-03-05'].mult);
});

test('Das Paket enthält den Zustand, nicht die Geschichte', () => {
  const { data, berechnet } = fall(JETZT);
  const p = jetztPayload(data, berechnet, JETZT);
  const text = JSON.stringify(p);

  assert.equal(p.events, undefined, 'keine Ereignisse');
  assert.equal(p.settings, undefined, 'keine Einstellungen');
  assert.equal(p.konto, undefined, 'kein Kontostand');
  assert.ok(!text.includes('2026-02-20'), 'kein Datum aus der Historie');
  // Was drin sein muss, damit die Anzeige rechnen kann.
  assert.ok(p.lock && p.lock.seitMs > 0);
  assert.ok(p.punkte.streakCap > 1);
  assert.ok(istJetztPayload(p));
});

test('Ohne neue Ereignisse zählen die Strecken von allein weiter', () => {
  const { data, berechnet } = fall(JETZT);
  const p = jetztPayload(data, berechnet, JETZT);
  const heute = jetztWerte(p, JETZT);

  // Zwei Tage später, dasselbe Paket: die Anzeige rechnet die Tage selbst dazu.
  const spaeter = new Date('2026-03-07T14:30:00');
  const dann = jetztWerte(p, spaeter);
  assert.equal(dann.ofTage, heute.ofTage + 2);
  assert.equal(dann.lockMs, heute.lockMs + 2 * 86400000);
  assert.ok(dann.mult > heute.mult, 'der Multiplikator wächst mit der Strecke');

  // Und zwar auf denselben Wert, den die App an dem Tag gerechnet hätte.
  const spaeterBerechnet = computeAll(data, spaeter);
  assert.equal(dann.mult, spaeterBerechnet.byDate['2026-03-07'].mult);
  assert.equal(dann.ofTage, jetztWerte(jetztPayload(data, spaeterBerechnet, spaeter), spaeter).ofTage);
});

test('Der Orgasmuspreis fällt mit der Wartezeit', () => {
  const { data, berechnet } = fall(JETZT);
  const p = jetztPayload(data, berechnet, JETZT);
  const jetzt = jetztWerte(p, JETZT).preis;
  const inEinerWoche = jetztWerte(p, new Date('2026-03-12T14:30:00')).preis;
  assert.ok(inEinerWoche.price < jetzt.price, 'länger warten ist billiger');
  assert.ok(inEinerWoche.price >= p.orgasmus.priceMin);
});

test('Ein Paket übersteht den Weg durch einen Link', () => {
  const { data, berechnet } = fall(JETZT);
  const p = jetztPayload(data, berechnet, JETZT);
  const zurueck = payloadDekodieren(payloadKodieren(p));
  assert.deepEqual(zurueck, p);
  assert.ok(!/[^A-Za-z0-9_-]/.test(payloadKodieren(p)), 'nur Zeichen, die in einen Link dürfen');
});

test('Fremdes wird nicht angezeigt', () => {
  assert.equal(istJetztPayload(null), false);
  assert.equal(istJetztPayload({ v: 99, standIso: '2026-03-05', punkte: {} }), false);
  assert.equal(istJetztPayload({ v: 1 }), false);
});

test('Der Ordnerpfad kommt in die Form, die Graph erwartet', () => {
  assert.equal(normalizeOrdner('/Documents/Keusch/'), '/Documents/Keusch');
  assert.equal(normalizeOrdner('Documents//Keusch'), '/Documents/Keusch');
  assert.equal(normalizeOrdner('\\Documents\\Keusch'), '/Documents/Keusch');
  assert.equal(normalizeOrdner('  /A/B/  '), '/A/B');
  assert.equal(normalizeOrdner('/'), '', 'die Wurzel hat keinen Namen');
  assert.equal(normalizeOrdner(''), '');
  assert.equal(normalizeOrdner('/A/../B'), '/A/B', 'relative Sprünge fallen weg');
});
