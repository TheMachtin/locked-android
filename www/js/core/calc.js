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
  brichtStrecke,
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
 * @param {number[]} [uoMarks]  die an diesem Tag vollendeten 24-h-Blöcke der
 *                              ungeöffneten Strecke, als ihre Nummern
 */
export function scoreDay(hours, orgasmen, streakTage, ctx, uoMarks) {
  const P = ctx.settings.points;
  let verdienstBasis = 0, stundenKosten = 0, verschlossenH = 0, offenH = 0, pauseH = 0;

  for (const [id, h] of Object.entries(hours)) {
    if (!h) continue;
    const m = resolveModel(ctx.settings, ctx.map, id);
    // Eine Unterbrechung (Reinigung) landet in keinem der beiden Töpfe: sie ist
    // keine verschlossene Zeit, aber auch keine Öffnung. Der Preis dafür steht
    // im Stundensatz — 0 Punkte je Stunde, während der Käfig 0,5 gebracht hätte.
    // Damit ist eine lange "Reinigung" von allein teuer und braucht keinen
    // zusätzlichen Deckel.
    if (m.locked) verschlossenH += h;
    else if (m.pause) pauseH += h;
    else offenH += h;
    if (m.rate >= 0) verdienstBasis += h * m.rate;
    else stundenKosten += h * -m.rate;
  }

  // Der Zuschlag wächst mit der Strecke und ist gedeckelt: der fünfte Tag im
  // selben Käfig ist mehr wert als der erste, der fünfzigste aber nicht mehr
  // als der Deckel — sonst stünde hier wieder eine Größe, gegen die
  // Tragestunden und Orgasmuspreis irgendwann nicht mehr ankommen.
  //
  // Gutgeschrieben wird je vollendetem 24-h-Block, nicht je Kalendertag. Was
  // hier ankommt, ist damit endgültig: der Block ist abgelaufen, keine Öffnung
  // am Abend nimmt ihn nachträglich weg. Ein „vorläufiger" Bonus existiert
  // deshalb nicht mehr.
  const marks = Array.isArray(uoMarks) ? uoMarks : [];
  let uoBonus = 0;
  for (const n of marks) uoBonus += Math.min(P.bonusUngeoeffnet * n, P.bonusUngeoeffnetCap);
  const uoTage = marks.length ? Math.max(...marks) : 0;

  const mult = Math.min(1 + P.streakK * Math.max(0, streakTage), P.streakCap);
  const einnahmen = (verdienstBasis + uoBonus) * mult;
  const orgasmKosten = orgasmen.reduce((s, o) => s + o.price, 0);

  return {
    verschlossenH, offenH, pauseH,
    verdienstBasis, uoBonus, uoTage, mult, einnahmen,
    stundenKosten, orgasmKosten,
    kosten: stundenKosten + orgasmKosten,
    netto: einnahmen - stundenKosten - orgasmKosten,
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

  const uoMarks = unopenedMarks(events, settings, now);
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
    const startMin = (cursor === start && evs.length) ? timeToMin(evs[0].time) : 0;
    const { hours, endModel } = computeDayHours(evs, prevEndModel, limitMin, ctx, startMin);

    // Orgasmen des Tages bepreisen — in zeitlicher Reihenfolge, weil jeder den
    // Abstand für den nächsten bestimmt.
    const orgasmen = [];
    // Der Aufschlag je weiterem am Tag zählt je Ereignisart. Über alle Arten
    // hinweg zu zählen hieße, dass ein Erguss ohne Orgasmus am Nachmittag den
    // Orgasmus am Abend zum zweiten macht und verteuert — zwei verschiedene
    // Dinge, die sich gegenseitig bepreisen.
    const nthJeModell = {};
    for (const ev of evs) {
      const m = resolveModel(ctx.settings, ctx.map, ev.type);
      if (m.kind !== KIND_ORGASM) continue;
      // Was noch nicht passiert ist, kostet noch nichts.
      if (zukunft || timeToMin(ev.time) > limitMin) continue;
      const t = eventMs(ev);
      const nth = (nthJeModell[m.id] = (nthJeModell[m.id] || 0) + 1);
      const abstandTage = lastOrgasmMs != null ? (t - lastOrgasmMs) / 86400000 : Infinity;
      orgasmen.push({
        event: ev, model: m,
        abstandTage,
        price: orgasmPrice(m, abstandTage, nth),
      });
      // Nur was die Strecke bricht, ist „der letzte Orgasmus" — sonst würde ein
      // geschontes Ereignis den nächsten echten über den Abstand verteuern und
      // damit durch die Hintertür doch bestrafen.
      if (brichtStrecke(m)) lastOrgasmMs = t;
    }

    // Die ungeöffnete Strecke läuft in echter Zeit, nicht in Kalendertagen: der
    // Tag bekommt die Blöcke gutgeschrieben, die *an* ihm vollendet wurden.
    const score = scoreDay(hours, orgasmen, streakTage, ctx, uoMarks[cursor]);
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
      // Orgasmusfrei heißt: kein Orgasmus. Ein Ereignis mit Faktor 1 ist keiner
      // — es kostet, aber es beendet die Strecke nicht, und die Kachel daneben
      // heißt nach dem, was sie zählt.
      orgasmusfrei: !orgasmen.some(o => brichtStrecke(o.model)),
      ...score,
      netto, zaehlt,
      konto, form,
      tracked: evs.length > 0,
    };
    days.push(rec);
    byDate[cursor] = rec;

    if (!zukunft) {
      // Der strengste Eintrag des Tages bestimmt, was von der Strecke bleibt:
      // wer morgens geschont und abends gebrochen hat, hat gebrochen.
      const f = orgasmen.reduce((min, o) => Math.min(min, o.model.streakFactor), 1);
      streakTage = f >= 1 ? streakTage + 1 : Math.floor(streakTage * f);
    }
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
    /** Summe der Tagesergebnisse im betrachteten Ausschnitt. Über die ganze
     *  Historie ist das der Kontostand; über ein einzelnes Jahr ist es das,
     *  was dieses Jahr beigetragen hat — und nur damit lässt sich ein
     *  Tagesdurchschnitt bilden, der zum Ausschnitt passt. */
    netto: 0,
    einnahmen: 0, kosten: 0,
    avgNetto: 0, avgStdTag: 0,
    stundenVerschlossen: 0, stundenOffen: 0, stundenPause: 0,
    hoursByModel: {},
    tageUngeoeffnet: 0, tageMitOrgasmus: 0,
    orgasmen: 0, orgasmenAuto: 0, orgasmKosten: 0,
    /** Ereignisse, die die orgasmusfreie Strecke nicht brechen — sie kosten
     *  Punkte (und stecken damit in `orgasmKosten`), sind aber keine Orgasmen
     *  und dürfen deshalb nicht in derselben Zahl stehen. */
    sonstigeEreignisse: 0,
    /** Was die ungeöffneten Strecken eingebracht haben — mit Multiplikator,
     *  also das, was tatsächlich im Konto steht, nicht der rohe Zuschlag. */
    uoEinnahmen: 0,
    besterTag: 0, schlechtesterTag: 0,
    monatlich: [],
    bestOfStreak: { days: 0, end: null },
    bestUoStreak: { days: 0, end: null },
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
    t.netto               += d.netto;
    t.stundenVerschlossen += d.verschlossenH;
    t.stundenOffen        += d.offenH;
    t.stundenPause        += d.pauseH;
    t.einnahmen           += d.einnahmen;
    t.kosten              += d.kosten;
    t.orgasmKosten        += d.orgasmKosten;
    t.orgasmen            += d.orgasmen.filter(o => brichtStrecke(o.model)).length;
    t.sonstigeEreignisse  += d.orgasmen.filter(o => !brichtStrecke(o.model)).length;
    t.orgasmenAuto        += d.orgasmen.filter(o => o.event.auto_inactivity).length;
    t.uoEinnahmen         += d.uoBonus * d.mult;
    if (d.uoTage) t.tageUngeoeffnet++;
    if (!d.orgasmusfrei) t.tageMitOrgasmus++;
    if (d.tracked) {
      if (d.netto > t.besterTag) t.besterTag = d.netto;
      if (d.netto < t.schlechtesterTag) t.schlechtesterTag = d.netto;
    }
    const wd = new Date(d.date + 'T12:00:00').getDay();
    t.byWeekday[wd].netto += d.netto;
    t.byWeekday[wd].tage += 1;

    if (d.orgasmusfrei) { curOf++; if (curOf > t.bestOfStreak.days) t.bestOfStreak = { days: curOf, end: d.date }; }
    else curOf = 0;
    // Die Blocknummern zählen innerhalb einer Strecke selbst hoch — die längste
    // steht damit einfach als größte Nummer da, ohne zweiten Zähler.
    if (d.uoTage > t.bestUoStreak.days) t.bestUoStreak = { days: d.uoTage, end: d.date };
  }

  const last = gezaehlt[gezaehlt.length - 1];
  t.konto = last ? last.konto : 0;
  t.form  = last ? last.form  : 0;
  // Der Durchschnitt teilt die Summe des Ausschnitts, nicht den mitlaufenden
  // Kontostand: sonst stünde im Jahresfilter 2026 das Konto vom Ende 2026 —
  // inklusive allem aus 2025 — über den Tagen von 2026.
  t.avgNetto  = t.kalendertage ? t.netto / t.kalendertage : 0;
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
 *
 * Unterbrechungen (`pause`, etwa die Reinigung) beenden sie ebenfalls nicht.
 * Sie behaupten nicht, der Käfig sei ab und bleibe es — sie sagen nur, dass
 * gerade nichts über den Verschluss auszusagen ist. Der Zähler springt deshalb
 * nicht auf null, weil jemand zehn Minuten am Waschbecken stand; `paused`
 * meldet der Oberfläche, dass die Pause noch läuft.
 */
