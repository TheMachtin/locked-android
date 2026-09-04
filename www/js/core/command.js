/**
 * Kommandos — ein Eintrag, der von außen kommt.
 *
 * Die Schnelltasten im Eintrag-Tab setzen voraus, dass das Telefon in der Hand
 * liegt. Ein Kommando ist derselbe Eintrag, nur ausgelöst über eine URL:
 *
 *     locked://log?m=HT              vom Startbildschirm, aus einer Automation,
 *                                    von der Uhr über eine Brücken-App
 *     …/locked-android/?log=HT       dieselbe Anweisung an die Web-App
 *
 * Warum eine URL und nicht ein eigener Kanal: eine URL ist das einzige, was
 * *jede* Automatisierung auf Android auslösen kann — Launcher-Shortcut,
 * MacroDroid, Tasker, Bixby, ein Lesezeichen. Wer sie schickt, ist egal; die
 * Uhr ist damit nur einer von vielen möglichen Absendern.
 *
 * Hier steht ausschließlich, *was* ein Kommando bedeutet: Text zerlegen, Modell
 * auflösen, Eintrag planen. Geschrieben, gespeichert und gemeldet wird in
 * `shortcuts.js` — dieser Kern läuft ohne DOM und ist damit testbar.
 */

import { isoOf, hmOf, isoDateAdd, eventMs, pad2 } from './time.js';
import { eventKey } from './merge.js';
import { modelMap, resolveModel, openModelId, KIND_MODEL, KIND_ORGASM } from './settings.js';
import { regenState } from './calc.js';

/** Das Schema der App. `log` ist ein eigener Host neben `auth` (dem OAuth-Rücksprung). */
export const CMD_URL = 'locked://log';
/** Derselbe Befehl an die Web-App, als Query-Parameter der Seite. */
export const CMD_PARAM = 'log';

// Mehrere Schreibweisen je Feld: die URL tippt man in einer Automations-App von
// Hand ab, oft auf einem kleinen Bildschirm. `m` ist kurz, `modell` erklärt sich.
const P_MODELL = ['m', 'modell', 'model', 'log', 'typ'];
const P_ZEIT   = ['t', 'zeit', 'time'];
const P_DATUM  = ['d', 'datum', 'date'];
const P_ZEIGEN = ['app', 'zeigen', 'show'];

/** Alle Parameter, die zu einem Kommando gehören — die Web-App räumt sie nach
 *  der Ausführung aus der Adresse, sonst trüge ein Neuladen sie erneut ein. */
export const CMD_PARAMS = [...P_MODELL, ...P_ZEIT, ...P_DATUM, ...P_ZEIGEN];

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const RELATIV   = /^[+-]?\d{1,3}$/;
const TAGESWORT = { heute: 0, today: 0, gestern: -1, vorgestern: -2, morgen: 1 };

/**
 * Query-Parameter aus einer beliebigen URL ziehen.
 *
 * Von Hand statt über `new URL()`: bei einem eigenen Schema (`locked://`) ist
 * dessen Ergebnis je nach Umgebung unterschiedlich — dieselbe Erfahrung wie beim
 * OAuth-Rücksprung in `sync/auth.js`.
 */
function paramsOf(url) {
  const s = String(url || '');
  const qi = s.indexOf('?');
  if (qi < 0) return new URLSearchParams('');
  const hi = s.indexOf('#', qi);
  return new URLSearchParams(hi > qi ? s.slice(qi + 1, hi) : s.slice(qi + 1));
}

