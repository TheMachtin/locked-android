/**
 * Der „Jetzt"-Block als Paket zum Mitgeben.
 *
 * Der Block im Dashboard hängt an einer Handvoll Zeitstempeln — verschlossen
 * seit, ungeöffnet seit, letzter Orgasmus — und rechnet alles andere daraus.
 * Genau das macht ihn teilbar: wer die Anker hat, kann die Uhren selbst
 * weiterlaufen lassen, ohne die Historie zu kennen. Das Paket enthält deshalb
 * keine Ereignisse, keine Einstellungen und keine Punkte, sondern nur die paar
 * Zahlen, die der Block zeigt.
 *
 * Hier steht die Rechnung, nicht die Darstellung: `jetztWerte()` liefert
 * dieselben Größen, die `ui/status.js` aus der vollen Historie zieht. Die
 * Beschriftung dazu steht in `ui/jetzt.js`.
 */

import { lockPhaseStart, unopenedPhaseStart, lastOrgasmMs, TAG_MS } from './calc.js';
import { modelMap, resolveModel, labelOf, orgasmPrice, KIND_ORGASM } from './settings.js';
import { currentStateAt } from './command.js';
import { isoOf, isoDaysBetween } from './time.js';

/** Erhöhen, wenn sich die Form ändert — die Anzeigeseite lehnt Fremdes ab. */
export const JETZT_VERSION = 1;

/**
 * Das Paket aus dem aktuellen Stand bauen.
 *
 * @param {object} data       STATE.data
 * @param {object} berechnet  Ergebnis von computeAll(data) — für die Tagesreihe
 * @param {Date}   [now]
 */
export function jetztPayload(data, berechnet, now) {
  const jetzt = now instanceof Date ? now : new Date();
  const refMs = jetzt.getTime();
  const iso = isoOf(jetzt);
  const s = berechnet.settings;
  const events = data.events || [];
  const map = modelMap(s);

  const st = currentStateAt(events, s, refMs);
  const m = st.type ? resolveModel(s, map, st.type) : null;
  const lock = lockPhaseStart(events, s, refMs);
  const uo = unopenedPhaseStart(events, s, refMs);

  // Zwei verwandte, aber verschiedene Größen: `ofTage` zählt die
  // orgasmusfreien Tage *bis einschließlich heute* (das zeigt die Kachel),
  // `streakTage` die *davor* (daraus bildet scoreDay den Multiplikator).
  const d = berechnet.byDate[iso] || null;
  const idx = d ? berechnet.days.indexOf(d) : -1;
  let ofTage = 0;
  for (let i = idx; i >= 0 && berechnet.days[i].orgasmusfrei; i--) ofTage++;
  let streakTage = 0;
  for (let i = idx - 1; i >= 0 && berechnet.days[i].orgasmusfrei; i--) streakTage++;

  const orModel = s.models.find(x => x.kind === KIND_ORGASM && !x.archived)
    || s.models.find(x => x.kind === KIND_ORGASM);

  return {
    v: JETZT_VERSION,
    stand: new Date(refMs).toISOString(),
    standIso: iso,
    // `seitMs` statt „seit 08:30": eine Uhrzeit ohne Datum wird falsch, sobald
    // der Betrachter sie am nächsten Tag liest.
    modell: m ? {
      label: m.label,
      farbe: m.color,
      seitMs: st.ms,
      // Bei offen getragenen Modellen zeigt auch die App kein „seit".
      zeigtSeit: !!(m.locked || m.pause),
      pause: !!m.pause,
    } : null,
    lock: lock ? {
      seitMs: lock.ms,
      pauseLabel: lock.paused ? labelOf(s, lock.pauseModel) : null,
      pauseSeitMs: lock.paused ? lock.pauseSince : null,
    } : null,
    uo: uo ? { seitMs: uo.ms } : null,
    // Der heute schon gutgeschriebene Zuschlag. Ab dem nächsten Tag rechnet die
    // Anzeigeseite ihn selbst aus der laufenden Strecke — siehe uoBonusAn().
    uoBonusHeute: d ? d.uoBonus : 0,
    letzterOrgasmusMs: lastOrgasmMs(events, s, refMs),
    ofTage,
    streakTage,
    punkte: {
      streakK: s.points.streakK,
      streakCap: s.points.streakCap,
      bonusUngeoeffnet: s.points.bonusUngeoeffnet,
      bonusUngeoeffnetCap: s.points.bonusUngeoeffnetCap,
    },
    orgasmus: orModel ? {
      label: orModel.label,
      priceMin: orModel.priceMin,
      priceMax: orModel.priceMax,
      halflifeDays: orModel.halflifeDays,
      repeatFactor: orModel.repeatFactor,
    } : null,
  };
}

