/**
 * Locked — Berechnungskern (Punktekonto + Form-Wert).
 *
 * Das Modell in drei Sätzen:
 *   Verschlossene Zeit *verdient* Punkte, mal einem gedeckelten Streak-Faktor.
 *   Offene Zeit und Orgasmen *kosten*, wobei ein Orgasmus umso teurer ist, je
 *   kürzer er auf den letzten folgt. Die Differenz landet im Konto (läuft mit)
 *   und im Form-Wert (klingt ab und bleibt dadurch vergleichbar).
 *
 * Vorgänger war eine Streak-Formel `s = s × 1,07 + basis`. Die hat keinen
 * Fixpunkt: nach einem halben Jahr standen dort 10^7 Punkte pro Tag, gegen die
 * Tragestunden und Orgasmus-Abzüge rechnerisch nicht mehr existierten. Jede
 * Größe hier ist deshalb entweder gedeckelt oder linear in der Zeit.
 *
 * Bewusst frei von DOM und globalem State: alles kommt als Parameter herein,
 * inklusive `opts.now` — sonst ließe sich der laufende Tag nicht reproduzierbar
 * testen. Tests in test/calc.test.js.
 */

import { isoOf, isoDateAdd, minutesOf, timeToMin, eventMs, eventSortKey } from './time.js';
import {
  normalizeSettings, modelMap, resolveModel, openModelId, orgasmPrice, stichtagOf,
  KIND_MODEL, KIND_ORGASM,
} from './settings.js';

// =========================== EVENTS ===========================
/** Events nach Datum gruppieren, je Tag nach Uhrzeit sortiert. */
export function groupByDay(events) {
  const by = {};
  for (const e of (events || [])) {
    if (!e || !e.date) continue;
    (by[e.date] ||= []).push(e);
  }
  for (const k in by) by[k].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return by;
}

/**
 * Stunden je Modell für einen Tag, ausgehend vom Zustand des Vortags.
 *
 * `endMin` begrenzt die Zählung (heute: bis jetzt) — ohne die Grenze bekäme ein
 * morgens angelegter Käfig sofort den ganzen Tag gutgeschrieben. Events nach der
 * Grenze zählen keine Stunden, bestimmen aber den Zustand, mit dem der Folgetag
 * startet.
 *
 * `startMin` verschiebt den Beginn nach hinten. Gebraucht wird das nur am
 * allerersten Tag der Historie: davor ist kein Zustand bekannt, und die Stunden
 * bis zum ersten Eintrag als „offen" zu werten hieße, eine Annahme in Rechnung
 * zu stellen. Wer abends um 20 Uhr seinen ersten Käfig einträgt, soll nicht mit
 * zwanzig Strafstunden anfangen.
 */
export function computeDayHours(dayEvents, startModel, endMin, ctx, startMin) {
  const limit = (typeof endMin === 'number') ? Math.max(0, Math.min(1440, endMin)) : 1440;
  const beginn = (typeof startMin === 'number') ? Math.max(0, Math.min(1440, startMin)) : 0;
  const hours = {};
  const add = (id, h) => { hours[id] = (hours[id] || 0) + h; };

  let cur = startModel;
  let curMin = beginn;
  let endModel = cur;
  for (const ev of dayEvents) {
    const m = resolveModel(ctx.settings, ctx.map, ev.type);
    if (m.kind !== KIND_MODEL) continue;      // Orgasmus ändert den Zustand nicht
    const t = timeToMin(ev.time);
    if (t <= limit) {
      if (t > curMin) add(cur, (t - curMin) / 60);
      cur = ev.type;
      curMin = t;
    }
    endModel = ev.type;
  }
  if (curMin < limit) add(cur, (limit - curMin) / 60);
  return { hours, endModel };
}

// =========================== TAGESWERTUNG ===========================
/**
 * Punkte eines Tages aus seinen Stunden und Orgasmen.
 * Getrennt vom Durchlauf, damit die UI dieselbe Aufschlüsselung anzeigen kann,
 * die auch gerechnet wurde — eine zweite Formel im Frontend wäre eine zweite
 * Wahrheit.
 *
 * @param {object} hours        { modellId: stunden }
 * @param {Array}  orgasmen     [{ model, price }]
 * @param {number} streakTage   orgasmusfreie Tage *vor* diesem Tag
 * @param {boolean} vollstaendig  ist der Tag zu Ende (kein Bonus-Vorgriff)
 */