export function lockPhaseStart(events, settings, refMs) {
  const ctx = { settings, map: modelMap(settings) };
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  const evs = (events || [])
    .map(e => ({ e, m: resolveModel(settings, ctx.map, e.type), t: eventMs(e) }))
    .filter(x => x.m.kind === KIND_MODEL && isFinite(x.t) && x.t <= ref)
    .sort((a, b) => a.t - b.t);
  if (!evs.length) return null;                 // Startzustand ist offen

  // Der letzte Eintrag, der überhaupt etwas über den Verschluss aussagt.
  let idx = evs.length - 1;
  while (idx >= 0 && evs[idx].m.pause) idx--;
  if (idx < 0) return null;                     // nur Unterbrechungen: davor war offen
  const last = evs[idx];
  if (!last.m.locked) return null;

  let start = last;
  for (let i = idx - 1; i >= 0; i--) {
    if (evs[i].m.pause) continue;
    if (!evs[i].m.locked) break;
    start = evs[i];
  }
  const laufend = evs[evs.length - 1];
  return {
    ms: start.t,
    model: last.e.type,
    paused: !!laufend.m.pause,
    pauseModel: laufend.m.pause ? laufend.e.type : null,
    pauseSince: laufend.m.pause ? laufend.t : null,
  };
}

