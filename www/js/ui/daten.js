/**
 * Der Abschnitt „Daten und Geräte" im Tab Einstellungen: Synchronisation,
 * Zusehen-Link, Kurzbefehle, Sicherung, Umzug und Version.
 *
 * Bis 2.4 war das ein eigener Tab. Alles darin richtet man einmal ein und sieht
 * dann selten wieder hin — die Karten starten deshalb zugeklappt und tragen
 * ihren Stand in der Kopfzeile.
 */

import { STATE, calc, setData, clearSyncBase, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtDateShort, escapeHtml } from './format.js';
import { AUTH, login, logout, isSignedIn } from '../sync/auth.js';
import {
  loadFromCloud, saveToCloud, fetchLegacyFile, sanityCheck, entferneFreigabe,
} from '../sync/onedrive.js';
import {
  cloudOrdner, setCloudOrdner, normalizeOrdner, datenPfad,
} from '../sync/paths.js';
import { openFile, saveFile, readJsonFile, backup, exportCsv, exportXlsx } from '../sync/files.js';
import { importLegacyData } from '../core/migrate.js';
import { commandUrl, webCommandUrl, shortcutModels, kuerzelMap, MAX_SHORTCUTS } from '../core/command.js';
import { jetztPayload } from '../core/jetzt.js';
import { payloadKodieren } from './jetzt.js';
import { KIND_ORGASM } from '../core/settings.js';
import {
  platformName, versionLabel, APP_COMMIT, IS_NATIVE, IS_WEB, WEB_APP_URL,
  overlayGranted, openOverlaySettings,
} from '../platform.js';

const $ = id => document.getElementById(id);