export function scoreDay(hours, orgasmen, streakTage, ctx, vollstaendig) {
  const P = ctx.settings.points;
  let verdienstBasis = 0, stundenKosten = 0, verschlossenH = 0, offenH = 0;

  for (const [id, h] of Object.entries(hours)) {
    if (!h) continue;
    const m = resolveModel(ctx.settings, ctx.map, id);
    if (m.locked) verschlossenH += h; else offenH += h;
    if (m.rate >= 0) verdienstBasis += h * m.rate;
    else stundenKosten += h * -m.rate;
  }

  const durchgehend = offenH <= P.bonusMaxOffenH && verschlossenH > 0;
  const bonus = durchgehend ? P.bonusDurchgehend : 0;
  const mult = Math.min(1 + P.streakK * Math.max(0, streakTage), P.streakCap);
  const einnahmen = (verdienstBasis + bonus) * mult;
  const orgasmKosten = orgasmen.reduce((s, o) => s + o.price, 0);

  return {
    verschlossenH, offenH,
    verdienstBasis, bonus, mult, einnahmen,
    stundenKosten, orgasmKosten,
    kosten: stundenKosten + orgasmKosten,
    netto: einnahmen - stundenKosten - orgasmKosten,
    durchgehend,
    // Für heute ist der Bonus eine Prognose: eine Öffnung am Abend nimmt ihn
    // wieder weg. Die UI kennzeichnet das, statt eine sichere Zahl vorzutäuschen.
    bonusVorlaeufig: durchgehend && !vollstaendig,
  };
}

// =========================== DURCHLAUF ===========================
/**
 * Alle Tageskennzahlen über die gesamte Event-Spanne.
 *
 * @param {object} data   { events, days, settings, legacy }
 * @param {object} [opts] { now?: Date }
 */
export function computeAll(data, opts) {
  const now = (opts && opts.now) || new Date();
  const settings = normalizeSettings(data && data.settings);
  const ctx = { settings, map: modelMap(settings) };
  const openId = openModelId(settings);
  const events = (data && data.events) || [];
  const byDay = groupByDay(events);

  const allDates = Object.keys(byDay).sort();
  if (!allDates.length) {
    return { days: [], byDate: {}, totals: emptyTotals(), settings, ctx, startedAt: null };
  }

  const today = isoOf(now);
  const start = allDates[0];
  const lastDate = allDates[allDates.length - 1];
  const end = lastDate > today ? lastDate : today;
  // Ohne Stichtag zählt alles — genau so verhält sich eine frische Installation,
  // die nie eine alte Ära hatte, und genau so zählen nachgetragene Tage mit.
  const startedAt = stichtagOf(data, settings) || start;

  let cursor = start;
  let prevEndModel = openId;
  let streakTage = 0;          // orgasmusfreie Tage vor dem aktuellen
  let konto = 0, form = 0;
  let lastOrgasmMs = null;
  const days = [];
  const byDate = {};

  while (cursor <= end) {
    const evs = byDay[cursor] || [];
    // Heute nur bis jetzt werten, Zukunft gar nicht — die Tagespunkte wachsen
    // dadurch mit, statt morgens schon vollständig dazustehen.
    const zukunft = cursor > today;
    const limitMin = cursor === today ? minutesOf(now) : (zukunft ? 0 : 1440);
    const vollstaendig = cursor < today;
    const startMin = (cursor === start && evs.length) ? timeToMin(evs[0].time) : 0;
    const { hours, endModel } = computeDayHours(evs, prevEndModel, limitMin, ctx, startMin);

    // Orgasmen des Tages bepreisen — in zeitlicher Reihenfolge, weil jeder den
    // Abstand für den nächsten bestimmt.
    const orgasmen = [];
    let nth = 0;
    for (const ev of evs) {
      const m = resolveModel(ctx.settings, ctx.map, ev.type);
      if (m.kind !== KIND_ORGASM) continue;
      // Was noch nicht passiert ist, kostet noch nichts.
      if (zukunft || timeToMin(ev.time) > limitMin) continue;
      const t = eventMs(ev);
      nth++;
      const abstandTage = lastOrgasmMs != null ? (t - lastOrgasmMs) / 86400000 : Infinity;
      orgasmen.push({
        event: ev, model: m,
        abstandTage,
        price: orgasmPrice(m, abstandTage, nth),
      });
      lastOrgasmMs = t;
    }

    const score = scoreDay(hours, orgasmen, streakTage, ctx, vollstaendig);
    // Vor dem Stichtag wird nichts gutgeschrieben: die alte Ära liegt
    // eingefroren im Archiv, das neue Konto startet bei null.
    const zaehlt = cursor >= startedAt;
    const netto = zaehlt ? score.netto : 0;
    konto += netto;
    form = form * settings.points.formDecay + netto;

    const rec = {
      date: cursor,
      events: evs,
      hours, endModel, prevEndModel,
      orgasmen,
      orgasmusfrei: orgasmen.length === 0,
      ...score,
      netto, zaehlt,
      konto, form,
      tracked: evs.length > 0,
    };
    days.push(rec);
    byDate[cursor] = rec;

    if (!zukunft) streakTage = orgasmen.length ? 0 : streakTage + 1;
    prevEndModel = endModel;
    cursor = isoDateAdd(cursor, 1);
  }

  return { days, byDate, totals: computeTotals(days), settings, ctx, startedAt };
}

