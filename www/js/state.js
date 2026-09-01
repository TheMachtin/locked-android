/**
 * Zentraler Datenzustand.
 *
 * Alle Änderungen laufen durch `mutate()`: das schreibt den lokalen Cache,
 * stößt das Speichern an und benachrichtigt die Oberfläche. Kein Modul fasst
 * `STATE.data` direkt an, sonst driften Anzeige und gespeicherter Stand
 * auseinander.
 *
 * Das Speichern selbst kennt dieses Modul nicht — es bekommt die Funktion über
 * `registerSaver()` gereicht. Sonst hinge der Zustand an OneDrive, und ein
 * Kreisimport wäre die Folge.
 */

import { computeAll } from './core/calc.js';
import { migrate, leereDaten } from './core/migrate.js';
import { normalizeSettings } from './core/settings.js';

// Eigene Schlüssel je Datenformat: 2.0 liegt neben 1.x, und die alte App darf
// den neuen Stand nicht anfassen (sie kennt weder settings noch legacy und
// würde beides beim Speichern verlieren).
export const LS_KEY      = 'locked_data_v3';
export const LS_BASE_KEY = 'locked_sync_base_v3';

export const STATE = {
  data: leereDaten(),
  /** Zuletzt mit der Cloud abgeglichener Stand — Basis für den Drei-Wege-Merge. */
  base: null,
  etag: null,
  fileHandle: null,
  dirty: false,
};

// =========================== BENACHRICHTIGUNG ===========================
const listeners = new Set();
/** @returns Abmelde-Funktion */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

let saver = null;
let persister = null;
/** Wird von sync/ gesetzt: speichert nach OneDrive, wenn angemeldet. */
export function registerSaver(fn) { saver = fn; }
/** Wird von platform.js gesetzt: zusätzliche Kopie ins native Dateisystem. */
export function registerPersister(fn) { persister = fn; }

// =========================== BERECHNUNGS-CACHE ===========================
// computeAll() rechnet die komplette Historie durch und steckt in fast jeder
// Render-Funktion. Der Schlüssel enthält die laufende Minute, damit der aktuelle
// Tag von allein nachzieht, ohne dass jemand invalidieren muss.
let rev = 0;
let cache = null;
export function invalidate() { rev++; cache = null; }

export function calc() {
  const key = rev + ':' + Math.floor(Date.now() / 60000);
  if (cache && cache.key === key) return cache.result;
  const result = computeAll(STATE.data);
  cache = { key, result };
  return result;
}

/** Die normalisierten Einstellungen des aktuellen Stands. */
export function settings() { return calc().settings; }

// =========================== SPEICHERN ===========================
export function persistLocal() {
  invalidate();
  try { localStorage.setItem(LS_KEY, JSON.stringify(STATE.data)); } catch (e) { console.warn(e); }
  if (persister) { try { persister(STATE.data); } catch (e) { console.warn(e); } }
}

export function setSyncBase(data) {
  STATE.base = JSON.parse(JSON.stringify(data));
  try { localStorage.setItem(LS_BASE_KEY, JSON.stringify(STATE.base)); } catch {}
}
export function loadSyncBase() {
  try {
    const raw = localStorage.getItem(LS_BASE_KEY);
    STATE.base = raw ? JSON.parse(raw) : null;
  } catch { STATE.base = null; }
}
export function clearSyncBase() {
  STATE.base = null;
  try { localStorage.removeItem(LS_BASE_KEY); } catch {}
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    // Bewusst *mit* Persistieren: hebt die Migration einen 1.x-Stand auf 2.0,
    // muss das Ergebnis sofort zurück in den Cache. Sonst liefe die Migration
    // bei jedem Start erneut — und weil sie den Stichtag auf „heute" setzt,
    // wanderte er ohne Cloud-Anbindung Tag für Tag mit.
    setData(JSON.parse(raw), { notify: false });
    return true;
  } catch (e) { console.error(e); return false; }
}

/**
 * Einen von außen gekommenen Stand übernehmen (Cloud, Datei, nativer Speicher).
 * Läuft immer durch die Migration: eine 1.x-Datei wird dabei auf 2.0 gehoben und
 * ihre alte Ära eingefroren.
 */
export function setData(raw, opts) {
  const o = opts || {};
  const { data, migriert, legacyErzeugt } = migrate(raw);
  STATE.data = data;
  invalidate();
  if (o.persist !== false) persistLocal();
  if (o.notify !== false) notify();
  return { migriert, legacyErzeugt };
}

/**
 * Eine Änderung anwenden.
 * @param {function} fn        bekommt `STATE.data` und ändert es
 * @param {object} [opts]      { save?: boolean, silent?: boolean }
 */
export function mutate(fn, opts) {
  const o = opts || {};
  fn(STATE.data);
  STATE.dirty = true;
  persistLocal();
  if (o.save !== false && saver) saver();
  if (!o.silent) notify();
}

/** Einstellungen ändern — mit Zeitstempel, damit der Merge den jüngeren Stand erkennt. */
export function mutateSettings(fn) {
  mutate(data => {
    const s = normalizeSettings(data.settings);
    fn(s);
    data.settings = { ...normalizeSettings(s), updatedAt: new Date().toISOString() };
  });
}

/**
 * Zustand vor einer Löschung sichern und als "Rückgängig" anbieten.
 * Ein Fehlgriff auf dem Handy ist schnell passiert und war bisher endgültig.
 */
export function withUndo(apply, showToast, msg) {
  const vorher = JSON.stringify(STATE.data);
  apply();
  showToast(msg, false, {
    label: 'Rückgängig',
    run: () => {
      mutate(data => {
        const alt = JSON.parse(vorher);
        for (const k of Object.keys(data)) delete data[k];
        Object.assign(data, alt);
      });
      showToast('Wiederhergestellt');
    },
  });
}