/** Grobe Prüfung, bevor die Anzeigeseite etwas Fremdes rendert. */
export function istJetztPayload(p) {
  return !!p && typeof p === 'object' && p.v === JETZT_VERSION
    && typeof p.standIso === 'string' && !!p.punkte;
}

/**
 * Vergangene Kalendertage seit dem Stand — die Einheit, in der Strecken zählen.
 *
 * Gerechnet wird in der Zeitzone des Betrachters. Sitzt der in einer anderen
 * als der Schreibende, kann der Tageswechsel um einen Tag danebenliegen; die
 * Uhren daneben laufen absolut und sind davon nicht betroffen.
 */
function tageSeitStand(p, jetzt) {
  const n = isoDaysBetween(p.standIso, isoOf(jetzt));
  return isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Der Ungeöffnet-Zuschlag des angezeigten Tages.
 *
 * Am Tag des Stands steht er im Paket — er kann Marken enthalten, die zu einer
 * inzwischen beendeten Strecke gehörten. An jedem späteren Tag kann nur noch
 * die laufende Strecke Marken setzen, und die rechnet sich aus ihrem Anker.
 */
function uoBonusAn(p, jetzt, tage) {
  if (tage === 0) return p.uoBonusHeute || 0;
  if (!p.uo) return 0;
  const nowMs = jetzt.getTime();
  const tagBeginn = new Date(jetzt);
  tagBeginn.setHours(0, 0, 0, 0);
  const heute = isoOf(jetzt);
  const P = p.punkte;
  let bonus = 0;
  const erste = Math.max(1, Math.ceil((tagBeginn.getTime() - p.uo.seitMs) / TAG_MS));
  for (let n = erste; ; n++) {
    const t = p.uo.seitMs + n * TAG_MS;
    if (t > nowMs) break;
    if (isoOf(new Date(t)) === heute) bonus += Math.min(P.bonusUngeoeffnet * n, P.bonusUngeoeffnetCap);
  }
  return bonus;
}

/**
 * Die Zahlen des Blocks zum Zeitpunkt `now`.
 *
 * Die Uhren ergeben sich aus den Ankern, die Streckenlängen aus den vergangenen
 * Kalendertagen: solange kein neues Ereignis dazukommt, ist jeder Tag nach dem
 * Stand orgasmusfrei und ungeöffnet — und sobald eines dazukommt, schreibt die
 * App ohnehin ein neues Paket. Die Ableitung ist damit nicht geschätzt, sondern
 * für den Zeitraum, den sie abdeckt, exakt.
 */
export function jetztWerte(p, now) {
  const jetzt = now instanceof Date ? now : new Date();
  const refMs = jetzt.getTime();
  const tage = tageSeitStand(p, jetzt);

  const ofTage = (p.ofTage || 0) + tage;
  // Vor *heute* liegen an einem späteren Tag genau die orgasmusfreien Tage bis
  // gestern — das ist ofTage von gestern.
  const streakTage = tage === 0 ? (p.streakTage || 0) : ofTage - 1;
  const mult = Math.min(1 + p.punkte.streakK * Math.max(0, streakTage), p.punkte.streakCap);

  const letzterOr = p.letzterOrgasmusMs;
  const abstandTage = letzterOr != null ? (refMs - letzterOr) / 86400000 : Infinity;
  const preis = p.orgasmus
    ? { label: p.orgasmus.label, abstandTage, price: orgasmPrice(p.orgasmus, abstandTage, 1) }
    : null;

  return {
    refMs, tage, ofTage, streakTage, mult, preis,
    lockMs: p.lock ? Math.max(0, refMs - p.lock.seitMs) : null,
    uoMs: p.uo ? Math.max(0, refMs - p.uo.seitMs) : null,
    orMs: letzterOr != null ? Math.max(0, refMs - letzterOr) : null,
    uoBonus: uoBonusAn(p, jetzt, tage),
  };
}
