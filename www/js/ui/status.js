/**
 * Der laufende Zustand: das getragene Modell und die vier Uhren daneben.
 *
 * Dieser Block steht an zwei Stellen — im Eintrag-Tab für den gewählten Tag,
 * im Dashboard für jetzt. Er liegt deshalb hier und nicht in einer der beiden
 * Seiten: zwei Fassungen desselben Blocks wären zwei Wahrheiten, und die
 * Abweichung fiele erst auf, wenn eine davon falsch ist.
 *
 * Alles kommt über `statusContext()` herein, inklusive `now` — dieselbe Regel
 * wie im Rechenkern, damit sich beide Seiten reproduzierbar prüfen lassen.
 */

import { lockPhaseStart, unopenedPhaseStart, lastOrgasmMs } from '../core/calc.js';
import { labelOf, modelMap, resolveModel, KIND_ORGASM } from '../core/settings.js';
import { isoOf, hmOf } from '../core/time.js';
import {
  fmtInt, fmtNum, fmtDateShort, fmtDurationLong, msToHours, msToDays, escapeHtml, refTimeFor,
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

/** „Modell jetzt: Holy Trainer (seit 08:30)" — eine Zeile, kein Rätsel. */
export function currentModelHtml(ctx) {
  const { d, settings: s, iso, lock } = ctx;
  const map = modelMap(s);
  let cur = d ? d.prevEndModel : null;
  let curZeit = '00:00';
  if (d) {
    for (const ev of d.events) {
      if (resolveModel(s, map, ev.type).kind === KIND_ORGASM) continue;
      cur = ev.type; curZeit = ev.time;
    }
  }
  const curM = cur ? resolveModel(s, map, cur) : null;
  if (!curM) return '';
  // Bei einer laufenden Unterbrechung ist die wichtigere Auskunft, dass die
  // verschlossene Phase davon unberührt weiterläuft — sonst liest sich
  // „Modell jetzt: Reinigung" wie ein Abbruch, und genau das ist es nicht.
  const seit = (curM.locked || curM.pause) ? ` (seit ${curZeit})` : '';
  const weiter = curM.pause && lock ? ' <span class="hint">— Phase läuft weiter</span>' : '';
  return `<span class="dot" style="background:${curM.color}"></span>`
    + `<span>Modell ${ctx.heute ? 'jetzt' : 'Ende ' + fmtDateShort(iso)}: `
    + `<b>${escapeHtml(curM.label)}</b>${seit}${weiter}</span>`;
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

export function statusRowHtml(ctx) {
  return statusRowFromItems(statusItems(ctx));
}
