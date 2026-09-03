/**
 * Einstellungen: Modell-Registry und Punktesätze.
 *
 * Alles, was die Punkteberechnung steuert, liegt hier als *Daten* — nicht als
 * Konstante im Code. Die Registry wandert mit der Datei über OneDrive, Handy und
 * PC rechnen deshalb zwingend gleich, und ein neuer Käfig ist ein Eintrag im
 * Einstellungs-Tab statt eines Releases.
 *
 * Drei Eigenschaften tragen Bedeutung, die das Programm kennen muss und die
 * darum nicht am Namen hängen (der Name ist frei änderbar):
 *   - `isOpen`  : der Zustand "nicht verschlossen". Er ist der Startzustand der
 *                 Historie und das Ziel automatischer Einträge. Genau einer.
 *   - `regen`   : trägt die Regenerations-Mechanik (Fenster + Sperrfrist).
 *                 Höchstens einer, darf auch fehlen.
 *   - `pause`   : eine Unterbrechung (Reinigung). Sie ist keine verschlossene
 *                 Zeit, beendet die verschlossene Phase aber auch nicht.
 *
 * `locked` und `pause` schließen sich aus; zusammen mit "keins von beidem"
 * (offen) ergeben sie die drei Verschluss-Zustände, siehe `lockKind()`.
 */

import { pad2 } from './time.js';

export const KIND_MODEL  = 'model';   // ändert den getragenen Zustand
export const KIND_ORGASM = 'orgasm';  // Zeitpunkt-Ereignis mit Preis

/** Farbvorschläge für neue Modelle — in dieser Reihenfolge vergeben. */
export const PALETTE = [
  '#84cc16', '#65a30d', '#bef264', '#4d7c0f', '#a3e635',
  '#c89060', '#8aa0b8', '#b48ead', '#d19a66', '#5f9ea0',
];

export const DEFAULT_MODELS = [
  { id: 'HT',    kind: KIND_MODEL,  label: 'Holy Trainer',       color: '#84cc16', rate: 0.5,  locked: true },
  { id: 'NS',    kind: KIND_MODEL,  label: 'Neosteel',           color: '#65a30d', rate: 0.5,  locked: true },
  { id: 'PC',    kind: KIND_MODEL,  label: 'Penicap',            color: '#bef264', rate: 0.5,  locked: true },
  { id: 'REG',   kind: KIND_MODEL,  label: 'Regeneration',       color: '#c89060', rate: 0.5,  locked: true,
    regen: true, windowH: 12, cooldownD: 5 },
  { id: 'CLEAN', kind: KIND_MODEL,  label: 'Reinigung',          color: '#8aa0b8', rate: 0,    locked: false,
    pause: true },
  { id: 'KK',    kind: KIND_MODEL,  label: 'Nicht verschlossen', color: '#7a6a52', rate: -1,   locked: false,
    isOpen: true },
  { id: 'OR',    kind: KIND_ORGASM, label: 'Orgasmus',           color: '#dc2626',
    priceMin: 15, priceMax: 60, halflifeDays: 7, repeatFactor: 1 },
];

export const DEFAULT_POINTS = {
  /** Zuschlag für einen Tag, der (fast) durchgehend verschlossen war. */
  bonusDurchgehend: 5,
  /** Bis zu wie vielen offenen Stunden der Zuschlag noch gilt. */
  bonusMaxOffenH: 1,
  /** Einnahmen-Multiplikator: 1 + streakK × orgasmusfreie Tage, gedeckelt. */
  streakK: 0.02,
  streakCap: 2.0,
  /** Form-Wert: gestern × formDecay + Tagesnetto. 0,97 ≈ 23 Tage Halbwertszeit. */
  formDecay: 0.97,
};

export const DEFAULT_RULES = {
  inactivityReminderDays: 2,
  inactivityAutoDays: 4,
};

/**
 * Fassung des Einstellungs-Schemas.
 *
 * Modelle sind Daten und liegen in der synchronisierten Datei — eine neue
 * Bedeutung im Programm erreicht einen bestehenden Stand deshalb nur, wenn sie
 * beim Laden nachgezogen wird. Der Nachzug läuft genau einmal je Datei und
 * hinterlässt die Fassung, damit eine später von Hand geänderte Einstellung
 * nicht beim nächsten Start wieder überschrieben wird.
 */
