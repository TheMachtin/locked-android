/**
 * Locked — Berechnungskern.
 *
 * Bewusst frei von DOM und globalem State: jede Funktion hier bekommt ihre
 * Daten übergeben und ist damit in Node testbar (siehe test/calc.test.js).
 * Die Zeit wird als Parameter durchgereicht (`opts.now`), sonst ließe sich
 * das Verhalten am heutigen Tag nicht reproduzierbar prüfen.
 *
 * Wird als klassisches Script geladen — die Funktionen landen global und
 * bleiben für den UI-Code in index.html unverändert erreichbar.
 */
'use strict';

// =========================== KONSTANTEN ===========================
const MODELS  = ['HT','PC','NS','KK','REG'];
const VERSCHL = ['HT','PC','NS','REG']; // zählt als "verschlossen"
const REGEN_WINDOW_MS   = 12 * 3600 * 1000;
const REGEN_COOLDOWN_MS = 5 * 24 * 3600 * 1000;
const POINTS = {
  hourLocked: 0.5,
  ofBase: 3, ofMul: 1.07,
  uoBase: 5, uoMul: 1.07,
  orgasm: -10,
  keinKG: -5,
};

// =========================== DATUM / ZEIT ===========================
function pad2(n) { return String(n).padStart(2, '0'); }

/** "HH:MM" → Minuten seit Mitternacht */
function timeToMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }

/** Date → "YYYY-MM-DD" in *lokaler* Zeit (toISOString wäre UTC und verschiebt den Tag) */
function isoOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/** Minuten seit Mitternacht (lokal) */
function minutesOf(d) { return d.getHours() * 60 + d.getMinutes(); }

