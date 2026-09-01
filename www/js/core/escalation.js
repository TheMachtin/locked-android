/**
 * Inaktivitäts-Regel.
 *
 * Wer die App tagelang nicht anfasst, hat trotzdem etwas getan — nur nicht
 * eingetragen. Die Regel *schlägt* die fehlenden Einträge vor, schreibt aber
 * nichts von allein: erfundene Einträge wären später nicht mehr von echten zu
 * unterscheiden und würden die Datengrundlage entwerten.
 *
 * Welches Modell als "geöffnet" eingetragen wird, kommt aus der Registry —
 * es kann umbenannt werden, ohne dass hier etwas anzupassen wäre.
 */

import { isoOf, pad2, eventSortKey } from './time.js';
import { normalizeSettings, openModelId, orgasmModels } from './settings.js';

/** Zeitpunkt der letzten *echten* Interaktion (automatisch erzeugte zählen nicht). */
export function lastRealInteractionMs(events) {
  const evs = (events || []).filter(e => !e.auto_inactivity && !e.auto_regen_timeout);
  if (!evs.length) return null;
  const latest = evs.reduce((a, b) => (eventSortKey(b) > eventSortKey(a) ? b : a));
  return new Date(`${latest.date}T${latest.time}:00`).getTime();
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
  const orModel = orgasmModels(settings).find(m => !m.archived) || orgasmModels(settings)[0];
  const events = (data && data.events) || [];
  const leer = { faellig: false, seitMs: 0, anchorMs: null, offen: null, orgasmen: [], anzahl: 0 };

  const lastMs = lastRealInteractionMs(events);
  if (!lastMs) return leer;

  // Ein verworfener Vorschlag setzt die Uhr neu — sonst käme er bei jedem Start wieder.
  const dismissedAt = data && data.meta && data.meta.escalationDismissedAt;
  const dismissedMs = dismissedAt ? new Date(dismissedAt).getTime() : 0;
  const anchorMs = Math.max(lastMs, isFinite(dismissedMs) ? dismissedMs : 0);

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
