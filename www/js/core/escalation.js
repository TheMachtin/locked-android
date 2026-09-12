/**
 * Inaktivitäts-Regel.
 *
 * Wer die App tagelang nicht anfasst, hat trotzdem etwas getan — nur nicht
 * eingetragen. Die Regel *schlägt* die fehlenden Einträge vor, schreibt aber
 * nichts von allein: erfundene Einträge wären später nicht mehr von echten zu
 * unterscheiden und würden die Datengrundlage entwerten.
 *
 * Gezählt wird ab dem letzten *Lebenszeichen*, nicht ab dem letzten Eintrag.
 * Der Unterschied ist der Fall, für den die Regel sonst genau falsch liegt: wer
 * eine Woche im selben Käfig steckt, hat nichts einzutragen — der Zustand hat
 * sich ja nicht geändert. Nach dem letzten Eintrag gerechnet sähe das aus wie
 * Verschwinden, und die Regel böte an, eine Öffnung und tägliche Orgasmen
 * nachzutragen, die es nie gab. Ein Blick in die App sagt dagegen genau das,
 * worauf es ankommt: der Stand hier stimmt noch.
 *
 * „Gesehen" hält `meta.lastSeenAt` fest; wie lange die App dafür offen gewesen
 * sein muss, steht in den Regeln (`seenAfterSeconds`) und entscheidet die
 * Oberfläche — hier zählt nur der Zeitstempel.
 *
 * Welches Modell als "geöffnet" eingetragen wird, kommt aus der Registry —
 * es kann umbenannt werden, ohne dass hier etwas anzupassen wäre.
 */

import { isoOf, pad2, eventSortKey } from './time.js';
import { normalizeSettings, openModelId, orgasmModels, brichtStrecke } from './settings.js';

/** Zeitpunkt der letzten *echten* Interaktion (automatisch erzeugte zählen nicht). */
export function lastRealInteractionMs(events) {
  const evs = (events || []).filter(e => !e.auto_inactivity && !e.auto_regen_timeout);
  if (!evs.length) return null;
  const latest = evs.reduce((a, b) => (eventSortKey(b) > eventSortKey(a) ? b : a));
  return new Date(`${latest.date}T${latest.time}:00`).getTime();
}

/**
 * Zeitpunkt des letzten Blicks in die App, oder 0.
 *
 * Nach oben auf „jetzt" begrenzt: die Marke wandert zwischen Geräten mit, und
 * eine Uhr, die vorgeht, dürfte die Frist nicht in die Zukunft schieben.
 */
export function lastSeenMs(data, nowMs) {
  const t = Date.parse((data && data.meta && data.meta.lastSeenAt) || '');
  if (!isFinite(t)) return 0;
  return Math.min(t, (typeof nowMs === 'number') ? nowMs : Date.now());
}

/**
 * Ab wann die Inaktivität zählt: der jüngste Beleg dafür, dass der Stand stimmt.
 *
 * Drei Dinge belegen das, und der späteste gewinnt — ein Eintrag (auch von Uhr
 * oder Automation, denn dafür muss die App nicht auf sein), ein verworfener
 * Vorschlag und ein Blick in die App.
 */
export function attentionAnchorMs(data, nowMs) {
  const eintrag = lastRealInteractionMs((data && data.events) || []) || 0;
  const verworfen = Date.parse((data && data.meta && data.meta.escalationDismissedAt) || '') || 0;
  const anchor = Math.max(eintrag, verworfen, lastSeenMs(data, nowMs));
  return anchor > 0 ? anchor : null;
}

/**
 * Was die Regel vorschlagen würde — ohne etwas zu schreiben.
 * @param {object} data   { events, meta, settings }
 * @param {object} [opts] { now?: Date }
 */
export function pendingEscalation(data, opts) {
  const now = (opts && opts.now) || new Date();
  const settings = (opts && opts.settings) || normalizeSettings(data && data.settings);
  const autoDays = settings.rules.inactivityAutoDays;
  const openId = openModelId(settings);
  // Nachgetragen wird der Orgasmus, nicht irgendein Ereignis: die Regel
  // unterstellt nach langer Funkstille das Naheliegende, und das Naheliegende
  // ist die teure Annahme, nicht die geschonte.
  const ereignisse = orgasmModels(settings);
  const orModel = ereignisse.find(m => brichtStrecke(m) && !m.archived)
    || ereignisse.find(m => !m.archived) || ereignisse[0];
  const events = (data && data.events) || [];
  const leer = { faellig: false, seitMs: 0, anchorMs: null, offen: null, orgasmen: [], anzahl: 0 };

  // Ohne einen einzigen echten Eintrag gibt es keinen Zustand, den man
  // fortschreiben könnte — dann ist auch nichts vorzuschlagen.
  if (!lastRealInteractionMs(events)) return leer;
  const anchorMs = attentionAnchorMs(data, now.getTime());

  const seitMs = now.getTime() - anchorMs;
  if (seitMs < autoDays * 86400000) return { ...leer, seitMs, anchorMs };

  const openAt = new Date(anchorMs + autoDays * 86400000);
  const openIso = isoOf(openAt);
  const openTime = `${pad2(openAt.getHours())}:${pad2(openAt.getMinutes())}`;
  const hatOffen = events.some(e =>
    e.type === openId && e.date === openIso && e.time === openTime && e.auto_inactivity);

  const orgasmen = [];
  if (orModel) {
    const cursor = new Date(openAt);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
    const bis = new Date(now);
    bis.setHours(23, 59, 59, 999);
    while (cursor <= bis) {
      const iso = isoOf(cursor);
      if (!events.some(e => e.type === orModel.id && e.date === iso && e.auto_inactivity)) {
        orgasmen.push({ date: iso, time: '12:00', type: orModel.id });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const offen = hatOffen ? null : { date: openIso, time: openTime, type: openId };
  return {
    faellig: !!offen || orgasmen.length > 0,
    seitMs, anchorMs, offen, orgasmen,
    anzahl: (offen ? 1 : 0) + orgasmen.length,
  };
}

/** Vorschlag in echte Events umwandeln (erst nach Bestätigung durch den Nutzer). */
export function escalationEvents(vorschlag) {
  const out = [];
  if (vorschlag.offen) {
    out.push({ ...vorschlag.offen, auto_inactivity: true });
  }
  for (const o of vorschlag.orgasmen) {
    out.push({ ...o, auto_inactivity: true, time_estimated: true });
  }
  return out;
}
