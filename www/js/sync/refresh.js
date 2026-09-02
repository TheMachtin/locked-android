/**
 * Abgleich auf Anforderung: Knopf, Ziehgeste und Rückkehr aus dem Hintergrund.
 *
 * Der Sync konnte das Wesentliche längst — `mergeWithRemote()` holt den
 * Serverstand und führt ihn dreiwegig zusammen. Was fehlte, war ein Auslöser:
 * geladen wurde nur beim Start und beim Anmelden. Kam die App aus dem
 * Hintergrund zurück, stand der Stand von vorhin auf dem Schirm, während das
 * andere Gerät längst etwas eingetragen hatte.
 *
 * Aktualisieren heißt hier bewusst *holen und schicken*: liegen lokal
 * ungespeicherte Änderungen, wären sie nach einem reinen Merge immer noch nur
 * lokal. „Aktuell" wäre dann die halbe Wahrheit.
 *
 * `silent` unterdrückt nur die Erfolgsmeldung ohne Neuigkeit. Fehler und
 * hereingekommene Einträge werden immer gemeldet — ein stiller Fehlschlag sähe
 * aus wie ein aktueller Stand, und genau das soll die Funktion ja ausräumen.
 */

import { STATE } from '../state.js';
import { isSignedIn } from './auth.js';
import { mergeWithRemote, saveToCloud } from './onedrive.js';
import { showToast } from '../ui/toast.js';

let laeuft = false;
let zuletzt = null;
let onState = () => {};

/** Wird von main.js gesetzt: Kopfzeile und Knopf folgen dem Zustand. */
export function setRefreshStateHandler(fn) { onState = fn; }
export function isRefreshing() { return laeuft; }
/** Zeitpunkt des letzten erfolgreichen Abgleichs, oder null. */
export function lastSyncAt() { return zuletzt; }
/** Von außen melden, dass gerade abgeglichen wurde (Start-Load, Anmeldung). */
export function markSynced() { zuletzt = Date.now(); onState(); }

/**
 * Serverstand holen, zusammenführen und Eigenes nachschicken.
 * @param {object} [opts] { silent?: boolean }
 * @returns {Promise<{ok: boolean, grund?: string}>}
 */
export async function refresh(opts) {
  const { silent = false } = opts || {};
  if (laeuft) return { ok: false, grund: 'laeuft' };
  if (!isSignedIn()) {
    if (!silent) showToast('Ohne OneDrive gibt es nichts abzugleichen', true);
    return { ok: false, grund: 'abgemeldet' };
  }
  if (navigator.onLine === false) {
    if (!silent) showToast('Offline — Abgleich später', true);
    return { ok: false, grund: 'offline' };
  }

  laeuft = true;
  onState();
  try {
    // mergeWithRemote meldet selbst, was hereinkam. Nur wenn es nichts zu
    // melden gab, sagen wir hier etwas — sonst überschriebe der zweite Toast
    // sofort den ersten, und die Meldung, auf die es ankommt, wäre die
    // verlorene.
    const stats = await mergeWithRemote(m => showToast(m));
    const neues = !!stats && !!(stats.uebernommen || stats.entfernt
      || stats.einstellungenVonRemote || stats.konflikte.length);

    const warOffen = STATE.dirty;
    if (warOffen) await saveToCloud();

    zuletzt = Date.now();
    if (!silent && !neues) {
      showToast(stats === null
        ? (warOffen ? 'In OneDrive angelegt' : 'Noch keine Datei in OneDrive')
        : (warOffen ? 'Aktuell — Eigenes gesichert' : 'Alles aktuell'));
    }
    return { ok: true, stats };
  } catch (e) {
    console.error(e);
    showToast('Abgleich fehlgeschlagen — angezeigte Daten können veraltet sein', true);
    return { ok: false, grund: 'fehler', fehler: e };
  } finally {
    laeuft = false;
    onState();
  }
}