// =========================== UNGEÖFFNET-STRECKEN ===========================
/** Ein Tag im Sinne der Strecke: 24 Stunden am Verschluss, nicht bis Mitternacht. */
export const TAG_MS = 24 * 3600000;

/**
 * Alle ungeöffneten Strecken der Historie: `[{ von, bis, model }]` in ms,
 * `bis === null` für die laufende.
 *
 * „Verschlossen" und „ungeöffnet" sind zwei verschiedene Fragen, und die zweite
 * ist die strengere. Wer zweimal am Tag vom Holy Trainer auf den Neosteel
 * wechselt, war durchgehend verschlossen — aufgemacht hat er trotzdem, zweimal.
 * Die verschlossene Phase soll darüber hinweglaufen, das ist ihr Sinn: sie misst
 * den Verschluss, nicht das Modell. Diese hier soll es genau nicht.
 *
 * Eine Strecke ist deshalb der zusammenhängende Lauf *desselben* Modells. Ein
 * Wechsel beendet sie, egal auf welches, und eine Unterbrechung (Reinigung)
 * ebenso: sie steht in der Datei genau dann, wenn der Käfig dafür herunter kam.
 * Was ohne Öffnen geht — die Düse unter der Dusche — erzeugt keinen Eintrag und
 * lässt die Strecke laufen. Damit ist „ungeöffnet" nie länger als
 * „verschlossen", und die Differenz zwischen beiden ist genau das, was ein
 * Modellwechsel kostet.
 *
 * Derselbe Käfig zweimal hintereinander eingetragen ist kein Wechsel — die
 * Strecke läuft ab dem ersten der beiden. Ein Orgasmus sagt hier so wenig über
 * den Verschluss aus wie in `lockPhaseStart()`: wer dafür geöffnet hat, hat die
 * Öffnung eingetragen.
 */
