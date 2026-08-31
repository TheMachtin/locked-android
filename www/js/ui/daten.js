/**
 * Daten-Tab: Synchronisation, Dateien, Export, Umzug und Version.
 */

import { STATE, calc, setData, clearSyncBase } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtDateShort, escapeHtml } from './format.js';
import { AUTH, CFG, login, logout, isSignedIn } from '../sync/auth.js';
import { loadFromCloud, saveToCloud, fetchLegacyFile, sanityCheck } from '../sync/onedrive.js';
import { openFile, saveFile, readJsonFile, backup, exportCsv, exportXlsx } from '../sync/files.js';
import { importLegacyData } from '../core/migrate.js';
import { platformName, versionLabel, APP_COMMIT } from '../platform.js';

const $ = id => document.getElementById(id);

export function renderAuth() {
  $('authRedirectInfo').innerHTML = AUTH.redirectUri
    ? `Redirect-URI dieser Installation: <code>${escapeHtml(AUTH.redirectUri)}</code>`
    : '';
  $('cloudPath').innerHTML = `Datei: <code>${escapeHtml(CFG.oneDrivePath)}</code>`;
  const status = $('authStatus');
  if (AUTH.account) {
    status.textContent = `Angemeldet als ${AUTH.account.username || AUTH.account.name}`;
    $('btnLogin').classList.add('hide');
    $('btnLogout').classList.remove('hide');
  } else {
    status.textContent = AUTH.ready ? 'Nicht angemeldet' : 'Lade…';
    $('btnLogin').classList.remove('hide');
    $('btnLogout').classList.add('hide');
  }
  renderUmzug();
}

/**
 * Umzugskarte: sie erscheint nur, solange es etwas zu holen gibt — also wenn
 * noch keine Historie da ist und auch kein Archiv. Danach verschwindet sie,
 * damit niemand versehentlich ein zweites Mal importiert.
 */
function renderUmzug() {
  const card = $('umzugCard');
  const leer = (STATE.data.events || []).length === 0 && !STATE.data.legacy;
  card.classList.toggle('hide', !leer);
}

export function render() {
  renderAuth();
  const v = versionLabel();
  const commit = APP_COMMIT.startsWith('__') ? null : APP_COMMIT;
  $('versionInfo').innerHTML = `<b>Locked v${escapeHtml(v)}</b> · ${platformName()}`
    + (commit ? ` · Commit <code>${escapeHtml(commit)}</code>` : '')
    + (STATE.data.startedAt ? `<br>Punktekonto seit ${fmtDateShort(STATE.data.startedAt)}` : '')
    + (STATE.data.legacy ? ` · Archiv bis ${fmtDateShort(STATE.data.legacy.bis)}` : '');

  $('fsaHint').textContent = window.showOpenFilePicker
    ? 'Tipp: nach „Laden…" einmal die locked2.json aus dem OneDrive-Ordner auswählen — die Sitzung merkt sich die Datei zum direkten Schreiben.'
    : 'Hinweis: Dieser Browser kann nicht direkt schreiben. „Speichern" lädt die Datei herunter, die du dann in den OneDrive-Ordner kopierst.';
}

async function uebernehmen(quelle, alt) {
  const probleme = sanityCheck(alt);
  if (probleme.length) console.warn('Auffälligkeiten in der alten Datei:', probleme);
  const anzahl = (alt.events || []).length;
  if (!anzahl) { showToast('Die Datei enthält keine Einträge', true); return; }
  if (!confirmAction(`${anzahl} Einträge aus ${quelle} übernehmen?\n\n`
    + 'Die alte Punkteformel wird dabei einmalig durchgerechnet und als unveränderliches Archiv abgelegt. '
    + 'Das neue Konto startet trotzdem bei null.')) return;

  const { data, uebernommen, legacyErzeugt } = importLegacyData(STATE.data, alt);
  setData(data);
  if (isSignedIn()) { try { await saveToCloud(); } catch (e) { console.error(e); } }
  showToast(`${uebernommen} Einträge übernommen${legacyErzeugt ? ' · Archiv angelegt' : ''}`);
}

export function initDaten() {
  $('btnLogin').addEventListener('click', async () => {
    try { await login(); }
    catch (e) { console.error(e); showToast('Anmeldung fehlgeschlagen: ' + (e.errorMessage || e.message || e), true); }
  });
  $('btnLogout').addEventListener('click', async () => {
    await logout();
    STATE.etag = null;
    clearSyncBase();
    showToast('Abgemeldet');
  });
  $('btnReload').addEventListener('click', async () => {
    if (!isSignedIn()) { showToast('Nicht angemeldet', true); return; }
    await loadFromCloud({ onMessage: (m, bad) => showToast(m, bad) });
  });

  $('btnLoad').addEventListener('click', async () => {
    try {
      const r = await openFile();
      if (!r) return;
      showToast(`${(STATE.data.events || []).length} Einträge geladen`);
      $('fileStatus').textContent = `Geladen: ${r.name}`;
    } catch (e) { console.error(e); showToast('Datei-Fehler', true); }
  });
  $('btnSave').addEventListener('click', async () => {
    try {
      const r = await saveFile();
      showToast(r.method === 'fsa' ? 'In Datei gespeichert' : 'Heruntergeladen');
    } catch (e) { console.error(e); showToast('Speichern fehlgeschlagen', true); }
  });

  $('btnBackup').addEventListener('click', () => { backup(); showToast('Backup heruntergeladen'); });
  $('btnExportCsv').addEventListener('click', () => { exportCsv(); showToast('CSV exportiert'); });
  $('btnExportXlsx').addEventListener('click', async () => {
    try { await exportXlsx(calc()); showToast('Excel-Export heruntergeladen'); }
    catch (e) { console.error(e); showToast('Excel-Baustein nicht ladbar', true); }
  });

  $('btnImportCloud').addEventListener('click', async () => {
    if (!isSignedIn()) { showToast('Dafür erst mit Microsoft anmelden', true); return; }
    try {
      const alt = await fetchLegacyFile();
      if (!alt) { showToast('Keine locked.json in OneDrive gefunden', true); return; }
      await uebernehmen('der alten OneDrive-Datei', alt);
    } catch (e) { console.error(e); showToast('Übernahme fehlgeschlagen: ' + (e.message || e), true); }
  });
  $('btnImportFile').addEventListener('click', async () => {
    try {
      const r = await readJsonFile();
      if (!r) return;
      await uebernehmen(r.name, r.data);
    } catch (e) { console.error(e); showToast('Datei nicht lesbar', true); }
  });
}