// =========================== AGGREGATE ===========================
export function emptyTotals() {
  return {
    tage: 0, kalendertage: 0,
    konto: 0, form: 0,
    einnahmen: 0, kosten: 0,
    avgNetto: 0, avgStdTag: 0,
    stundenVerschlossen: 0, stundenOffen: 0,
    hoursByModel: {},
    tageDurchgehend: 0, tageMitOrgasmus: 0,
    orgasmen: 0, orgasmenAuto: 0, orgasmKosten: 0,
    besterTag: 0, schlechtesterTag: 0,
    monatlich: [],
    bestOfStreak: { days: 0, end: null },
    byWeekday: Array.from({ length: 7 }, () => ({ netto: 0, tage: 0 })),
  };
}

export function computeTotals(days) {
  const t = emptyTotals();
  const gezaehlt = days.filter(d => d.zaehlt);
  t.kalendertage = gezaehlt.length;
  t.tage = gezaehlt.filter(d => d.tracked).length;

  let curOf = 0;
  for (const d of days) {
    // Alles hier zählt nur ab dem Stichtag — sonst stünde im selben Bild eine
    // Kachel für die neue Ära neben einem Donut über die gesamte Historie.
    // Die Zeit davor steht im Archiv.
    if (!d.zaehlt) continue;
    for (const [id, h] of Object.entries(d.hours)) {
      t.hoursByModel[id] = (t.hoursByModel[id] || 0) + h;
    }
    t.stundenVerschlossen += d.verschlossenH;
    t.stundenOffen        += d.offenH;
    t.einnahmen           += d.einnahmen;
    t.kosten              += d.kosten;
    t.orgasmKosten        += d.orgasmKosten;
    t.orgasmen            += d.orgasmen.length;
    t.orgasmenAuto        += d.orgasmen.filter(o => o.event.auto_inactivity).length;
    if (d.durchgehend) t.tageDurchgehend++;
    if (d.orgasmen.length) t.tageMitOrgasmus++;
    if (d.tracked) {
      if (d.netto > t.besterTag) t.besterTag = d.netto;
      if (d.netto < t.schlechtesterTag) t.schlechtesterTag = d.netto;
    }
    const wd = new Date(d.date + 'T12:00:00').getDay();
    t.byWeekday[wd].netto += d.netto;
    t.byWeekday[wd].tage += 1;

    if (d.orgasmusfrei) { curOf++; if (curOf > t.bestOfStreak.days) t.bestOfStreak = { days: curOf, end: d.date }; }
    else curOf = 0;
  }

  const last = gezaehlt[gezaehlt.length - 1];
  t.konto = last ? last.konto : 0;
  t.form  = last ? last.form  : 0;
  t.avgNetto  = t.kalendertage ? t.konto / t.kalendertage : 0;
  t.avgStdTag = t.kalendertage ? t.stundenVerschlossen / t.kalendertage : 0;

  const monthMap = {};
  for (const d of gezaehlt) {
    const m = d.date.slice(0, 7);
    (monthMap[m] ||= { month: m, tage: 0, netto: 0, einnahmen: 0, kosten: 0, stunden: 0, orgasmen: 0 });
    const x = monthMap[m];
    x.tage++; x.netto += d.netto; x.einnahmen += d.einnahmen;
    x.kosten += d.kosten; x.stunden += d.verschlossenH; x.orgasmen += d.orgasmen.length;
  }
  t.monatlich = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  return t;
}

// =========================== VERSCHLOSSEN-PHASE ===========================
/**
 * Beginn der laufenden verschlossenen Phase — oder null, wenn gerade offen.
 *
 * "Verschlossen" ist ein Zustand, kein Tagesmerkmal: maßgeblich ist das zuletzt
 * eingetragene Modell, nicht wie viele Stunden auf einem Kalendertag zusammen-
 * kommen. Die Phase läuft dadurch über Mitternacht weiter, und ein offener Tag
 * lässt keinen Zähler ab 00:00 neu starten. Modellwechsel innerhalb der Phase
 * (Holy Trainer → Neosteel) unterbrechen sie nicht.
 */