export function renderAuth() {
  const status = $('authStatus');
  const sub = $('syncSub');
  // Die Redirect-URI braucht nur, wer die Anmeldung gerade einrichtet — also
  // genau dann, wenn sie nicht klappt. Angemeldet ist sie Technik ohne Frage.
  $('authRedirectInfo').innerHTML = !AUTH.account && AUTH.redirectUri
    ? `Redirect-URI dieser Installation: <code>${escapeHtml(AUTH.redirectUri)}</code>`
    : '';
  if (AUTH.account) {
    status.innerHTML = `Angemeldet als <b>${escapeHtml(AUTH.account.username || AUTH.account.name)}</b>`;
    sub.textContent = 'angemeldet';
    sub.classList.remove('warn');
    $('btnLogin').classList.add('hide');
    $('btnLogout').classList.remove('hide');
  } else {
    status.textContent = AUTH.ready ? 'Nicht angemeldet — es wird nur auf diesem Gerät gespeichert.' : 'Lade…';
    sub.textContent = AUTH.ready ? 'nicht angemeldet' : '';
    sub.classList.toggle('warn', AUTH.ready);
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

// =========================== ABLAGEORT ===========================
/**
 * Wo die Dateien liegen.
 *
 * Der Ordner gilt pro Installation (siehe `sync/paths.js`) — nach einem Umzug
 * muss er also an jedem Gerät einmal gesetzt werden. Das steht auch so da:
 * lautlos die halbe Historie am alten Ort zu lassen wäre die schlechtere
 * Überraschung.
 */
function renderOrdner() {
  const feld = $('cloudFolder');
  if (!feld) return;
  if (document.activeElement !== feld) feld.value = cloudOrdner();
  $('cloudFolderHint').innerHTML =
    `Datei: <code>${escapeHtml(datenPfad())}</code>. Beim Wechsel wird nichts `
    + 'verschoben — erst in OneDrive umlegen, dann hier eintragen. Gilt nur für '
    + 'dieses Gerät.';
}

async function ordnerUebernehmen() {
  const roh = $('cloudFolder').value;
  const ordner = normalizeOrdner(roh);
  if (ordner === cloudOrdner()) { renderOrdner(); showToast('Ordner unverändert'); return; }

  // Am neuen Ort liegt ein anderer Stand, und der ersetzt beim Laden den
  // hiesigen. Ungespeichertes wäre dann weg — ohne dass jemand danach gefragt
  // worden wäre.
  if (STATE.dirty && !confirmAction('Es gibt noch nicht gespeicherte Änderungen.\n\n'
    + 'Nach dem Wechsel wird der Stand aus dem neuen Ordner geladen und ersetzt sie. '
    + 'Trotzdem wechseln?')) { renderOrdner(); return; }

  setCloudOrdner(ordner);
  // Beides gehört zur *alten* Datei: ein ETag von dort ließe das nächste
  // Speichern gegen eine Version prüfen, die am neuen Ort niemand kennt, und
  // die Merge-Basis beschriebe eine Historie, die dort vielleicht gar nicht
  // liegt. Beides muss weg, bevor irgendetwas geschrieben wird.
  STATE.etag = null;
  clearSyncBase();
  renderOrdner();
  renderAuth();

  if (!isSignedIn()) { showToast('Ordner gemerkt — wirkt nach der Anmeldung'); return; }
  const r = await loadFromCloud({ onMessage: (m, bad) => showToast(m, bad) });
  if (r && r.neu) showToast('Kein locked2.json an diesem Ort — beim nächsten Speichern entsteht es dort', true);
}

// =========================== ZUSEHEN LASSEN ===========================
/*
 * Der Link trägt den Block „Jetzt" in sich selbst (`jetzt.html#d=…`) — keine
 * Datei, keine Freigabe, kein Konto beim Empfänger.
 *
 * Daneben stand bis 2.4 zugeklappt ein zweiter Weg: eine laufende `jetzt.json`
 * in OneDrive, die eine Anzeigeseite minütlich nachholt. Er war gebaut und
 * geprüft, führte aber ins Leere — OneDrive gibt anonyme Dateien nicht an
 * fremdes JavaScript heraus (gemessen am 07.09.26, siehe README). In der App
 * steht er deshalb nicht mehr; die Anzeigeseite versteht `#q=` weiterhin, für
 * eine Datei an einem Ort, der sie herausgibt.
 *
 * Geblieben ist das Zurücknehmen: wer damals einen Freigabelink erzeugt hat,
 * hat in OneDrive eine öffentliche Freigabe liegen, und die App, die sie
 * angelegt hat, muss sie auch wieder einziehen können.
 */
const LS_PERM = 'locked_jetzt_perm_v1';
const ALTE_SCHLUESSEL = ['locked_jetzt_publish_v1', 'locked_jetzt_share_v1'];

function permId() {
  try { return localStorage.getItem(LS_PERM) || ''; } catch { return ''; }
}

async function freigabeZuruecknehmen() {
  const id = permId();
  if (!id) return;
  if (!isSignedIn()) { showToast('Dafür erst mit Microsoft anmelden', true); return; }
  if (!confirmAction('Die alte Freigabe der jetzt.json zurücknehmen?\n\n'
    + 'Der Link hört danach auf zu funktionieren — auch bei denen, die ihn schon haben.')) return;
  await entferneFreigabe(id);
  try { localStorage.removeItem(LS_PERM); } catch {}
  renderZusehen();
  showToast('Freigabe zurückgenommen');
}

function renderZusehen() {
  $('altFreigabe').classList.toggle('hide', !permId());
}

/** Die Adresse der Anzeigeseite — im Web neben der App, sonst die Web-Fassung. */
function ansichtBasis() {
  if (!IS_WEB) return WEB_APP_URL + 'jetzt.html';
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'jetzt.html';
}

function momentaufnahmeLink() {
  const paket = jetztPayload(STATE.data, calc(), new Date());
  return `${ansichtBasis()}#d=${payloadKodieren(paket)}`;
}

/** Adresse in die Zwischenablage — mit dem Weg für Browser ohne sie. */
async function kopieren(text, meldung) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(meldung);
  } catch {
    // Ohne Zwischenablage (alte WebView, unsicherer Kontext) wenigstens zum
    // Markieren anbieten.
    window.prompt('Adresse von Hand kopieren:', text);
  }
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
  // Auf Kachel und Startbildschirm steht das Kürzel, hier die ID. Meist dasselbe —
  // und wo nicht, wäre der Knopf sonst nirgends erklärt.
  const kurz = kuerzelMap(s);

  $('shortcutIntro').innerHTML =
    'Jede Adresse trägt beim Öffnen genau einen Eintrag ein — mit der aktuellen '
    + 'Uhrzeit, ohne Rückfrage. Hinterlegen lässt sie sich überall, wo eine URL geht.';

  $('shortcutList').innerHTML = modelle.map(m => `<div class="sc-row">
      <span class="dot" style="background:${m.color}"></span>
      <div class="sc-name">${escapeHtml(m.label)}${m.kind === KIND_ORGASM
        // Die Warnung gilt dem Fehlgriff: eine Adresse trägt ohne Rückfrage
        // ein. Ein Ereignis, das nichts kostet, hat aber auch nichts zu warnen.
        ? (m.priceMax > 0 ? '<span class="sc-tag warn">kostet</span>' : '')
        : (imLauncher.has(m.id) ? '<span class="sc-tag">im Launcher</span>' : '')}${
        m.kind !== KIND_ORGASM && kurz[m.id] && kurz[m.id] !== m.id
          ? `<span class="sc-tag">Knopf ${escapeHtml(kurz[m.id])}</span>` : ''}</div>
      <code class="sc-url">${escapeHtml(commandUrl(m.id))}</code>
      <button class="btn ghost sc-copy" type="button"
              data-url="${escapeHtml(commandUrl(m.id))}">Kopieren</button>
    </div>`).join('');

  renderUhrBerechtigung();

  const beispiel = (modelle[0] && modelle[0].id) || 'HT';
  const basis = IS_WEB ? (location.origin + location.pathname) : WEB_APP_URL;
  $('shortcutHint').innerHTML = [
    IS_NATIVE
      ? `<b>Startbildschirm:</b> lang auf das App-Symbol — bis zu ${MAX_SHORTCUTS} Zustände liegen`
        + ' dort als Kurzbefehl. Ereignisse mit Preis bewusst nicht: ein Kurzbefehl fragt nicht nach.'
      : '<b>Startbildschirm:</b> die App legt aus den ersten Modellen selbst Kurzbefehle an'
        + ' (langer Druck auf das App-Symbol).',
    '<b>Uhr:</b> die Kachel der Galaxy Watch braucht keine dieser Adressen. Ohne Uhr-App'
      + ' löst eine Automations-App mit Wear-Begleiter (MacroDroid, Tasker) sie aus.',
    '<code>&amp;app=1</code> am Ende hält die App nach dem Eintrag offen. Im Browser: '
      + `<code>${escapeHtml(webCommandUrl(basis, beispiel))}</code>`,
  ].map(z => `<div style="margin-top:6px">${z}</div>`).join('');
}

