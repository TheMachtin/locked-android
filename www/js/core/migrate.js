/**
 * Umstieg von 1.x auf 2.0.
 *
 * Der Schnitt passiert genau einmal, beim ersten Start der neuen Version:
 *   - Stichtag = heute. Ab hier zählt das neue Konto, und es startet bei null.
 *   - Die Historie davor wird mit der alten Formel durchgerechnet und als
 *     `legacy` eingefroren (siehe legacy.js) — sichtbar, aber unveränderlich.
 *   - Die Events selbst bleiben unangetastet. Tragezeit, Orgasmus-Zähler und
 *     Kalender laufen deshalb über den Schnitt hinweg durch; nur die Punkte
 *     beginnen neu.
 *
 * Wer die App frisch installiert, hat keine Historie: dann entsteht kein
 * `legacy`, und die Archiv-Karte erscheint gar nicht erst.
 */

import { defaultSettings, normalizeSettings, todayIso } from './settings.js';
import { freezeLegacy } from './legacy.js';
import { eventKey } from './merge.js';

export const DATA_VERSION = 3;

export function leereDaten(now) {
  return {
    version: DATA_VERSION,
    startedAt: todayIso(now),
    events: [],
    days: {},
    notes: {},
    meta: {},
    settings: { ...defaultSettings(), updatedAt: new Date((now || new Date())).toISOString() },
  };
}

/**
 * Beliebigen geladenen Datenstand auf 2.0 bringen.
 * Idempotent: ein bereits migrierter Stand geht unverändert durch (bis auf die
 * Normalisierung der Einstellungen, die immer läuft).
 *
 * @returns {{ data, migriert: boolean, legacyErzeugt: boolean }}
 */
export function migrate(raw, opts) {
  const now = (opts && opts.now) || new Date();
  const data = (raw && typeof raw === 'object') ? { ...raw } : {};
  data.events = Array.isArray(data.events) ? data.events : [];
  data.days   = (data.days && typeof data.days === 'object') ? data.days : {};
  data.notes  = (data.notes && typeof data.notes === 'object') ? data.notes : {};
  data.meta   = (data.meta && typeof data.meta === 'object') ? data.meta : {};

  const schonMigriert = (data.version >= DATA_VERSION) && !!data.settings && !!data.startedAt;
  if (schonMigriert) {
    data.settings = { ...normalizeSettings(data.settings), updatedAt: data.settings.updatedAt };
    return { data, migriert: false, legacyErzeugt: false };
  }

  // Stichtag: heute. Ein angebrochener Tag gehört ganz in die neue Ära — sonst
  // stünde er halb in der alten Formel und halb in der neuen.
  const stichtag = data.startedAt || todayIso(now);
  data.startedAt = stichtag;
  data.version = DATA_VERSION;
  if (!data.settings) {
    data.settings = { ...defaultSettings(), updatedAt: new Date(now).toISOString() };
  } else {
    data.settings = { ...normalizeSettings(data.settings), updatedAt: data.settings.updatedAt };
  }

  let legacyErzeugt = false;
  if (!data.legacy) {
    const snap = freezeLegacy(data, stichtag);
    if (snap) { data.legacy = snap; legacyErzeugt = true; }
  }
  return { data, migriert: true, legacyErzeugt };
}

/**
 * Eine alte 1.x-Datei in einen bestehenden 2.0-Stand übernehmen.
 *
 * Events werden vereinigt (Dubletten über date|time|typ erkannt), das Archiv
 * anschließend aus dem *vollständigen* Bestand eingefroren — sonst fehlte im
 * Archiv genau das, was gerade erst dazugekommen ist.
 */
export function importLegacyData(current, incoming, opts) {
  const now = (opts && opts.now) || new Date();
  const ziel = { ...current };
  const alt = (incoming && typeof incoming === 'object') ? incoming : {};

  const vorhanden = new Set((ziel.events || []).map(eventKey));
  const neu = (alt.events || []).filter(e =>
    e && e.date && e.time && e.type && !vorhanden.has(eventKey(e)));
  ziel.events = [...(ziel.events || []), ...neu]
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  ziel.days  = { ...(alt.days  || {}), ...(ziel.days  || {}) };
  ziel.notes = { ...(alt.notes || {}), ...(ziel.notes || {}) };

  // Der Stichtag darf nicht vor den importierten Daten liegen, sonst zählte die
  // alte Historie plötzlich im neuen Konto mit.
  const letzterAlt = ziel.events.length ? ziel.events[ziel.events.length - 1].date : null;
  const stichtag = ziel.startedAt || todayIso(now);
  ziel.startedAt = (letzterAlt && letzterAlt > stichtag) ? letzterAlt : stichtag;

  let legacyErzeugt = false;
  if (!ziel.legacy) {
    const snap = freezeLegacy(ziel, ziel.startedAt);
    if (snap) { ziel.legacy = snap; legacyErzeugt = true; }
  }
  return { data: ziel, uebernommen: neu.length, legacyErzeugt };
}