function ersterWert(params, namen) {
  for (const n of namen) {
    const v = params.get(n);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function istWahr(v) {
  return v != null && !/^(0|nein|false|no)$/i.test(v);
}

/**
 * Eine URL in ein Kommando übersetzen — oder `null`, wenn keins drinsteckt.
 *
 * Zwei Formen werden erkannt: das eigene Schema (`locked://log?…`, wie es der
 * Launcher-Shortcut und die Automations-App schicken) und der Parameter `log`
 * an einer beliebigen Adresse (die Web-App, ein Lesezeichen, ein Desktop-Link).
 * Alles andere — insbesondere `locked://auth?code=…` — geht diesen Weg nicht.
 */
export function parseCommand(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  const istSchema = /^locked:\/\/log(\/|\?|$)/i.test(s);
  const params = paramsOf(s);
  const modell = ersterWert(params, istSchema ? P_MODELL : [CMD_PARAM]);
  if (!modell) return null;
  if (!istSchema && !params.has(CMD_PARAM)) return null;
  return {
    modell,
    zeit:   ersterWert(params, P_ZEIT),
    datum:  ersterWert(params, P_DATUM),
    zeigen: istWahr(ersterWert(params, P_ZEIGEN)),
  };
}

/**
 * Modell aus der Registry heraussuchen.
 *
 * Zuerst über die ID — die ist stabil, sobald Einträge auf sie zeigen, und
 * gehört deshalb in eine URL, die man einmal einrichtet und jahrelang benutzt.
 * Der Name wird trotzdem akzeptiert: wer „Holy Trainer" abtippt, meint dasselbe,
 * und eine Fehlermeldung wäre hier nur formal im Recht. Archivierte Modelle
 * bleiben erreichbar — ein alter Shortcut soll sagen können, was er soll.
 */
export function resolveCommandModel(settings, wunsch) {
  const w = String(wunsch || '').trim();
  if (!w) return null;
  const flach = t => String(t).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const ziel = flach(w);
  return settings.models.find(m => m.id.toLowerCase() === w.toLowerCase())
      || settings.models.find(m => flach(m.label) === ziel)
      || null;
}

/**
 * Der Zustand, der zu `refMs` galt.
 *
 * Ohne Eintrag davor ist es der offene Zustand — derselbe Startpunkt, den auch
 * die Tagesrechnung annimmt. Orgasmus-Ereignisse sagen nichts über den Verschluss
 * und werden übersprungen.
 */
export function currentStateAt(events, settings, refMs) {
  const map = modelMap(settings);
  let treffer = null;
  let bestMs = -Infinity;
  for (const e of (events || [])) {
    if (resolveModel(settings, map, e.type).kind === KIND_ORGASM) continue;
    const t = eventMs(e);
    if (!isFinite(t) || t > refMs) continue;
    if (t >= bestMs) { bestMs = t; treffer = e; }
  }
  return treffer
    ? { type: treffer.type, ms: bestMs, time: treffer.time, date: treffer.date }
    : { type: openModelId(settings), ms: null, time: null, date: null };
}

function zeitAus(roh, now) {
  if (roh == null) return { time: hmOf(now) };
  const m = /^(\d{1,2}):?(\d{2})$/.exec(roh);
  if (!m) return { fehler: `Unlesbare Zeit: ${roh}` };
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return { fehler: `Unlesbare Zeit: ${roh}` };
  return { time: `${pad2(h)}:${pad2(min)}` };
}

function datumAus(roh, now) {
  const heute = isoOf(now);
  if (roh == null) return { date: heute };
  if (ISO_DATUM.test(roh)) return { date: roh };
  const wort = TAGESWORT[roh.toLowerCase()];
  if (wort != null) return { date: isoDateAdd(heute, wort) };
  // „-1" heißt gestern. Ein Shortcut, der den Vortag nachträgt, muss nicht jeden
  // Tag neu geschrieben werden.
  if (RELATIV.test(roh)) return { date: isoDateAdd(heute, parseInt(roh, 10)) };
  return { fehler: `Unlesbares Datum: ${roh}` };
}

/**
 * Was ein Kommando bewirken würde — ohne etwas zu schreiben.
 *
 * Der Aufrufer entscheidet; hier entsteht nur der Plan. Das ist dieselbe
 * Aufteilung wie bei der Inaktivitäts-Regel und macht den Fall testbar, in dem
 * gar nichts geschrieben werden darf: dieselbe Minute, dasselbe Modell.
 *
 * @param {object} data      { events }
 * @param {object} settings  normalisierte Einstellungen
 * @param {object} cmd       Ergebnis von parseCommand()
 * @param {Date}   [now]
 */
export function planCommand(data, settings, cmd, now) {
  const jetzt = now || new Date();
  const model = resolveCommandModel(settings, cmd && cmd.modell);
  if (!model) return { ok: false, fehler: `Unbekanntes Modell: ${cmd ? cmd.modell : '—'}` };

  const z = zeitAus(cmd.zeit, jetzt);
  if (z.fehler) return { ok: false, fehler: z.fehler };
  const d = datumAus(cmd.datum, jetzt);
  if (d.fehler) return { ok: false, fehler: d.fehler };

  const event = { date: d.date, time: z.time, type: model.id };

  // Doppelter Auslöser: ein Fehlgriff am Handgelenk, eine wiederholte
  // Automation, ein zweiter Tastendruck. Derselbe Schlüssel bedeutet denselben
  // Eintrag — ihn ein zweites Mal zu schreiben, hieße dasselbe zweimal zu
  // behaupten. Gemeldet wird es trotzdem: stille Wirkungslosigkeit wäre am
  // Handgelenk nicht von Erfolg zu unterscheiden.
  const schluessel = eventKey(event);
  if ((data.events || []).some(e => eventKey(e) === schluessel)) {
    return {
      ok: true, doppelt: true, model, event,
      meldung: `${model.label} ${event.time} stand schon — nichts geändert`,
    };
  }

  const vorher = model.kind === KIND_MODEL
    ? currentStateAt(data.events, settings, eventMs(event))
    : null;
  // Derselbe Zustand wie vorher: der Eintrag ändert an der Rechnung nichts,
  // wird aber geschrieben. Er ist eine echte Handlung — er hält die
  // Inaktivitäts-Frist frisch und belegt, dass zu dieser Zeit jemand hingesehen
  // hat. Die Meldung sagt, dass sich nichts verschoben hat.
  const unveraendert = !!vorher && vorher.type === model.id;

  // Die Regeneration hat Fenster und Sperrfrist; die Schnelltaste ist außerhalb
  // davon abgeschaltet. Ein Kommando kommt an dieser Taste vorbei — es wird
  // trotzdem eingetragen (was geschehen ist, ist geschehen), sagt aber dazu,
  // dass es gerade nicht dran war. Stillschweigen wäre hier die Unwahrheit.
  const hinweis = regenHinweis(data, settings, model, jetzt);

  return {
    ok: true, doppelt: false, model, event, vorher, unveraendert, hinweis,
    meldung: (unveraendert
      ? `${model.label} ${event.time} — Zustand war schon ${model.label}`
      : `${model.label} ${event.time} eingetragen`)
      + (hinweis ? ` — ${hinweis}` : ''),
  };
}

function regenHinweis(data, settings, model, jetzt) {
  if (!model.regen) return null;
  const st = regenState(data, settings, jetzt);
  if (st.state === 'active') return 'eine läuft schon';
  if (st.state === 'cooldown') return 'Sperrfrist läuft noch';
  return null;
}

// =========================== SHORTCUTS ===========================
/** Wie viele Kurzbefehle der Launcher realistisch zeigt. Android erlaubt meist
 *  fünf; das native Plugin kürzt zusätzlich auf das, was das Gerät meldet. */
export const MAX_SHORTCUTS = 4;

/**
 * Welche Modelle einen Launcher-Shortcut bekommen.
 *
 * Zwei Entscheidungen stecken darin:
 *
 * **Keine Ereignisse mit Preis.** Ein Shortcut löst sofort aus — es gibt kein
 * Gedrückthalten, keinen Rückfragedialog, und ausgelöst wird er unterwegs, ohne
 * hinzusehen. Ein Fehlgriff soll deshalb nichts kosten können. Wer den Orgasmus
 * trotzdem auf die Uhr legen will, kann seine URL von Hand bauen; automatisch
 * angeboten wird er nicht.
 *
 * **Der offene Zustand ist immer dabei.** Er ist der Ausweg. Eine Liste von
 * Käfigen ohne die Möglichkeit, „abgelegt" zu sagen, wäre die Hälfte der
 * Wahrheit — deshalb bekommt er notfalls den letzten Platz.
 */
export function shortcutModels(settings, max) {
  const grenze = Math.max(1, max || MAX_SHORTCUTS);
  const kandidaten = settings.models.filter(m => m.kind === KIND_MODEL && !m.archived);
  const liste = kandidaten.slice(0, grenze);
  const offen = kandidaten.find(m => m.isOpen);
  if (offen && !liste.some(m => m.id === offen.id)) {
    if (liste.length >= grenze) liste[grenze - 1] = offen;
    else liste.push(offen);
  }
  return liste;
}

/** Wie viele Knöpfe die Kachel der Uhr trägt. Mehr als sechs werden auf einem
 *  runden Zifferblatt zu klein zum Treffen. */
export const MAX_TILE_BUTTONS = 6;

/**
 * Zwei Buchstaben für einen Namen: „Holy Trainer" → „HT", „Neosteel" → „NE".
 *
 * Auf einem Kachel-Knopf und unter einem Launcher-Symbol ist für mehr kein
 * Platz. Die Regel steht hier und nicht zweimal in Java, damit Uhr und
 * Startbildschirm dasselbe Kürzel zeigen.
 */
export function initialen(label) {
  const sauber = w => String(w).replace(/[^\p{L}\p{N}]/gu, '');
  const worte = String(label || '').trim().split(/\s+/).map(sauber).filter(Boolean);
  if (worte.length >= 2) return (worte[0][0] + worte[1][0]).toUpperCase();
  const eins = worte[0] || '';
  return (eins.slice(0, 2) || '•').toUpperCase();
}

/** Die ersten zwei Zeichen einer ID — „CLEAN" → „CL". */
function idKurz(id) {
  return String(id || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
}

/**
 * Steht die ID noch für den Namen — kommen ihre Zeichen der Reihe nach darin vor?
 *
 * „NS" passt zu „Neosteel", „HT" zu „Holy Trainer". „KK" passt zu „Nicht
 * verschlossen" nicht, und nach einer Umbenennung von „Neosteel" zu „Stahl"
 * passt „NS" auch nicht mehr — dann ist der Name die ehrlichere Auskunft.
 */
function passtZumNamen(id, label) {
  const name = String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  let ab = 0;
  for (const zeichen of String(id || '').toLowerCase()) {
    const treffer = name.indexOf(zeichen, ab);
    if (treffer < 0) return false;
    ab = treffer + 1;
  }
  return true;
}

/**
 * Das Kürzel *eines* Modells — die ID, solange sie zum Namen passt.
 *
 * Der Knopf schickt eine ID (`locked://log?m=NS`), und dieselbe ID steht in den
 * Kurzbefehlen, in einer Automation und in der Adresse zum Kopieren. Zeigte der
 * Knopf daneben ein aus dem Namen gerechnetes „NE", gäbe es für dasselbe Modell
 * zwei Kürzel — eins zum Lesen und eins zum Tippen. Deshalb gewinnt die ID,
 * wenn sie kurz genug ist *und* noch zum Namen passt; sonst der Name, der nach
 * einer Umbenennung als einziger stimmt.
 */
export function kuerzel(model) {
  const id = String((model && model.id) || '');
  const label = (model && model.label) || id;
  const kurz = idKurz(id);
  const ganz = id.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (kurz && kurz.length === ganz && passtZumNamen(id, label)) return kurz;
  return initialen(label);
}

/**
 * Kürzel für die ganze Registry — je Modell eins, und keins zweimal.
 *
 * „Regeneration" und „Reinigung" ergeben beide „RE": zwei Knöpfe, die gleich
 * aussehen und Verschiedenes tun. Am Handgelenk, ohne hinzusehen, ist das der
 * eine Fehlgriff, den die Kachel nicht anbieten darf. Wer zuerst in der Registry
 * steht, behält sein Kürzel; für den zweiten sucht die Leiter unten das nächste
 * freie — „Reinigung" wird über seine ID `CLEAN` zu „CL".
 *
 * Gerechnet wird über die *ganze* Registry, nicht über die Auswahl, die gerade
 * auf einen Bildschirm passt: sonst hieße dasselbe Modell auf der Uhr anders als
 * am Startbildschirm, je nachdem, wer sonst noch mitfährt.
 */
export function kuerzelMap(settings) {
  const aktive = ((settings && settings.models) || []).filter(m => !m.archived);
  const belegt = new Set();
  const out = {};
  for (const m of aktive) {
    for (const kandidat of kuerzelLeiter(m)) {
      if (!kandidat || belegt.has(kandidat)) continue;
      belegt.add(kandidat);
      out[m.id] = kandidat;
      break;
    }
  }
  return out;
}

/** Kürzel-Vorschläge für ein Modell, vom besten abwärts. Der letzte ist immer frei. */
function* kuerzelLeiter(model) {
  const label = String((model && model.label) || (model && model.id) || '');
  yield kuerzel(model);
  yield idKurz(model && model.id);
  yield initialen(label);
  // Erster Buchstabe plus ein weiterer aus dem Namen: „Reinigung" → RE, RI, RN, …
  const zeichen = label.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = 1; i < zeichen.length; i++) yield zeichen[0] + zeichen[i];
  for (let i = 2; i <= 9; i++) yield (zeichen[0] || '•') + i;
}

/** Zeitraum, über den die Nutzung eines Modells für die Kachel zählt. */
export const TILE_USAGE_DAYS = 90;

/**
 * Welche Modelle auf die Kachel kommen.
 *
 * Die Kachel hat weniger Platz als der Startbildschirm Geduld, deshalb entscheidet
 * sie schärfer als `shortcutModels()`:
 *
 * **Der getragene Zustand fehlt.** Sein Knopf setzt den Zustand auf den Zustand —
 * er kostet nur den Platz eines Knopfes, der etwas ändern könnte. Wer ohnehin im
 * Käfig ist, braucht den Käfig nicht anzutippen; was er trägt, steht als Zeile
 * darüber. Nebenbei wird der Knopf dadurch größer: MultiButtonLayout zeichnet
 * weniger Knöpfe größer, und drei Knöpfe trifft man unterwegs besser als vier.
 *
 * **Der Ausweg bleibt gesetzt.** Der offene Zustand bekommt notfalls den letzten
 * Platz — außer er ist gerade selbst der getragene, dann braucht ihn niemand.
 *
 * **Käfige vor Reinigung und Regeneration.** Wer mehr Modelle führt, als auf ein
 * Zifferblatt passen, will die tragen können; die Nebenzustände sind der Rest.
 * Innerhalb beider Klassen entscheidet, wie oft ein Modell zuletzt gebraucht
 * wurde — die Historie liegt auf dem Telefon, die Uhr muss davon nichts wissen.
 *
 * Gezeichnet wird am Ende in Registry-Reihenfolge: welcher Knopf wo liegt, soll
 * sich nicht mit der Nutzung verschieben, sonst lernt man die Kachel nie.
 */
export function tileModels(data, settings, max, jetztId, refMs) {
  const grenze = Math.max(1, max || MAX_TILE_BUTTONS);
  const kandidaten = settings.models.filter(m => m.kind === KIND_MODEL && !m.archived);
  const waehlbar = kandidaten.filter(m => m.id !== jetztId);
  const genutzt = nutzung(data, refMs);

  const rang = m => (m.pause || m.regen ? 1 : 0);
  const sortiert = waehlbar
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rang(a.m) - rang(b.m)
      || (genutzt[b.m.id] || 0) - (genutzt[a.m.id] || 0)
      || a.i - b.i)
    .map(x => x.m);

  const offen = waehlbar.find(m => m.isOpen);
  const liste = sortiert.slice(0, grenze);
  if (offen && !liste.some(m => m.id === offen.id)) {
    if (liste.length >= grenze) liste[grenze - 1] = offen;
    else liste.push(offen);
  }

  const drin = new Set(liste.map(m => m.id));
  return waehlbar.filter(m => drin.has(m.id));
}

/** Wie oft jedes Modell zuletzt eingetragen wurde. */
function nutzung(data, refMs) {
  const ab = refMs - TILE_USAGE_DAYS * 86400000;
  const out = {};
  for (const e of ((data && data.events) || [])) {
    const t = eventMs(e);
    if (!isFinite(t) || t < ab || t > refMs) continue;
    out[e.type] = (out[e.type] || 0) + 1;
  }
  return out;
}

/**
 * Was die Uhr wissen muss — und mehr nicht.
 *
 * Die Modelle mit Farbe und Kürzel, damit die Kachel sie zeichnen kann, und der
 * gerade getragene Zustand, damit dort etwas Wahres steht, bevor man tippt.
 * Keine Einträge, keine Punkte, keine Historie: die Uhr ist eine Fernbedienung.
 *
 * `seitMs` ist der Zeitpunkt, seit dem dieser Zustand gilt — nicht die fertige
 * Dauer. Eine Dauer wäre in dem Moment richtig, in dem sie gesendet wird, und
 * danach jede Minute falscher; der Zeitpunkt bleibt wahr, und die Uhr rechnet
 * beim Zeichnen. `seit` bleibt als Uhrzeit daneben stehen, damit eine ältere
 * Uhr-APK weiter etwas anzuzeigen hat.
 */
export function watchPayload(data, settings, max, now) {
  const refMs = (now || new Date()).getTime();
  const st = currentStateAt((data && data.events) || [], settings, refMs);
  const m = resolveModel(settings, modelMap(settings), st.type);
  const kurz = kuerzelMap(settings);
  return {
    models: tileModels(data, settings, max || MAX_TILE_BUTTONS, m.id, refMs).map(x => ({
      id: x.id,
      label: x.label,
      kurz: kurz[x.id] || initialen(x.label),
      color: x.color,
    })),
    jetzt: { id: m.id, label: m.label, seit: st.time || '', seitMs: st.ms || null },
  };
}

/** Die fertige Adresse für ein Modell — genau das, was in die Automation gehört. */
export function commandUrl(id) {
  return `${CMD_URL}?m=${encodeURIComponent(id)}`;
}

/** Dieselbe Anweisung an eine Web-Adresse (Pages, lokaler Server, Desktop). */
export function webCommandUrl(basis, id) {
  const b = String(basis || '').split('#')[0];
  const trenner = b.includes('?') ? '&' : '?';
  return `${b}${trenner}${CMD_PARAM}=${encodeURIComponent(id)}`;
}
