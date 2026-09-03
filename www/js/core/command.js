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
