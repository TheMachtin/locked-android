/**
 * Locked 1.x — die alte Punkteformel, eingefroren.
 *
 * Sie wird **einmal** ausgeführt: beim Umstieg auf 2.0 rechnet sie die bis dahin
 * gesammelte Historie durch, und das Ergebnis wandert als `data.legacy` in die
 * Datei. Danach wird hier nichts mehr gerechnet, nur noch angezeigt.
 *
 * Warum eingefroren und nicht weitergerechnet: die Streak-Terme
 * `s = s × 1,07 + basis` wachsen unbegrenzt exponentiell. Nach einem halben Jahr
 * standen dort Millionen Punkte pro Tag, gegen die alles andere im Modell
 * rechnerisch verschwand. Als laufende Kennzahl taugt das nicht mehr — als
 * Erinnerung an eine abgeschlossene Ära schon.
 *
 * Warum die Zahlen nicht im Code stehen: der Schnappschuss gehört in *deine*
 * Datei. Wer die App frisch installiert, hat kein `legacy` und sieht die
 * Archiv-Karte gar nicht erst — er hat diese Punkte ja nie verdient.
 *
 * Bewusst ohne Import aus settings.js: die alte Formel kannte nur die fünf fest
 * verdrahteten Modelle. Würde sie der heutigen Registry folgen, änderte sich das
 * Archiv rückwirkend, sobald ein Modell umbenannt wird.
 */

import { isoDateAdd, timeToMin, isoDaysBetween } from './time.js';

const L_MODELS  = ['HT', 'PC', 'NS', 'KK', 'REG'];
const L_VERSCHL = ['HT', 'PC', 'NS', 'REG'];
const L_POINTS = {
  hourLocked: 0.5,
  ofBase: 3, ofMul: 1.07,
  uoBase: 5, uoMul: 1.07,
  orgasm: -10,
  keinKG: -5,
};

function groupByDay(events) {
  const by = {};
  for (const e of (events || [])) (by[e.date] ||= []).push(e);
  for (const k in by) by[k].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return by;
}

function dayHours(dayEvents, startModel) {
  const hours = Object.fromEntries(L_MODELS.map(m => [m, 0]));
  let cur = startModel || 'KK';
  let curMin = 0;
  let endModel = cur;
  for (const ev of dayEvents) {
    if (ev.type === 'OR' || !L_MODELS.includes(ev.type)) continue;
    const t = timeToMin(ev.time);
    if (t > curMin) hours[cur] += (t - curMin) / 60;
    cur = ev.type;
    curMin = t;
    endModel = ev.type;
  }
  if (curMin < 1440) hours[cur] += (1440 - curMin) / 60;
  return { hours, endModel };
}

/**
 * Die alte Rechnung über alle Tage bis einschließlich `bis`.
 * Nur vollständige Tage — der angebrochene Umstiegstag gehört schon zur neuen Ära.
 */