/** ISO-Datum um n Tage verschieben (DST-sicher über 12:00 Uhr Mittag) */
function isoDateAdd(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** ISO 8601 Kalenderwoche, "YYYY-Www" */
function isoWeek(iso) {
  const d = new Date(iso + 'T12:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getFullYear()}-W${pad2(week)}`;
}

// =========================== TAGESBERECHNUNG ===========================
/** Events nach Datum gruppieren, je Tag nach Uhrzeit sortiert. */
function groupByDay(events) {
  const by = {};
  for (const e of (events || [])) {
    (by[e.date] ||= []).push(e);
  }
  for (const k in by) by[k].sort((a, b) => a.time.localeCompare(b.time));
  return by;
}

/**
 * Stunden pro Modell für einen Tag, ausgehend vom Startmodell.
 * `endMin` begrenzt die Zählung (heute: bis jetzt) — sonst bekäme ein morgens
 * angelegter Käfig sofort den ganzen Tag gutgeschrieben.
 * Events nach der Grenze zählen keine Stunden, bestimmen aber das Modell,
 * mit dem der Folgetag startet.
 */
function computeDayHours(dayEvents, startModel, endMin) {
  const limit = (typeof endMin === 'number') ? Math.max(0, Math.min(24 * 60, endMin)) : 24 * 60;
  const hours = Object.fromEntries(MODELS.map(m => [m, 0]));
  let cur = startModel || 'KK';
  let curMin = 0;
  let endModel = cur;
  for (const ev of dayEvents) {
    if (ev.type === 'OR') continue;          // ändert das Modell nicht
    if (!MODELS.includes(ev.type)) continue;
    const t = timeToMin(ev.time);
    if (t <= limit) {
      if (t > curMin) hours[cur] += (t - curMin) / 60;
      cur = ev.type;
      curMin = t;
    }
    endModel = ev.type;
  }
  if (curMin < limit) hours[cur] += (limit - curMin) / 60;
  return { hours, endModel };
}

/**
 * Alle Tageskennzahlen über die gesamte Event-Spanne.
 * @param {object} data  { events: [], days: {} }
 * @param {object} [opts] { now?: Date }
 */
function computeAllFrom(data, opts) {
  const now = (opts && opts.now) || new Date();
  const events = (data && data.events) || [];
  const overrides = (data && data.days) || {};
  const byDay = groupByDay(events);
  // Union aus Event-Daten und Override-Daten — sonst gehen Tage mit reiner Flag-Markierung verloren
  const allDates = [...new Set([...Object.keys(byDay), ...Object.keys(overrides)])].sort();
  if (allDates.length === 0) return { days: [], byDate: {}, totals: emptyTotals() };

  const start = allDates[0];
  const today = isoOf(now);
  const lastDate = allDates[allDates.length - 1];
  const end = lastDate > today ? lastDate : today;

  let cursor = start;
  let prevEndModel = 'KK';
  let ofStreak = 0, uoStreak = 0;
  let cumPunkte = 0;
  const days = [];
  const byDate = {};

  while (cursor <= end) {
    const evs = byDay[cursor] || [];
    const ov = overrides[cursor] || {};
    // Heute nur bis zur aktuellen Uhrzeit werten, Zukunft gar nicht — die
    // Tagespunkte wachsen dadurch mit, statt morgens schon vollständig dazustehen.
    const limitMin = cursor === today ? minutesOf(now) : (cursor > today ? 0 : 24 * 60);
    const { hours, endModel } = computeDayHours(evs, prevEndModel, limitMin);

    const orgasmEvs = evs.filter(e => e.type === 'OR');
    const hadOrgasm = orgasmEvs.length > 0;
    const derivedVerschl = VERSCHL.reduce((s, m) => s + hours[m], 0);
    const stundenVerschlossen = (typeof ov.hoursLocked === 'number') ? ov.hoursLocked : derivedVerschl;

    // Flags: explizite Overrides schlagen Auto-Ableitung.
    //  - orgasmusfrei: kein OR-Event den Tag
    //  - ungeoeffnet : kein Modell-Event (HT/NS/PC/KK) UND kein OR-Event — Tag völlig eintragslos
    //  - keinKG      : hours.KK > 12 (mehr als halber Tag offen)
    const hasModelEvent = evs.some(e => e.type === 'HT' || e.type === 'NS' || e.type === 'PC' || e.type === 'KK');
    const orgasmusfrei = (ov.orgasmusfrei !== undefined) ? !!ov.orgasmusfrei : !hadOrgasm;
    const ungeoeffnet  = (ov.ungeoeffnet  !== undefined) ? !!ov.ungeoeffnet  : (!hasModelEvent && !hadOrgasm);
    const keinKG       = (ov.keinKG       !== undefined) ? !!ov.keinKG       : (hours.KK > 12);

    // Streaks
    if (orgasmusfrei) ofStreak = ofStreak * POINTS.ofMul + POINTS.ofBase;
    else ofStreak = 0;
    if (ungeoeffnet) uoStreak = uoStreak * POINTS.uoMul + POINTS.uoBase;
    else uoStreak = 0;

    // Tagespunkte
    let punkte = ofStreak + uoStreak + stundenVerschlossen * POINTS.hourLocked;
    if (hadOrgasm) punkte += POINTS.orgasm;
    if (keinKG) punkte += POINTS.keinKG;
    cumPunkte += punkte;

    const hasOverride = Object.keys(ov).length > 0;
    const rec = {
      date: cursor,
      events: evs,
      hours, endModel, prevEndModel,
      stundenVerschlossen,
      orgasmusfrei, ungeoeffnet, keinKG, hadOrgasm,
      orgasmCount: orgasmEvs.length,
      orgasmAutoCount: orgasmEvs.filter(e => e.auto_inactivity).length,
      ofStreak, uoStreak,
      punkte, cumPunkte,
      tracked: evs.length > 0 || hasOverride,
    };
    days.push(rec);
    byDate[cursor] = rec;

    prevEndModel = endModel;
    cursor = isoDateAdd(cursor, 1);
  }

  return { days, byDate, totals: computeTotals(days) };
}

// =========================== AGGREGATE ===========================
function emptyTotals() {
  return { tage: 0, kalendertage: 0, punkte: 0, avgPunkte: 0, avgStdTag: 0, stundenVerschlossen: 0,
    hoursByModel: { HT:0, PC:0, NS:0, KK:0, REG:0 },
    tageOrgasmusfrei: 0, tageUngeoeffnet: 0, tageKeinKG: 0, tageMitOrgasmus: 0,
    orgasmen: 0, orgasmenAuto: 0,
    bestePunkte: 0, schlechtestePunkte: 0, monatlich: [],
    bestOfStreak: { days: 0, end: null }, bestUoStreak: { days: 0, end: null },
    byWeekday: [0,0,0,0,0,0,0].map(() => ({ punkte: 0, tage: 0 })) };
}

function computeTotals(days) {
  const t = emptyTotals();
  t.tage = days.filter(d => d.tracked).length;
  t.kalendertage = days.length;
  let lastCum = 0;
  let curOf = 0, curUo = 0;
  for (const d of days) {
    if (d.tracked) lastCum = d.cumPunkte;
    t.stundenVerschlossen += d.stundenVerschlossen;
    for (const m of MODELS) t.hoursByModel[m] += d.hours[m];
    if (d.orgasmusfrei) t.tageOrgasmusfrei++;
    if (d.ungeoeffnet)  t.tageUngeoeffnet++;
    if (d.keinKG)       t.tageKeinKG++;
    if (d.hadOrgasm)    t.tageMitOrgasmus++;
    t.orgasmen     += d.orgasmCount || 0;
    t.orgasmenAuto += d.orgasmAutoCount || 0;
    if (d.tracked) {
      if (d.punkte > t.bestePunkte) t.bestePunkte = d.punkte;
      if (d.punkte < t.schlechtestePunkte) t.schlechtestePunkte = d.punkte;
      // Wochentag-Aggregat (JS: 0=So .. 6=Sa)
      const wd = new Date(d.date + 'T12:00:00').getDay();
      t.byWeekday[wd].punkte += d.punkte;
      t.byWeekday[wd].tage += 1;
    }
    // Best-Ever Streaks (laufende Zähler)
    if (d.orgasmusfrei) { curOf++; if (curOf > t.bestOfStreak.days) t.bestOfStreak = { days: curOf, end: d.date }; }
    else curOf = 0;
    if (d.ungeoeffnet)  { curUo++; if (curUo > t.bestUoStreak.days) t.bestUoStreak = { days: curUo, end: d.date }; }
    else curUo = 0;
  }
  t.punkte = lastCum;
  t.avgPunkte = t.tage ? t.punkte / t.tage : 0;
  t.avgStdTag = t.tage ? t.stundenVerschlossen / t.tage : 0;

  const monthMap = {};
  for (const d of days) {
    if (!d.tracked) continue;
    const m = d.date.slice(0, 7);
    (monthMap[m] ||= { month: m, tage: 0, punkte: 0, stunden: 0 });
    monthMap[m].tage++;
    monthMap[m].punkte += d.punkte;
    monthMap[m].stunden += d.stundenVerschlossen;
  }
  t.monatlich = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  return t;
}


// =========================== INAKTIVITÄT ===========================
const INACTIVITY_REMINDER_DAYS = 2;   // ab wann erinnert wird
const INACTIVITY_AUTO_KK_DAYS  = 4;   // ab wann Einträge vorgeschlagen werden

/** Zeitpunkt der letzten *echten* Interaktion (automatisch erzeugte zählen nicht). */
function lastRealInteractionMs(events) {
  const evs = (events || []).filter(e => !e.auto_inactivity && !e.auto_regen_timeout);
  if (!evs.length) return null;
  const latest = evs.reduce((a, b) => (b.date + b.time) > (a.date + a.time) ? b : a);
  return new Date(`${latest.date}T${latest.time}:00`).getTime();
}

/**
 * Was die Inaktivitäts-Regel *vorschlagen* würde — ohne etwas zu schreiben.
 * Die Entscheidung trifft der Nutzer; erfundene Einträge sind später nicht mehr
 * von echten zu unterscheiden und würden die Datengrundlage entwerten.
 *
 * @param {object} data   { events, meta }
 * @param {object} [opts] { now?: Date, autoKkDays?: number }
 * @returns {{faellig, seitMs, anchorMs, kk, orgasmen, anzahl}}
 */
function pendingEscalation(data, opts) {
  const now = (opts && opts.now) || new Date();
  const autoKkDays = (opts && opts.autoKkDays) || INACTIVITY_AUTO_KK_DAYS;
  const events = (data && data.events) || [];
  const leer = { faellig: false, seitMs: 0, anchorMs: null, kk: null, orgasmen: [], anzahl: 0 };

  const lastMs = lastRealInteractionMs(events);
  if (!lastMs) return leer;

  // Ein verworfener Vorschlag setzt die Uhr neu — sonst käme er bei jedem Start wieder.
  const dismissedAt = data && data.meta && data.meta.escalationDismissedAt;
  const dismissedMs = dismissedAt ? new Date(dismissedAt).getTime() : 0;
  const anchorMs = Math.max(lastMs, isFinite(dismissedMs) ? dismissedMs : 0);

  const seitMs = now.getTime() - anchorMs;
  if (seitMs < autoKkDays * 86400000) return { ...leer, seitMs, anchorMs };

  const kkAt = new Date(anchorMs + autoKkDays * 86400000);
  const kkIso = isoOf(kkAt);
  const kkTime = `${pad2(kkAt.getHours())}:${pad2(kkAt.getMinutes())}`;
  const hatKk = events.some(e => e.type === 'KK' && e.date === kkIso && e.time === kkTime && e.auto_inactivity);

  const orgasmen = [];
  const cursor = new Date(kkAt);
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  const bis = new Date(now);
  bis.setHours(23, 59, 59, 999);
  while (cursor <= bis) {
    const iso = isoOf(cursor);
    if (!events.some(e => e.type === 'OR' && e.date === iso && e.auto_inactivity)) {
      orgasmen.push({ date: iso, time: '12:00' });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const kk = hatKk ? null : { date: kkIso, time: kkTime };
  return {
    faellig: !!kk || orgasmen.length > 0,
    seitMs, anchorMs, kk, orgasmen,
    anzahl: (kk ? 1 : 0) + orgasmen.length,
  };
}

/** Vorschlag in echte Events umwandeln (erst nach Bestätigung durch den Nutzer). */
function escalationEvents(vorschlag) {
  const out = [];
  if (vorschlag.kk) out.push({ date: vorschlag.kk.date, time: vorschlag.kk.time, type: 'KK', auto_inactivity: true });
  for (const o of vorschlag.orgasmen) {
    out.push({ date: o.date, time: o.time, type: 'OR', auto_inactivity: true, time_estimated: true });
  }
  return out;
}

// Node (Tests) — im Browser ist `module` nicht definiert.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MODELS, VERSCHL, POINTS, REGEN_WINDOW_MS, REGEN_COOLDOWN_MS,
    timeToMin, isoOf, minutesOf, isoDateAdd, isoWeek,
    groupByDay, computeDayHours, computeAllFrom, computeTotals, emptyTotals,
    INACTIVITY_REMINDER_DAYS, INACTIVITY_AUTO_KK_DAYS,
    lastRealInteractionMs, pendingEscalation, escalationEvents,
  };
}