export function lockPhaseStart(events, settings, refMs) {
  const ctx = { settings, map: modelMap(settings) };
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  const evs = (events || [])
    .map(e => ({ e, m: resolveModel(settings, ctx.map, e.type), t: eventMs(e) }))
    .filter(x => x.m.kind === KIND_MODEL && isFinite(x.t) && x.t <= ref)
    .sort((a, b) => a.t - b.t);
  if (!evs.length) return null;                 // Startzustand ist offen
  const last = evs[evs.length - 1];
  if (!last.m.locked) return null;
  let start = last;
  for (let i = evs.length - 2; i >= 0; i--) {
    if (!evs[i].m.locked) break;
    start = evs[i];
  }
  return { ms: start.t, model: last.e.type };
}

/** Zeitpunkt des letzten Orgasmus vor `refMs`, oder null. */
export function lastOrgasmMs(events, settings, refMs) {
  const map = modelMap(settings);
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  let best = null;
  for (const e of (events || [])) {
    const m = resolveModel(settings, map, e.type);
    if (m.kind !== KIND_ORGASM) continue;
    const t = eventMs(e);
    if (!isFinite(t) || t > ref) continue;
    if (best == null || t > best) best = t;
  }
  return best;
}

/**
 * Was ein Orgasmus *jetzt* kosten würde. Der Preis ist die zentrale Zahl des
 * Modells und gehört sichtbar in die App, statt erst nach dem Eintrag
 * aufzutauchen.
 */
export function currentOrgasmPrice(data, settings, refMs) {
  const s = settings || normalizeSettings(data && data.settings);
  const orModel = s.models.find(m => m.kind === KIND_ORGASM && !m.archived)
    || s.models.find(m => m.kind === KIND_ORGASM);
  if (!orModel) return null;
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  const lastMs = lastOrgasmMs((data && data.events) || [], s, ref);
  const abstandTage = lastMs != null ? (ref - lastMs) / 86400000 : Infinity;
  return { model: orModel, abstandTage, price: orgasmPrice(orModel, abstandTage, 1) };
}

// =========================== REGENERATION ===========================
/**
 * Zustand der Regenerations-Mechanik: verfügbar / läuft / gesperrt.
 * Fenster und Sperrfrist stehen am Modell, sind also einstellbar.
 */
export function regenState(data, settings, now) {
  const s = settings || normalizeSettings(data && data.settings);
  const reg = s.models.find(m => m.regen && !m.archived);
  if (!reg) return { state: 'none' };
  const map = modelMap(s);
  const nowMs = (now || new Date()).getTime();
  const windowMs = reg.windowH * 3600000;
  const cooldownMs = reg.cooldownD * 86400000;

  const evs = (data.events || []).slice().sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  const regs = evs.filter(e => e.type === reg.id);
  if (!regs.length) return { state: 'available', model: reg };

  const latest = regs[regs.length - 1];
  const regAt = eventMs(latest);
  const deadline = regAt + windowMs;
  const followUp = evs
    .map(e => ({ e, m: resolveModel(s, map, e.type), t: eventMs(e) }))
    .filter(x => x.m.kind === KIND_MODEL && x.e.type !== reg.id && x.t > regAt)
    .sort((a, b) => a.t - b.t)[0];

  if (followUp) {
    const cdEnd = followUp.t + cooldownMs;
    if (nowMs < cdEnd) return { state: 'cooldown', remainMs: cdEnd - nowMs, model: reg };
    return { state: 'available', model: reg };
  }
  if (nowMs < deadline) return { state: 'active', deadlineMs: deadline - nowMs, regAt, model: reg };
  const cdEnd = deadline + cooldownMs;
  if (nowMs < cdEnd) return { state: 'cooldown', remainMs: cdEnd - nowMs, model: reg };
  return { state: 'available', model: reg };
}

/**
 * Abgelaufene Regenerationen: welche Öffnungs-Events fehlen noch?
 * Gibt Vorschläge zurück statt zu schreiben — der Aufrufer entscheidet.
 */
export function expiredRegenEvents(data, settings, now) {
  const s = settings || normalizeSettings(data && data.settings);
  const reg = s.models.find(m => m.regen);
  if (!reg) return [];
  const map = modelMap(s);
  const openId = openModelId(s);
  const nowMs = (now || new Date()).getTime();
  const out = [];
  for (const r of (data.events || []).filter(e => e.type === reg.id)) {
    const regAt = eventMs(r);
    const deadline = regAt + reg.windowH * 3600000;
    if (nowMs < deadline) continue;
    const hasFollowUp = (data.events || []).some(e => {
      const m = resolveModel(s, map, e.type);
      return m.kind === KIND_MODEL && e.type !== reg.id && eventMs(e) > regAt;
    });
    if (hasFollowUp) continue;
    const d = new Date(deadline);
    out.push({
      date: isoOf(d),
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      type: openId,
      auto_regen_timeout: true,
    });
  }
  return out;
}
