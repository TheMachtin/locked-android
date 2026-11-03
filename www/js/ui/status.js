/**
 * Der laufende Zustand: die Uhren am Käfig und am Orgasmus.
 *
 * Er steht an zwei Stellen — als Zeile oben auf „Heute" (`statusKompakt()`) und
 * als vier Kacheln in der Live-Ansicht (`jetzt.html`), die sie aus einem
 * mitgegebenen Paket füllt. Beide Formen kommen aus derselben Rechnung
 * (`statusItems()`): zwei Fassungen desselben Blocks wären zwei Wahrheiten, und
 * die Abweichung fiele erst auf, wenn eine davon falsch ist.
 *
 * Alles kommt über `statusContext()` herein, inklusive `now` — dieselbe Regel
 * wie im Rechenkern, damit sich beide Seiten reproduzierbar prüfen lassen.
 */

import { lockPhaseStart, unopenedPhaseStart, lastOrgasmMs } from '../core/calc.js';
import { labelOf } from '../core/settings.js';
import { isoOf, hmOf } from '../core/time.js';
import {
  fmtInt, fmtNum, fmtDateShort, fmtDurationShort, fmtDurationLong, msToHours, msToDays,
  escapeHtml, refTimeFor,
} from './format.js';

/**
 * Alles, was die beiden Renderer brauchen, einmal berechnet.
 *
 * @param {string} iso   der betrachtete Tag
 * @param {object} q     { days, byDate, settings, events, now? }
 */
export function statusContext(iso, q) {
  const now = q.now || new Date();
  const refMs = refTimeFor(iso, now).getTime();
  const events = q.events || [];
  return {
    iso, now, refMs, events,
    heute: iso === isoOf(now),
    days: q.days || [],
    d: (q.byDate || {})[iso] || null,
    settings: q.settings,
    lock: lockPhaseStart(events, q.settings, refMs),
    uo: unopenedPhaseStart(events, q.settings, refMs),
  };
}

/**
 * Die vier Kacheln als Daten — die Reihenfolge ist paarweise gedacht: oben die
 * beiden Uhren am Käfig, unten die beiden am Orgasmus.
 *
 * Die beiden oberen zählen vollendete 24-h-Abschnitte, nicht Kalendertage —
 * dieselbe Einheit, in der die Strecke bezahlt wird, und die einzige, die zu
 * den Stunden daneben passt.
 */
export function statusItems(ctx) {
  const { d, days, settings: s, refMs, lock, uo, events } = ctx;
  const idx = d ? days.indexOf(d) : -1;

  let ofTage = 0;
  for (let i = idx; i >= 0 && days[i].orgasmusfrei; i--) ofTage++;
  const letzterOr = lastOrgasmMs(events, s, refMs);

  const seitStempel = (ms) => `seit ${fmtDateShort(isoOf(new Date(ms)))} ${hmOf(new Date(ms))}`;

  return [
    {
      days: lock ? msToDays(refMs - lock.ms) : 0, label: 'Verschlossen',
      ms: lock ? Math.max(0, refMs - lock.ms) : null,
      // Läuft gerade eine Unterbrechung, gehört das in die Kachel und nicht in
      // einen Tooltip — auf dem Telefon gibt es kein Darüberfahren.
      since: !lock ? 'gerade offen'
        : seitStempel(lock.ms)
          + (lock.paused
            ? `<br>${escapeHtml(labelOf(s, lock.pauseModel))} seit ${hmOf(new Date(lock.pauseSince))}`
            : ''),
    },
    {
      days: uo ? msToDays(refMs - uo.ms) : 0, label: 'Ungeöffnet',
      ms: uo ? Math.max(0, refMs - uo.ms) : null,
      // Was die Strecke *einbringt*, gehört an die Strecke — sonst steht die
      // Belohnung nur in der Aufschlüsselung, und dort erst, wenn sie schon
      // verdient ist. Steht keine Strecke, ist die interessante Auskunft warum
      // nicht: vor allem im Fall, in dem die Kachel daneben weiterläuft.
      since: uo
        ? (d && d.uoBonus
            ? `+${fmtNum(d.uoBonus, d.uoBonus % 1 ? 1 : 0)} heute · ${seitStempel(uo.ms)}`
            : seitStempel(uo.ms))
        : (lock && lock.paused
            ? `${escapeHtml(labelOf(s, lock.pauseModel))} läuft`
            : 'gerade offen'),
    },
    {
      days: ofTage, label: 'Orgasmusfrei',
      ms: letzterOr != null ? Math.max(0, refMs - letzterOr) : null,
      since: letzterOr != null ? seitStempel(letzterOr) : 'keiner erfasst',
    },
    {
      days: null, label: 'Multiplikator',
      text: `× ${fmtNum(d ? d.mult : 1, 2)}`,
      since: d && d.mult >= s.points.streakCap ? 'Deckel erreicht' : `Deckel × ${fmtNum(s.points.streakCap, 2)}`,
    },
  ];
}

/**
 * Die vier Kacheln zeichnen.
 *
 * Getrennt von `statusItems()`, weil die Live-Ansicht dieselben Kacheln aus
 * einem mitgegebenen Paket füllt statt aus der Historie (siehe `ui/jetzt.js`).
 * Zwei Renderer wären zwei Fassungen desselben Blocks — genau das, was der
 * Dateikopf vermeiden will.
 */
export function statusRowFromItems(items) {
  return items.map(x => `<div class="streak-item">
    <div class="days">${x.text != null ? x.text : `${x.days} T`}${x.ms != null
      ? ` <span class="hrs" title="${fmtDurationLong(x.ms)}">(${fmtInt(msToHours(x.ms))} h)</span>` : ''}</div>
    <div class="label">${x.label}</div>
    <div class="since">${x.since || '—'}</div>
  </div>`).join('');
}

/**
 * Die Zeile oben auf „Heute": drei Uhren statt vier Kacheln.
 *
 * Gerechnet wird hier nichts Neues — die Zahlen kommen aus `statusItems()`,
 * damit die Zeile und die Live-Ansicht nicht auseinanderlaufen. Was sich
 * ändert, ist die Form: „4 T 6 h" statt „4 T (102 h)", und der Multiplikator
 * steht als Zusatz an der Strecke, aus der er entsteht, statt als vierte
 * Kachel. Der Zuschlag der ungeöffneten Strecke steht an ihr, solange er heute
 * etwas bringt.
 *
 * @returns {Array<{ wert, label, zusatz, seit, deckel? }>}  seit ist HTML (escaped)
 */
export function statusKompakt(ctx) {
  const [verschl, ungeoeffnet, ofrei, mult] = statusItems(ctx);
  const { lock, d, settings: s } = ctx;
  const pause = lock && lock.paused ? escapeHtml(labelOf(s, lock.pauseModel)) : null;
  const bonus = d && d.uoBonus ? `+${fmtNum(d.uoBonus, d.uoBonus % 1 ? 1 : 0)} heute` : null;
  return [
    {
      wert: verschl.ms != null ? fmtDurationShort(verschl.ms) : '—',
      label: lock ? 'verschlossen' : 'gerade offen',
      zusatz: pause,
      seit: verschl.since,
    },
    {
      wert: ungeoeffnet.ms != null ? fmtDurationShort(ungeoeffnet.ms) : '—',
      label: 'ungeöffnet',
      zusatz: bonus,
      seit: ungeoeffnet.since,
    },
    {
      wert: `${ofrei.days} T`,
      label: 'orgasmusfrei',
      zusatz: mult.text,
      seit: ofrei.since,
      deckel: mult.since,
    },
  ];
}
