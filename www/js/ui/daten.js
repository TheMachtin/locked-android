/**
 * Daten-Tab: Synchronisation, Dateien, Export, Umzug und Version.
 */

import { STATE, calc, setData, clearSyncBase, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtDateShort, escapeHtml } from './format.js';
import { AUTH, CFG, login, logout, isSignedIn } from '../sync/auth.js';
import { loadFromCloud, saveToCloud, fetchLegacyFile, sanityCheck } from '../sync/onedrive.js';
import { openFile, saveFile, readJsonFile, backup, exportCsv, exportXlsx } from '../sync/files.js';
import { importLegacyData } from '../core/migrate.js';
import { commandUrl, webCommandUrl, shortcutModels, MAX_SHORTCUTS } from '../core/command.js';
import { KIND_ORGASM } from '../core/settings.js';
import { platformName, versionLabel, APP_COMMIT, IS_NATIVE, IS_WEB, WEB_APP_URL } from '../platform.js';

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

/**
 * Die Kurzbefehle zum Mitnehmen.
 *
 * Ohne diese Liste wäre die Kommando-Schnittstelle unbenutzbar: die ID eines
 * Modells steht sonst nirgends, und genau sie gehört in die Automation. Jede
 * Zeile ist damit fertig zum Kopieren — der Rest steht in der README.
 */
function renderShortcuts() {
  const s = getSettings();
  const modelle = s.models.filter(m => !m.archived);
  const imLauncher = new Set(shortcutModels(s, MAX_SHORTCUTS).map(m => m.id));

  $('shortcutIntro').innerHTML =
    'Diese Adressen tragen beim Öffnen genau einen Eintrag ein — mit der aktuellen '
    + 'Uhrzeit, ohne Rückfrage. Sie funktionieren überall, wo sich eine URL hinterlegen '
    + 'lässt: Startbildschirm, Automations-App, Uhr.';

  $('shortcutList').innerHTML = modelle.map(m => `<div class="sc-row">
      <span class="dot" style="background:${m.color}"></span>
      <div class="sc-name">${escapeHtml(m.label)}${m.kind === KIND_ORGASM
        ? '<span class="sc-tag warn">kostet</span>'
        : (imLauncher.has(m.id) ? '<span class="sc-tag">im Launcher</span>' : '')}</div>
      <code class="sc-url">${escapeHtml(commandUrl(m.id))}</code>
      <button class="btn ghost sc-copy" type="button"
              data-url="${escapeHtml(commandUrl(m.id))}">Kopieren</button>
    </div>`).join('');

  const beispiel = (modelle[0] && modelle[0].id) || 'HT';
  const basis = IS_WEB ? (location.origin + location.pathname) : WEB_APP_URL;
  $('shortcutHint').innerHTML = [
    IS_NATIVE
      ? `<b>Am Telefon:</b> lang auf das App-Symbol — bis zu ${MAX_SHORTCUTS} Zustände liegen`
        + ' dort schon als Kurzbefehl und lassen sich auf den Startbildschirm ziehen.'
        + ' Ereignisse mit Preis stehen bewusst nicht dabei: ein Kurzbefehl fragt nicht nach.'
      : '<b>Am Telefon:</b> die App legt aus den ersten Modellen selbst Kurzbefehle an'
        + ' (langer Druck auf das App-Symbol).',
    '<b>Von der Uhr:</b> die Kachel der Galaxy Watch schickt dasselbe Kommando und braucht'
      + ' keine dieser Adressen — sie bekommt die Modelle über den Datenkanal. Ohne Uhr-App'
      + ' löst eine Automations-App mit Wear-Begleiter (MacroDroid, Tasker) die Adresse aus.'
      + ' Die Bestätigung kommt so oder so als Benachrichtigung zurück aufs Handgelenk.',
    'Nach dem Eintrag geht die App von allein wieder in den Hintergrund;'
      + ' <code>&amp;app=1</code> am Ende der Adresse hält sie offen.',
    `Im Browser dieselbe Anweisung als Parameter: <code>${escapeHtml(webCommandUrl(basis, beispiel))}</code>`,
  ].map(z => `<div style="margin-top:6px">${z}</div>`).join('');
}

export function render() {
  renderAuth();
  renderShortcuts();
  const v = versionLabel();
  const commit = APP_COMMIT.startsWith('__') ? null : APP_COMMIT;
  $('versionInfo').innerHTML = `<b>Locked v${escapeHtml(v)}</b> · ${platformName()}`
    + (commit ? ` · Commit <code>${escapeHtml(commit)}</code>` : '')
    + (calc().startedAt ? `<br>Punktekonto seit ${fmtDateShort(calc().startedAt)}` : '')
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

  // Die Liste wird bei jedem Rendern neu gebaut — der Zuhörer sitzt deshalb am
  // Behälter und nicht an den Knöpfen.
  $('shortcutList').addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('button[data-url]');
    if (!btn) return;
    const url = btn.dataset.url;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Adresse kopiert');
    } catch {
      // Ohne Zwischenablage (alte WebView, unsicherer Kontext) wenigstens zum
      // Markieren anbieten.
      window.prompt('Adresse von Hand kopieren:', url);
    }
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