export function unopenedRuns(events, settings) {
  const map = modelMap(settings);
  const evs = (events || [])
    .map(e => ({ e, m: resolveModel(settings, map, e.type), t: eventMs(e) }))
    .filter(x => x.m.kind === KIND_MODEL && isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const runs = [];
  let laufend = null;
  let vorher = null;                          // null = offener Startzustand
  for (const x of evs) {
    if (x.e.type === vorher) continue;        // kein Wechsel, also kein Bruch
    if (laufend) { laufend.bis = x.t; runs.push(laufend); laufend = null; }
    if (x.m.locked) laufend = { von: x.t, bis: null, model: x.e.type };
    vorher = x.e.type;
  }
  if (laufend) runs.push(laufend);
  return runs;
}

/**
 * Beginn der laufenden ungeöffneten Strecke — oder null, wenn der Käfig gerade
 * offen oder abgelegt ist.
 */
export function unopenedPhaseStart(events, settings, refMs) {
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  const runs = unopenedRuns((events || []).filter(e => eventMs(e) <= ref), settings);
  const letzte = runs[runs.length - 1];
  return (letzte && letzte.bis == null) ? { ms: letzte.von, model: letzte.model } : null;
}

/**
 * Die an jedem Datum vollendeten 24-h-Blöcke: `{ "2026-03-04": [7] }`.
 *
 * Warum nicht einfach Kalendertage: dann hinge die Belohnung daran, wann
 * Mitternacht fällt. Wer um 01:00 zusperrt und 46 Stunden durchhält, hätte
 * keinen einzigen ganzen Kalendertag — wer um 23:00 zusperrt, nach 26 Stunden
 * schon einen. Gemessen wird deshalb ab dem Verschluss: nach 24 Stunden ist ein
 * Tag voll, egal wie die Uhr dazu steht.
 *
 * Gebucht wird die Marke auf das Datum, an dem sie fällt — der laufende Tag
 * bekommt also nur, was bis jetzt wirklich abgelaufen ist. Zwei Marken an einem
 * Datum sind selten, aber möglich: ein Tag der Zeitumstellung hat 25 Stunden.
 */
export function unopenedMarks(events, settings, now) {
  const nowMs = (now instanceof Date) ? now.getTime()
    : (typeof now === 'number' ? now : Date.now());
  const marks = {};
  for (const run of unopenedRuns(events, settings)) {
    const ende = Math.min(run.bis == null ? nowMs : run.bis, nowMs);
    for (let n = 1; ; n++) {
      const t = run.von + n * TAG_MS;
      if (t > ende) break;
      (marks[isoOf(new Date(t))] ||= []).push(n);
    }
  }
  return marks;
}

/** Zeitpunkt des letzten Orgasmus vor `refMs`, oder null. Ereignisse, die die
 *  Strecke nicht brechen, sind keiner — sie stehen weder in der Kachel
 *  „Orgasmusfrei" noch im Abstand, aus dem der nächste Preis fällt. */
export function lastOrgasmMs(events, settings, refMs) {
  const map = modelMap(settings);
  const ref = (typeof refMs === 'number') ? refMs : Date.now();
  let best = null;
  for (const e of (events || [])) {
    const m = resolveModel(settings, map, e.type);
    if (!brichtStrecke(m)) continue;
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
  // Der Preis, der im Jetzt-Block steht, ist der des Orgasmus — nicht der eines
  // Ereignisses, das daneben steht und die Strecke gar nicht anrührt.
  const kandidaten = s.models.filter(m => m.kind === KIND_ORGASM);
  const orModel = kandidaten.find(m => brichtStrecke(m) && !m.archived)
    || kandidaten.find(m => !m.archived) || kandidaten[0];
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