export function computeLegacy(data, bis) {
  const events = ((data && data.events) || []).filter(e => e.date < bis);
  const overrides = (data && data.days) || {};
  const byDay = groupByDay(events);
  const dates = [...new Set([
    ...Object.keys(byDay),
    ...Object.keys(overrides).filter(d => d < bis),
  ])].sort();
  if (!dates.length) return null;

  let cursor = dates[0];
  // Bis zum Tag vor dem Stichtag, nicht bis zum letzten Eintrag: in 1.x liefen
  // die Streaks auch an eintragslosen Tagen weiter (das Modell des Vortags galt
  // fort). Beim letzten Event abzubrechen würde das Archiv kleinrechnen.
  const ende = isoDateAdd(bis, -1);
  if (ende < cursor) return null;
  const letzterEintrag = dates[dates.length - 1];
  let prevEndModel = 'KK';
  let ofStreak = 0, uoStreak = 0, cumPunkte = 0;
  let curOf = 0, curUo = 0;

  const snap = {
    von: cursor, bis: ende, letzterEintrag,
    punkte: 0, tage: 0, kalendertage: 0,
    stundenVerschlossen: 0,
    hoursByModel: Object.fromEntries(L_MODELS.map(m => [m, 0])),
    tageOrgasmusfrei: 0, tageUngeoeffnet: 0, tageKeinKG: 0, tageMitOrgasmus: 0,
    orgasmen: 0, orgasmenAuto: 0,
    bestePunkte: 0, schlechtestePunkte: 0,
    bestOfStreak: { days: 0, end: null }, bestUoStreak: { days: 0, end: null },
    monatlich: [],
  };
  const monthMap = {};

  while (cursor <= ende) {
    const evs = byDay[cursor] || [];
    const ov = overrides[cursor] || {};
    const { hours, endModel } = dayHours(evs, prevEndModel);

    const orgasmEvs = evs.filter(e => e.type === 'OR');
    const hadOrgasm = orgasmEvs.length > 0;
    const derived = L_VERSCHL.reduce((s, m) => s + hours[m], 0);
    const stunden = (typeof ov.hoursLocked === 'number') ? ov.hoursLocked : derived;

    const hasModelEvent = evs.some(e => ['HT', 'NS', 'PC', 'KK'].includes(e.type));
    const orgasmusfrei = (ov.orgasmusfrei !== undefined) ? !!ov.orgasmusfrei : !hadOrgasm;
    const ungeoeffnet  = (ov.ungeoeffnet  !== undefined) ? !!ov.ungeoeffnet  : (!hasModelEvent && !hadOrgasm);
    const keinKG       = (ov.keinKG       !== undefined) ? !!ov.keinKG       : (hours.KK > 12);

    ofStreak = orgasmusfrei ? ofStreak * L_POINTS.ofMul + L_POINTS.ofBase : 0;
    uoStreak = ungeoeffnet  ? uoStreak * L_POINTS.uoMul + L_POINTS.uoBase : 0;

    let punkte = ofStreak + uoStreak + stunden * L_POINTS.hourLocked;
    if (hadOrgasm) punkte += L_POINTS.orgasm;
    if (keinKG)    punkte += L_POINTS.keinKG;
    cumPunkte += punkte;

    const tracked = evs.length > 0 || Object.keys(ov).length > 0;
    snap.kalendertage++;
    if (tracked) {
      snap.tage++;
      if (punkte > snap.bestePunkte) snap.bestePunkte = punkte;
      if (punkte < snap.schlechtestePunkte) snap.schlechtestePunkte = punkte;
      const m = cursor.slice(0, 7);
      (monthMap[m] ||= { month: m, tage: 0, punkte: 0, stunden: 0 });
      monthMap[m].tage++; monthMap[m].punkte += punkte; monthMap[m].stunden += stunden;
    }
    snap.stundenVerschlossen += stunden;
    for (const m of L_MODELS) snap.hoursByModel[m] += hours[m];
    if (orgasmusfrei) snap.tageOrgasmusfrei++;
    if (ungeoeffnet)  snap.tageUngeoeffnet++;
    if (keinKG)       snap.tageKeinKG++;
    if (hadOrgasm)    snap.tageMitOrgasmus++;
    snap.orgasmen     += orgasmEvs.length;
    snap.orgasmenAuto += orgasmEvs.filter(e => e.auto_inactivity).length;

    if (orgasmusfrei) { curOf++; if (curOf > snap.bestOfStreak.days) snap.bestOfStreak = { days: curOf, end: cursor }; }
    else curOf = 0;
    if (ungeoeffnet)  { curUo++; if (curUo > snap.bestUoStreak.days) snap.bestUoStreak = { days: curUo, end: cursor }; }
    else curUo = 0;

    prevEndModel = endModel;
    cursor = isoDateAdd(cursor, 1);
  }

  snap.punkte = cumPunkte;
  snap.monatlich = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  return snap;
}

function schnappschuss(snap, stichtag) {
  return {
    ...snap,
    formel: 'locked-1.x',
    eingefrorenAm: new Date().toISOString(),
    stichtag,
    dauerTage: isoDaysBetween(snap.von, snap.bis) + 1,
  };
}

/**
 * Den Schnappschuss erzeugen — genau einmal, automatisch beim Umstieg.
 * Gibt null zurück, wenn schon einer da ist oder es nichts einzufrieren gibt;
 * der Aufrufer schreibt das Ergebnis dann nach `data.legacy`.
 */
export function freezeLegacy(data, stichtag) {
  if (!data || data.legacy) return null;
  const snap = computeLegacy(data, stichtag);
  return snap ? schnappschuss(snap, stichtag) : null;
}

/**
 * Den Schnappschuss auf einen anderen Stichtag neu berechnen.
 *
 * „Unveränderlich" heißt: der Sync fasst das Archiv nicht an und keine
 * Regeländerung rechnet es neu. Es heißt nicht, dass der Schnitt an der
 * falschen Stelle liegen bleiben muss — verschiebt man ihn bewusst, muss das
 * Archiv mitgehen, sonst zählten die dazwischen liegenden Tage doppelt (einmal
 * nach alter, einmal nach neuer Formel) oder fielen ganz heraus.
 *
 * Gibt `null` zurück, wenn vor dem neuen Stichtag nichts mehr liegt — dann
 * gehört gar kein Archiv mehr in die Datei.
 */
export function refreezeLegacy(data, stichtag) {
  const snap = computeLegacy(data, stichtag);
  return snap ? schnappschuss(snap, stichtag) : null;
}
