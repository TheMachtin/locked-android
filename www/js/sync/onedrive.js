/**
 * OneDrive-Synchronisation über Microsoft Graph.
 *
 * Geschrieben wird nur mit `If-Match`: ohne ETag ist der Serverstand unbekannt,
 * und ein blindes PUT überschreibt ihn. Bei 412 (die Datei wurde anderswo
 * geändert) wird nicht eine Seite verworfen, sondern dreiwegig zusammengeführt.
 */

import { getToken, isSignedIn } from './auth.js';
import { datenPfad, jetztPfad, legacyPfad } from './paths.js';
import { mergeData } from '../core/merge.js';
import { migrate } from '../core/migrate.js';
import { jetztPayload } from '../core/jetzt.js';
import {
  STATE, calc, setData, setSyncBase, persistLocal, notify, invalidate,
} from '../state.js';

/** Eine Aktion an der Datei unter `pfad` — `content`, `createLink`, `permissions/…`. */
function graphAktion(pfad, aktion) {
  const enc = String(pfad).split('/').map(encodeURIComponent).join('/');
  return `https://graph.microsoft.com/v1.0/me/drive/root:${enc}:/${aktion}`;
}

const graphUrl = (pfad) => graphAktion(pfad, 'content');

/** Die Begründung aus einer Graph-Fehlerantwort ziehen — sie ist meist brauchbar. */
async function graphFehler(res) {
  const body = await res.json().catch(() => null);
  const grund = body && body.error && body.error.message;
  return new Error(grund || `Graph ${res.status}`);
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
  const r = await fetchFile(legacyPfad());
  return r ? r.json : null;
}

export async function loadFromCloud({ silent = false, onMessage = () => {} } = {}) {
  try {
    const got = await fetchFile(datenPfad());
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
  const res = await fetch(graphUrl(datenPfad()), { headers: { Authorization: `Bearer ${token}` } });
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
  const res = await fetch(graphUrl(datenPfad()), {
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
  await schreibeJetzt();
  return true;
}

// =========================== LIVE-ANSICHT ===========================
/**
 * Die abgeleitete `jetzt.json` mitschreiben.
 *
 * Sie enthält nur den Statusblock — keine Ereignisse, keine Einstellungen. Wer
 * ihren Freigabelink hat, sieht den laufenden Zustand und sonst nichts.
 *
 * Drei Eigenschaften, die hier absichtlich so stehen:
 *
 * *Kein `If-Match`.* Die Datei ist abgeleitet, nicht gepflegt — der zuletzt
 * schreibende Stand ist immer der richtige. Ein Konflikt wäre hier kein
 * Datenverlust, sondern eine überflüssige Rückfrage.
 *
 * *Kein Anfassen von `STATE.etag`.* Der gehört zur Hauptdatei; ihn hier zu
 * überschreiben würde das nächste Speichern gegen die falsche Version prüfen.
 *
 * *Fehler bleiben Warnungen.* Eine nicht geschriebene Nebendatei darf ein
 * erfolgreiches Speichern der Historie nicht nachträglich zum Fehlschlag
 * machen.
 */
const LS_JETZT_AN = 'locked_jetzt_publish_v1';

export function jetztVeroeffentlichen() {
  try { return localStorage.getItem(LS_JETZT_AN) === '1'; } catch { return false; }
}

export function setJetztVeroeffentlichen(an) {
  try { localStorage.setItem(LS_JETZT_AN, an ? '1' : '0'); } catch (e) { console.warn(e); }
  vergissJetztStand();
}

/**
 * Den Änderungs-Vergleich zurücksetzen.
 *
 * Nötig, wenn sich ändert, *wohin* geschrieben wird oder *wessen* Ablage das
 * ist — nach einem Abmelden etwa. Der Ordnerwechsel deckt sich schon selbst ab,
 * weil der Pfad im Vergleichsschlüssel steht.
 */
export function vergissJetztStand() { letztesJetzt = null; }

// Zwischen zwei Ereignissen ändert sich am Paket nichts — es besteht aus
// Zeitstempeln, nicht aus Dauern. Der Vergleich spart den zweiten PUT bei jeder
// Randnotiz, die sonst nur dieselbe Datei noch einmal hochlüde. Verglichen wird
// ohne `stand`: der Schreibzeitpunkt ist bei jedem Aufruf ein anderer und wäre
// als Unterschied genau der, der nichts bedeutet.
let letztesJetzt = null;

/**
 * Einen Anzeigen-Link für die `jetzt.json` erzeugen.
 *
 * `createLink` ist wiederholbar: gibt es für dieselbe Art und Reichweite schon
 * einen Link, kommt derselbe zurück statt eines zweiten. Zweimal drücken legt
 * also keine zweite Freigabe an.
 *
 * `Files.ReadWrite` genügt dafür — es ist derselbe Scope, mit dem die App
 * ohnehin schreibt, also keine neue Zustimmung nötig. Was scheitern *kann*, ist
 * die Reichweite: bei einem Geschäftskonto darf die Verwaltung anonyme Links
 * abschalten. Dann kommt die Begründung von Graph zurück und wandert unverändert
 * in die Meldung — geraten wäre hier schlechter als zitiert.
 *
 * @returns {{url: string, permissionId: string|null}}
 */
export async function erzeugeFreigabe() {
  const token = await getToken();
  const res = await fetch(graphAktion(jetztPfad(), 'createLink'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'view', scope: 'anonymous' }),
  });
  if (!res.ok) throw await graphFehler(res);
  const body = await res.json();
  const url = body && body.link && body.link.webUrl;
  if (!url) throw new Error('Antwort ohne Adresse');
  return { url, permissionId: body.id || null };
}

/**
 * Die Freigabe wieder einziehen.
 *
 * Der Gegenpart gehört dazu: eine App, die Links vergibt, aber zum Zurücknehmen
 * auf die OneDrive-Oberfläche verweist, überlässt genau den Schritt von Hand,
 * auf den es ankommt. Ein 404 heißt, die Freigabe ist schon weg — das ist das
 * Ziel und kein Fehler.
 */
export async function entferneFreigabe(permissionId) {
  const token = await getToken();
  const res = await fetch(graphAktion(jetztPfad(), `permissions/${encodeURIComponent(permissionId)}`), {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw await graphFehler(res);
  return true;
}

export async function schreibeJetzt() {
  if (!jetztVeroeffentlichen() || !isSignedIn()) return false;
  try {
    const payload = jetztPayload(STATE.data, calc(), new Date());
    const { stand, ...ohneZeitpunkt } = payload;
    // Der Pfad gehört in den Schlüssel: nach einem Ordnerwechsel liegt am neuen
    // Ort noch nichts, und ein „unverändert" würde das erste Schreiben dort
    // überspringen.
    const schluessel = jetztPfad() + '\n' + JSON.stringify(ohneZeitpunkt);
    if (schluessel === letztesJetzt) return false;
    const json = JSON.stringify(payload);
    const token = await getToken();
    const res = await fetch(graphUrl(jetztPfad()), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: json,
    });
    if (!res.ok) throw new Error(`Graph ${res.status}`);
    letztesJetzt = schluessel;
    return true;
  } catch (e) {
    console.warn('Jetzt-Datei nicht geschrieben', e);
    return false;
  }
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
  const stichtag = data.settings && data.settings.startedAt;
  if (stichtag && !/^\d{4}-\d{2}-\d{2}$/.test(stichtag)) {
    issues.push(`settings.startedAt ist kein Datum: ${stichtag}`);
  }
  return issues;
}