export const SETTINGS_SCHEMA = 2;

export function defaultSettings() {
  return {
    schema: SETTINGS_SCHEMA,
    models: DEFAULT_MODELS.map(m => ({ ...m })),
    points: { ...DEFAULT_POINTS },
    rules:  { ...DEFAULT_RULES },
  };
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

// =========================== NORMALISIERUNG ===========================
const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Aus einem Anzeigenamen eine freie, stabile ID ableiten ("Neuer Käfig" → "NEUKAE"). */
export function idFromLabel(label, taken) {
  const used = new Set(taken || []);
  const base = String(label || '')
    .toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'MODELL';
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}${i}`.slice(0, 8);
    if (!used.has(cand)) return cand;
  }
  return base + Date.now().toString(36).toUpperCase().slice(-3);
}

function normalizeModel(raw, index, taken) {
  const kind = raw.kind === KIND_ORGASM ? KIND_ORGASM : KIND_MODEL;
  let id = String(raw.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!id || taken.has(id)) id = idFromLabel(raw.label || `M${index + 1}`, taken);
  taken.add(id);

  const m = {
    id, kind,
    label: String(raw.label || id).slice(0, 40) || id,
    color: /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : PALETTE[index % PALETTE.length],
    archived: !!raw.archived,
  };
  if (kind === KIND_MODEL) {
    // Satz und Verschluss-Zustand werden nicht gegeneinander geprüft: ein
    // positiver Satz ohne Verschluss wäre meist ein Versehen, kann aber gemeint
    // sein (eine belohnte Auszeit). Nur der Verschluss-Zustand selbst muss
    // eindeutig bleiben — verschlossen und Unterbrechung schließen sich aus,
    // denn eine Unterbrechung ist gerade *keine* verschlossene Zeit; sie
    // beendet die Phase nur nicht.
    m.rate = clamp(num(raw.rate, 0), -100, 100);
    m.locked = !!raw.locked;
    m.pause = !m.locked && !!raw.pause;
    if (raw.isOpen) { m.isOpen = true; m.pause = false; }
    if (raw.regen) {
      m.regen = true;
      m.windowH   = clamp(num(raw.windowH, 12), 0.25, 24 * 14);
      m.cooldownD = clamp(num(raw.cooldownD, 5), 0, 365);
    }
  } else {
    m.priceMin      = clamp(num(raw.priceMin, DEFAULT_MODELS.at(-1).priceMin), 0, 100000);
    m.priceMax      = clamp(num(raw.priceMax, m.priceMin), m.priceMin, 100000);
    m.halflifeDays  = clamp(num(raw.halflifeDays, 7), 0.1, 3650);
    m.repeatFactor  = clamp(num(raw.repeatFactor, 1), 1, 100);
  }
  return m;
}

/**
 * Schema 1 → 2: die Reinigung wird zur Unterbrechung.
 *
 * Bis dahin kannte das Programm nur "verschlossen" und "offen", und die
 * Reinigung fiel notgedrungen unter "offen". Zehn Minuten am Waschbecken haben
 * damit die verschlossene Phase auf null zurückgesetzt — eine Aussage, die so
 * nie gemeint war: der Käfig ist danach derselbe wie davor.
 *
 * Der Nachzug greift nur, wo die Bedeutung eindeutig ist: ein Modell, das weder
 * der offene Zustand noch die Regeneration ist, nicht als verschlossen zählt und
 * an der Standard-ID oder am Namen als Reinigung erkennbar bleibt. Er läuft
 * genau einmal je Datei (siehe SETTINGS_SCHEMA) — wer die Einstellung danach
 * von Hand ändert, behält sie.
 */
function upgradeReinigungZuPause(models) {
  for (const m of models) {
    if (m.kind !== KIND_MODEL || m.isOpen || m.locked || m.regen) continue;
    if (m.id === 'CLEAN' || /reinig/i.test(m.label)) m.pause = true;
  }
}

/**
 * Beliebiges (auch fehlendes oder von einer neueren Version geschriebenes)
 * settings-Objekt in eine garantiert benutzbare Form bringen.
 *
 * Die Zusicherungen, auf die sich der Rest des Programms verlässt:
 * mindestens ein Modell, genau ein `isOpen`, höchstens ein `regen`,
 * eindeutige IDs, alle Zahlen endlich und in sinnvollen Grenzen.
 */
export function normalizeSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const list = Array.isArray(src.models) && src.models.length ? src.models : DEFAULT_MODELS;

  const taken = new Set();
  let models = list
    .filter(m => m && typeof m === 'object')
    .map((m, i) => normalizeModel(m, i, taken));

  if (!models.some(m => m.kind === KIND_MODEL)) {
    models = DEFAULT_MODELS.map(m => ({ ...m }));
  }

  const schema = Math.max(1, Math.round(num(src.schema, 1)));
  if (schema < 2) upgradeReinigungZuPause(models);

  // Genau ein "offen"-Zustand: ohne ihn gäbe es keinen Startzustand für die
  // Historie und kein Ziel für automatische Einträge. Eine Unterbrechung taugt
  // nicht dafür — sie sagt gerade *nichts* über den Verschluss aus.
  const opens = models.filter(m => m.kind === KIND_MODEL && m.isOpen);
  if (opens.length !== 1) {
    for (const m of models) delete m.isOpen;
    const pick = opens[0]
      || models.find(m => m.kind === KIND_MODEL && !m.locked && !m.pause && !m.archived)
      || models.find(m => m.kind === KIND_MODEL && !m.locked && !m.pause)
      || models.find(m => m.kind === KIND_MODEL);
    pick.isOpen = true;
    pick.locked = false;
    pick.pause = false;
    pick.archived = false;
  }
  // Der offene Zustand darf nie archiviert sein — er ist immer erreichbar — und
  // er ist die Öffnung selbst: weder verschlossen noch eine Unterbrechung davon.
  const open = models.find(m => m.isOpen);
  open.archived = false;
  open.locked = false;
  open.pause = false;

  // Höchstens ein Regenerations-Modell.
  let seenRegen = false;
  for (const m of models) {
    if (!m.regen) continue;
    if (seenRegen) { delete m.regen; delete m.windowH; delete m.cooldownD; }
    seenRegen = true;
  }

  const p = (src.points && typeof src.points === 'object') ? src.points : {};
  const r = (src.rules && typeof src.rules === 'object') ? src.rules : {};
  const out = {
    models,
    // Eine neuere Fassung wird nicht heruntergestuft: sie hat Bedeutung
    // geschrieben, die diese Version nicht kennt, und ein Nachzug auf 2 würde
    // sie bei jedem Start erneut anstoßen.
    schema: Math.max(SETTINGS_SCHEMA, schema),
    points: {
      bonusDurchgehend: clamp(num(p.bonusDurchgehend, DEFAULT_POINTS.bonusDurchgehend), -1000, 1000),
      bonusMaxOffenH:   clamp(num(p.bonusMaxOffenH,   DEFAULT_POINTS.bonusMaxOffenH), 0, 24),
      streakK:          clamp(num(p.streakK,          DEFAULT_POINTS.streakK), 0, 10),
      streakCap:        clamp(num(p.streakCap,        DEFAULT_POINTS.streakCap), 1, 100),
      formDecay:        clamp(num(p.formDecay,        DEFAULT_POINTS.formDecay), 0.5, 0.9999),
    },
    rules: {
      inactivityReminderDays: clamp(num(r.inactivityReminderDays, DEFAULT_RULES.inactivityReminderDays), 1, 365),
      inactivityAutoDays:     clamp(num(r.inactivityAutoDays,     DEFAULT_RULES.inactivityAutoDays), 1, 365),
    },
  };
  // Der Stichtag ist normalerweise *abgeleitet* (siehe stichtagOf) und steht nur
  // dann hier, wenn er von Hand gesetzt wurde. Ein leeres Feld heißt „wieder
  // ableiten", nicht „ab dem Jahr null".
  if (ISO_DATUM.test(src.startedAt || '')) out.startedAt = src.startedAt;
  return out;
}

/**
 * Ab wann das Punktekonto zählt.
 *
 * Ohne Archiv gibt es keine alte Ära, von der zu trennen wäre — dann zählt
 * alles, was eingetragen ist, auch nachgetragene Tage. Mit Archiv beginnt die
 * neue Ära genau dort, wo die eingefrorene endet. Ein von Hand gesetzter Wert
 * schlägt beides.
 */
export function stichtagOf(data, settings) {
  if (settings && settings.startedAt) return settings.startedAt;
  const legacy = data && data.legacy;
  if (legacy && ISO_DATUM.test(legacy.bis || '')) {
    const d = new Date(legacy.bis + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return null;   // alles zählt
}


// =========================== ZUGRIFF ===========================
/** Nachschlagetabelle id → Modell. Unbekannte IDs liefern undefined. */
export function modelMap(settings) {
  const map = new Map();
  for (const m of settings.models) map.set(m.id, m);
  return map;
}

export function openModelId(settings) {
  const m = settings.models.find(x => x.isOpen);
  return m ? m.id : settings.models[0].id;
}

export function regenModel(settings) {
  return settings.models.find(m => m.regen) || null;
}

/** Modelle, die den getragenen Zustand ändern (ohne Orgasmus-Ereignisse). */
export function stateModels(settings) {
  return settings.models.filter(m => m.kind === KIND_MODEL);
}

export function orgasmModels(settings) {
  return settings.models.filter(m => m.kind === KIND_ORGASM);
}

/** IDs, die als "verschlossen" gelten. */
export function lockedIds(settings) {
  return new Set(stateModels(settings).filter(m => m.locked).map(m => m.id));
}

/** IDs, die eine Unterbrechung sind (weder verschlossen noch offen). */
export function pauseIds(settings) {
  return new Set(stateModels(settings).filter(m => m.pause).map(m => m.id));
}

export const LOCK_KINDS = ['locked', 'pause', 'open'];

/**
 * Verschluss-Wirkung eines Zustandsmodells als *ein* Wert.
 *
 * In der Datei stehen zwei Schalter (`locked`, `pause`), weil ältere Fassungen
 * nur den ersten kannten. Gemeint ist eine Auswahl aus drei sich ausschließenden
 * Möglichkeiten, und genau so fragen Oberfläche und Rechnung sie ab.
 */
export function lockKind(m) {
  if (m.locked) return 'locked';
  if (m.pause) return 'pause';
  return 'open';
}

/** Gegenstück zu `lockKind()` — setzt beide Schalter widerspruchsfrei. */
export function applyLockKind(m, kind) {
  const k = LOCK_KINDS.includes(kind) ? kind : 'open';
  m.locked = k === 'locked';
  m.pause  = k === 'pause';
}

/**
 * Ein unbekannter Event-Typ (Modell gelöscht, Datei aus einer neueren Version)
 * darf die Berechnung nicht zum Absturz bringen. Er wird als offen und
 * punkteneutral behandelt und ist in der UI als „unbekannt" markiert.
 */
export function resolveModel(settings, map, id) {
  const m = map.get(id);
  if (m) return m;
  return { id, kind: KIND_MODEL, label: `${id} (unbekannt)`, color: '#6b7280',
           rate: 0, locked: false, pause: false, archived: true, unknown: true };
}

/** Anzeigename mit Fallback. */
export function labelOf(settings, id) {
  const m = settings.models.find(x => x.id === id);
  return m ? m.label : `${id} (unbekannt)`;
}

/** Preis eines Orgasmus-Ereignisses.
 *  Fällt mit der Wartezeit von priceMax auf priceMin — ein seltener Orgasmus ist
 *  bezahlbar, ein häufiger teuer. Der Abstand zählt in Bruchteilen von Tagen, ein
 *  zweiter drei Stunden später steht deshalb schon von allein nahe am Höchstpreis;
 *  `repeatFactor` (Standard 1) ist der zusätzliche Aufschlag je weiterem am selben
 *  Tag, falls das noch nicht reicht. */
export function orgasmPrice(model, daysSinceLast, nth) {
  const min = model.priceMin, max = model.priceMax, hl = model.halflifeDays;
  const t = (typeof daysSinceLast === 'number' && isFinite(daysSinceLast) && daysSinceLast >= 0)
    ? daysSinceLast : Infinity;
  const base = t === Infinity ? min : min + (max - min) * Math.pow(2, -t / hl);
  return base * Math.pow(model.repeatFactor, Math.max(0, (nth || 1) - 1));
}

/** Heutiges Datum als ISO — hier, damit UI und Kern dieselbe Quelle benutzen. */
export function todayIso(now) {
  const d = now || new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