/**
 * Die eine Berechtigung, die den Unterschied macht.
 *
 * Ohne „Über anderen Apps anzeigen" darf die App sich nach einem Kommando von
 * der Uhr nicht selbst öffnen; der Eintrag kommt dann als Benachrichtigung, die
 * man antippen muss. Das ist kein Fehler, aber man sieht es nirgends — und den
 * Schalter in den Systemeinstellungen zu finden ist eine Sucherei. Also: Zustand
 * hier anzeigen und direkt hinführen.
 */
function renderUhrBerechtigung() {
  const box = $('shortcutPerm');
  if (!box) return;
  overlayGranted().then(ok => {
    if (ok === null) { box.classList.add('hide'); return; }   // nicht das Telefon
    box.classList.remove('hide');
    box.classList.toggle('warn', !ok);
    box.innerHTML = ok
      ? '<span class="sc-state">✓ Die Uhr darf direkt eintragen</span>'
      : '<span class="sc-state"><b>Von der Uhr kommt erst eine Rückfrage.</b>'
        + ' Locked darf sich nicht selbst öffnen, deshalb kommt der Eintrag als'
        + ' Benachrichtigung zum Antippen. Ein Schalter behebt das.</span>'
        + '<button class="btn ghost" id="btnOverlay" type="button">Erlauben</button>';
  });
}

export function render() {
  renderAuth();
  renderOrdner();
  renderZusehen();
  renderShortcuts();

  // Mit OneDrive geht jede Änderung von selbst hoch — „In Datei speichern" ist
  // dann ein Knopf ohne Zweck.
  const angemeldet = isSignedIn();
  $('manuellBox').classList.toggle('hide', angemeldet);
  $('fsaHint').textContent = window.showOpenFilePicker
    ? 'Tipp: nach „Datei laden…" einmal die locked2.json auswählen — die Sitzung merkt sich die Datei zum direkten Schreiben.'
    : 'Dieser Browser kann nicht direkt schreiben: „In Datei speichern" lädt die Datei herunter.';

  const v = versionLabel();
  const commit = APP_COMMIT.startsWith('__') ? null : APP_COMMIT;
  $('versionInfo').innerHTML = `Locked v${escapeHtml(v)} · ${platformName()}`
    + (commit ? ` · <code>${escapeHtml(commit)}</code>` : '')
    + (calc().startedAt ? `<br>Punktekonto seit ${fmtDateShort(calc().startedAt)}` : '')
    + (STATE.data.legacy ? ` · Archiv bis ${fmtDateShort(STATE.data.legacy.bis)}` : '');
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
  // Reste der laufenden Datei: der Schalter fürs Mitschreiben und der gemerkte
  // Link. Ohne den Weg in der App bedeuten sie nichts mehr.
  try { for (const k of ALTE_SCHLUESSEL) localStorage.removeItem(k); } catch {}

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

  // Auch dieser Knopf entsteht beim Rendern neu.
  $('shortcutPerm').addEventListener('click', async (e) => {
    if (!e.target.closest || !e.target.closest('#btnOverlay')) return;
    const ok = await openOverlaySettings();
    if (!ok) { showToast('Einstellung nicht erreichbar', true); return; }
    showToast('Locked in der Liste einschalten, dann zurück');
  });

  // Die Liste wird bei jedem Rendern neu gebaut — der Zuhörer sitzt deshalb am
  // Behälter und nicht an den Knöpfen.
  $('shortcutList').addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('button[data-url]');
    if (!btn) return;
    await kopieren(btn.dataset.url, 'Adresse kopiert');
  });

  $('btnCloudFolder').addEventListener('click', async () => {
    try { await ordnerUebernehmen(); }
    catch (e) { console.error(e); showToast('Ordnerwechsel fehlgeschlagen: ' + (e.message || e), true); }
  });

  $('btnJetztFreigabeWeg').addEventListener('click', async () => {
    try { await freigabeZuruecknehmen(); }
    catch (e) { console.error(e); showToast('Zurücknehmen fehlgeschlagen: ' + (e.message || e), true); }
  });

  $('btnJetztSnapshot').addEventListener('click', async () => {
    try { await kopieren(momentaufnahmeLink(), 'Momentaufnahme kopiert'); }
    catch (e) { console.error(e); showToast('Momentaufnahme fehlgeschlagen', true); }
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
