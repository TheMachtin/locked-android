/**
 * Daten-Tab: Synchronisation, Dateien, Export, Umzug und Version.
 */

import { STATE, calc, setData, clearSyncBase, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtDateShort, escapeHtml } from './format.js';
import { AUTH, login, logout, isSignedIn } from '../sync/auth.js';
import {
  loadFromCloud, saveToCloud, fetchLegacyFile, sanityCheck,
  schreibeJetzt, jetztVeroeffentlichen, setJetztVeroeffentlichen, vergissJetztStand,
  erzeugeFreigabe, entferneFreigabe,
} from '../sync/onedrive.js';
import {
  cloudOrdner, setCloudOrdner, normalizeOrdner, datenPfad, jetztPfad,
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
  $('authRedirectInfo').innerHTML = AUTH.redirectUri
    ? `Redirect-URI dieser Installation: <code>${escapeHtml(AUTH.redirectUri)}</code>`
    : '';
  $('cloudPath').innerHTML = `Datei: <code>${escapeHtml(datenPfad())}</code>`;
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
    'Gilt für <code>locked2.json</code>, <code>jetzt.json</code> und die alte '
    + '<code>locked.json</code>. Die Dateien werden dabei <b>nicht</b> verschoben — '
    + 'erst in OneDrive umlegen, dann hier eintragen. Der Ordner gehört zu dieser '
    + 'Installation; an den anderen Geräten ist er getrennt zu setzen.';
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
// Die Momentaufnahme steht offen da — sie tut, was sie soll. Der Weg über eine
// laufende Datei ist gebaut und geprüft, führt über OneDrive aber ins Leere
// (siehe README); er liegt deshalb zugeklappt darunter statt gelöscht zu sein.
let liveOffen = false;

const LS_SHARE = 'locked_jetzt_share_v1';
// Die Kennung der von der App angelegten Freigabe — ohne sie ließe sie sich
// später nur noch in der OneDrive-Oberfläche zurücknehmen.
const LS_PERM  = 'locked_jetzt_perm_v1';

function shareUrl() {
  try { return localStorage.getItem(LS_SHARE) || ''; } catch { return ''; }
}
function setShareUrl(v) {
  try { localStorage.setItem(LS_SHARE, String(v || '').trim()); } catch (e) { console.warn(e); }
}
function permId() {
  try { return localStorage.getItem(LS_PERM) || ''; } catch { return ''; }
}
function setPermId(v) {
  try {
    if (v) localStorage.setItem(LS_PERM, String(v));
    else localStorage.removeItem(LS_PERM);
  } catch (e) { console.warn(e); }
}

/**
 * Freigabelink anlegen — mit allem, was davor nötig ist.
 *
 * Ein Link auf eine Datei, die es nicht gibt, wäre nichts wert: der Schalter
 * geht deshalb mit an und die Datei entsteht, bevor Graph gefragt wird. Das ist
 * der ganze Sinn des Knopfes — sonst bliebe die Reihenfolge beim Benutzer
 * hängen, und der einzige Hinweis darauf wäre eine Fehlermeldung.
 */
async function freigabeAnlegen() {
  if (!isSignedIn()) { showToast('Dafür erst mit Microsoft anmelden', true); return; }

  if (!jetztVeroeffentlichen()) setJetztVeroeffentlichen(true);
  // Den Änderungs-Vergleich absichtlich zurücksetzen: sonst hieße ein „false"
  // von schreibeJetzt() entweder „unverändert" oder „fehlgeschlagen", und der
  // Unterschied entschiede darüber, ob die Datei überhaupt da ist.
  vergissJetztStand();
  if (!await schreibeJetzt()) {
    throw new Error('jetzt.json ließ sich nicht schreiben — ohne sie gibt es nichts freizugeben');
  }

  const { url, permissionId } = await erzeugeFreigabe();
  setShareUrl(url);
  setPermId(permissionId);
  renderJetztKarte();
  showToast('Freigabelink erzeugt');
}

async function freigabeZuruecknehmen() {
  const id = permId();
  if (!id) return;
  if (!confirmAction('Die Freigabe zurücknehmen?\n\n'
    + 'Der Link hört danach auf zu funktionieren — auch bei denen, die ihn schon haben.')) return;
  await entferneFreigabe(id);
  setPermId('');
  setShareUrl('');
  renderJetztKarte();
  showToast('Freigabe zurückgenommen');
}

/** Die Adresse der Anzeigeseite — im Web neben der App, sonst die Web-Fassung. */
function ansichtBasis() {
  if (!IS_WEB) return WEB_APP_URL + 'jetzt.html';
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'jetzt.html';
}

function renderJetztKarte() {
  const an = jetztVeroeffentlichen();
  $('jetztAktiv').checked = an;
  const feld = $('jetztShareUrl');
  if (document.activeElement !== feld) feld.value = shareUrl();

  // „Zurücknehmen" nur, wenn es etwas zurückzunehmen gibt: eine von Hand in
  // OneDrive angelegte Freigabe kennt die App nicht und kann sie nicht lösen.
  $('btnJetztFreigabeWeg').classList.toggle('hide', !permId());
  $('btnJetztFreigabe').textContent = shareUrl() ? 'Freigabelink erneuern' : 'Freigabelink erzeugen';

  const teile = [];
  teile.push(`Datei: <code>${escapeHtml(jetztPfad())}</code>`);
  if (!isSignedIn()) {
    teile.push('<b>Ohne Anmeldung geht hier nichts</b> — weder Schreiben noch Freigeben.');
  } else if (!shareUrl()) {
    teile.push('<b>Freigabelink erzeugen</b> schaltet das Mitschreiben ein, legt die Datei an '
      + 'und holt den Anzeigen-Link von OneDrive — in einem Schritt.');
  } else {
    // Der Link ist gebaut und richtig; er scheitert am Abruf, nicht am Aufbau.
    // Das gehört hierher, sonst liest sich „Link kopieren" wie ein Angebot.
    teile.push('<b>Link kopieren</b> liefert die Ansicht-Adresse — die zeigt derzeit '
      + '<code>HTTP 401</code>, weil OneDrive die Datei nicht herausgibt. '
      + '<b>Diagnose-Link</b> misst das nach.');
    teile.push(`<code>${escapeHtml(ansichtLink())}</code>`);
    if (an) teile.push('<b>Der Schalter ist an</b> — die Datei wird bei jedem Speichern '
      + 'mitgeschrieben, obwohl sie derzeit niemand lesen kann. Ausschalten kostet nichts.');
    if (!permId()) {
      teile.push('Diesen Link kennt die App nur als Adresse. Zurücknehmen lässt er sich in OneDrive '
        + '(<b>Teilen → Zugriff verwalten</b>) — oder hier neu erzeugen lassen.');
    }
  }
  $('jetztHinweis').innerHTML = teile.map(z => `<div style="margin-top:6px">${z}</div>`).join('');
}

function ansichtLink() {
  return `${ansichtBasis()}#q=${encodeURIComponent(shareUrl())}`;
}

/**
 * Derselbe Link, aber im Prüfmodus.
 *
 * Ob OneDrive eine anonyme Freigabe überhaupt an fremdes JavaScript herausgibt,
 * lässt sich nur dort feststellen, wo die Verbindung besteht. Die Seite probiert
 * damit die Adressformen durch und schreibt hin, welche antwortet.
 */
function diagnoseLink() {
  return `${ansichtBasis()}#diag=${encodeURIComponent(shareUrl())}`;
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
    'Diese Adressen tragen beim Öffnen genau einen Eintrag ein — mit der aktuellen '
    + 'Uhrzeit, ohne Rückfrage. Sie funktionieren überall, wo sich eine URL hinterlegen '
    + 'lässt: Startbildschirm, Automations-App, Uhr.';

  $('shortcutList').innerHTML = modelle.map(m => `<div class="sc-row">
      <span class="dot" style="background:${m.color}"></span>
      <div class="sc-name">${escapeHtml(m.label)}${m.kind === KIND_ORGASM
        ? '<span class="sc-tag warn">kostet</span>'
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
  renderJetztKarte();
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
    // Das nächste Konto hat seine eigene Ablage — der gemerkte Stand der
    // jetzt.json gehörte zur vorigen.
    vergissJetztStand();
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

  $('jetztAktiv').addEventListener('change', async (e) => {
    const an = !!e.target.checked;
    setJetztVeroeffentlichen(an);
    renderJetztKarte();
    if (!an) { showToast('Wird nicht mehr geschrieben — die vorhandene Datei bleibt liegen'); return; }
    if (!isSignedIn()) { showToast('Gemerkt — geschrieben wird nach der Anmeldung'); return; }
    // Gleich anlegen: der Freigabelink lässt sich erst zu einer Datei erzeugen,
    // die es gibt.
    showToast(await schreibeJetzt() ? 'jetzt.json angelegt' : 'jetzt.json nicht geschrieben — Konsole prüfen',
      false);
  });

  $('jetztShareUrl').addEventListener('change', (e) => {
    setShareUrl(e.target.value);
    // Von Hand eingetragen heißt: nicht mehr die Freigabe, die die App kennt.
    // Die alte Kennung stehen zu lassen böte ein „Zurücknehmen" an, das etwas
    // anderes löste als das, was im Feld steht.
    setPermId('');
    renderJetztKarte();
    showToast(shareUrl() ? 'Freigabelink gemerkt' : 'Freigabelink entfernt');
  });

  $('btnJetztFreigabe').addEventListener('click', async () => {
    try { await freigabeAnlegen(); }
    catch (e) {
      console.error(e);
      // Die häufigste echte Absage: ein Geschäftskonto, dem die Verwaltung
      // anonyme Links verboten hat. Dann hilft nur der Weg über OneDrive.
      showToast('Freigabe fehlgeschlagen: ' + (e.message || e), true);
    }
  });

  $('btnJetztFreigabeWeg').addEventListener('click', async () => {
    try { await freigabeZuruecknehmen(); }
    catch (e) { console.error(e); showToast('Zurücknehmen fehlgeschlagen: ' + (e.message || e), true); }
  });

  $('btnJetztLink').addEventListener('click', async () => {
    if (!shareUrl()) { showToast('Erst den Freigabelink der jetzt.json eintragen', true); return; }
    await kopieren(ansichtLink(), 'Link zur Live-Ansicht kopiert');
  });

  $('jetztLiveToggle').addEventListener('click', () => {
    liveOffen = !liveOffen;
    $('jetztLiveSection').classList.toggle('hide', !liveOffen);
    $('jetztLiveToggle').textContent = liveOffen ? 'Laufende Datei ▴' : 'Laufende Datei ▾';
  });

  $('btnJetztDiagnose').addEventListener('click', async () => {
    if (!shareUrl()) { showToast('Erst den Freigabelink der jetzt.json eintragen', true); return; }
    await kopieren(diagnoseLink(), 'Diagnose-Link kopiert');
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
