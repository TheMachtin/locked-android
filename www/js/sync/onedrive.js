/**
 * OneDrive-Synchronisation über Microsoft Graph.
 *
 * Geschrieben wird nur mit `If-Match`: ohne ETag ist der Serverstand unbekannt,
 * und ein blindes PUT überschreibt ihn. Bei 412 (die Datei wurde anderswo
 * geändert) wird nicht eine Seite verworfen, sondern dreiwegig zusammengeführt.
 */

import { CFG, getToken, isSignedIn } from './auth.js';
import { mergeData } from '../core/merge.js';
import { migrate } from '../core/migrate.js';
import {
  STATE, setData, setSyncBase, persistLocal, notify, invalidate,
} from '../state.js';

function graphUrl(pfad) {
  const enc = String(pfad).split('/').map(encodeURIComponent).join('/');
  return `https://graph.microsoft.com/v1.0/me/drive/root:${enc}:/content`;
}

/** Rohen Dateiinhalt holen. @returns {{json, etag}} oder null bei 404. */
async function fetchFile(pfad) {
  const token = await getToken();
  const res = await fetch(graphUrl(pfad), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  return { json: await res.json(), etag: res.headers.get('ETag') || null };
}

/** Die alte 1.x-Datei lesen — für den einmaligen Umzug. */
export async function fetchLegacyFile() {
  const r = await fetchFile(CFG.legacyPath);
  return r ? r.json : null;
}

export async function loadFromCloud({ silent = false, onMessage = () => {} } = {}) {
  try {
    const got = await fetchFile(CFG.oneDrivePath);
    if (!got) {
      if (!silent) onMessage('Noch keine Datei in OneDrive — sie entsteht beim ersten Speichern');
      return { neu: true };
    }
    const issues = sanityCheck(got.json);
    const { migriert, legacyErzeugt } = setData(got.json, { notify: false });
    setSyncBase(STATE.data);
    STATE.etag = got.etag;
    STATE.dirty = false;
    notify();
    if (issues.length) {
      console.warn('Daten-Auffälligkeiten:', issues);
      onMessage(`${issues.length} Daten-Auffälligkeit(en) — Konsole prüfen`, true);
    } else if (!silent) {
      onMessage(`${(STATE.data.events || []).length} Einträge geladen`);
    }
    // Ein migrierter Stand muss zurückgeschrieben werden, sonst friert das
    // nächste Gerät die alte Ära ein zweites Mal ein.
    if (migriert || legacyErzeugt) await saveToCloud();
    return { migriert, legacyErzeugt };
  } catch (e) {
    console.error(e);
    // Auch den stillen Start-Load melden: schlägt er fehl, bleibt der lokale
    // Cache stehen und sieht aus wie der aktuelle Stand.
    onMessage('OneDrive-Laden fehlgeschlagen — angezeigte Daten können veraltet sein', true);
    return { fehler: e };
  }
}

/**
 * Serverstand laden und mit dem lokalen zusammenführen.
 * @throws wenn der Serverstand nicht lesbar ist — dann darf nicht gespeichert
 *         werden, sonst überschreibt der lokale Stand ungeprüft.
 */
export async function mergeWithRemote(onMessage = () => {}) {
  const token = await getToken();
  const res = await fetch(graphUrl(CFG.oneDrivePath), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;               // erste Speicherung legt sie an
  if (!res.ok) throw new Error(`Serverstand nicht lesbar (Graph ${res.status})`);
  const remote = migrate(await res.json()).data;
  const { data, stats } = mergeData(STATE.base, STATE.data, remote);

  STATE.data = data;
  invalidate();
  STATE.etag = res.headers.get('ETag') || null;
  persistLocal();
  notify();

  const teile = [];
  if (stats.uebernommen) teile.push(`${stats.uebernommen} Eintrag${stats.uebernommen === 1 ? '' : 'e'} vom anderen Gerät`);
  if (stats.entfernt) teile.push(`${stats.entfernt} entfernt oder geändert`);
  if (stats.einstellungenVonRemote) teile.push('Einstellungen vom anderen Gerät');
  if (stats.konflikte.length) teile.push(`${stats.konflikte.length}× beidseitig geändert (lokal behalten)`);
  if (!stats.basisBekannt) teile.push('ohne Basis vereinigt');
  if (teile.length) onMessage(`Zusammengeführt: ${teile.join(', ')}`);
  if (stats.konflikte.length) console.warn('Merge-Konflikte:', stats.konflikte);
  return stats;
}

export async function saveToCloud(versuch = 0, onMessage = () => {}) {
  // Ohne ETag ist der Serverstand unbekannt. Genau das passiert, wenn der
  // Start-Load fehlgeschlagen ist: dann steht der lokale Cache im Speicher und
  // der erste Eintrag würde die OneDrive-Datei damit ersetzen.
  if (!STATE.etag && versuch === 0) await mergeWithRemote(onMessage);

  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (STATE.etag) headers['If-Match'] = STATE.etag;
  const res = await fetch(graphUrl(CFG.oneDrivePath), {
    method: 'PUT', headers, body: JSON.stringify(STATE.data, null, 2),
  });

  if (res.status === 412) {
    if (versuch >= 2) throw new Error('Sync-Konflikt bleibt bestehen — bitte später nochmal speichern');
    await mergeWithRemote(onMessage);
    return saveToCloud(versuch + 1, onMessage);
  }
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  const body = await res.json().catch(() => null);
  STATE.etag = res.headers.get('ETag') || (body && body.eTag) || null;
  setSyncBase(STATE.data);
  STATE.dirty = false;
  return true;
}

// =========================== AUTO-SAVE ===========================
// Sofort speichern bei jeder Änderung. Läuft schon ein Save, wird der nächste
// angehängt statt parallel gestartet.
let inFlight = false;
let queued = false;
let onState = () => {};
export function setSaveStateHandler(fn) { onState = fn; }

export async function autosave() {
  if (!isSignedIn()) return;                 // ohne Login bleibt manuelles Speichern
  if (inFlight) { queued = true; return; }
  inFlight = true;
  onState('saving');
  try {
    await saveToCloud();
    onState('saved');
  } catch (e) {
    console.error(e);
    onState('error', e);
  } finally {
    inFlight = false;
    if (queued) { queued = false; autosave(); }
  }
}

// =========================== PRÜFUNG ===========================
/** Auffälligkeiten in einer geladenen Datei melden, ohne sie zu verändern. */
export function sanityCheck(data) {
  const issues = [];
  if (!data || typeof data !== 'object') { issues.push('Datei ist kein Objekt'); return issues; }
  if (!Array.isArray(data.events)) issues.push('events fehlt oder ist kein Array');
  else {
    data.events.forEach((e, i) => {
      if (!e || typeof e !== 'object') return issues.push(`event[${i}] kein Objekt`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) issues.push(`event[${i}] ungültiges Datum: ${e.date}`);
      if (!/^\d{2}:\d{2}$/.test(e.time || '')) issues.push(`event[${i}] ungültige Zeit: ${e.time}`);
      if (!e.type) issues.push(`event[${i}] ohne Typ`);
    });
  }
  if (data.settings && !Array.isArray(data.settings.models)) issues.push('settings.models ist kein Array');
  if (data.legacy && typeof data.legacy.punkte !== 'number') issues.push('legacy.punkte ist keine Zahl');
  if (data.startedAt && !/^\d{4}-\d{2}-\d{2}$/.test(data.startedAt)) {
    issues.push(`startedAt ist kein Datum: ${data.startedAt}`);
  }
  return issues;
}
