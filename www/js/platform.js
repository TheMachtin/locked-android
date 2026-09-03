/**
 * Plattform-Unterschiede an einer Stelle.
 *
 * Derselbe `www/`-Ordner läuft in drei Hüllen: als Android-APK (Capacitor), als
 * Desktop-Programm (Electron) und als Web-App im Browser. Die Unterschiede sind
 * überschaubar — Dateiablage, Benachrichtigungen, Zurück-Taste, Update-Prüfung
 * und der Weg, auf dem der Microsoft-Token getauscht wird — und sie stehen alle
 * hier, statt sich durch die Oberfläche zu ziehen.
 */

import { registerPersister } from './state.js';

const CAP = () => (window.Capacitor && window.Capacitor.Plugins) || {};

export const IS_NATIVE = !!(window.Capacitor
  && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const IS_ELECTRON = !IS_NATIVE && !!window.locked && window.locked.platform === 'electron';
export const IS_WEB = !IS_NATIVE && !IS_ELECTRON;

export function platformName() {
  return IS_NATIVE ? 'Android' : (IS_ELECTRON ? 'Desktop' : 'Web');
}

export const RELEASE_REPO = 'TheMachtin/locked-android';
/** Die Web-Fassung — als Adresse für Kurzbefehle, die keine App voraussetzen. */
export const WEB_APP_URL = 'https://themachtin.github.io/locked-android/';

// =========================== DATEIABLAGE ===========================
// Android: eine echte Datei im app-privaten Speicher. Sie überlebt App-Updates,
// während der localStorage einer WebView jederzeit geräumt werden kann.
const NATIVE_FILE = 'locked2.json';
const NATIVE_DIR  = 'DATA';

async function persistNative(data) {
  const FS = CAP().Filesystem;
  if (!FS) return;
  try {
    await FS.writeFile({
      path: NATIVE_FILE, directory: NATIVE_DIR, encoding: 'utf8',
      data: JSON.stringify(data, null, 2),
    });
  } catch (e) { console.warn('Nativ speichern fehlgeschlagen', e); }
}

export async function loadNativeFile() {
  if (IS_NATIVE) {
    const FS = CAP().Filesystem;
    if (!FS) return null;
    try {
      const r = await FS.readFile({ path: NATIVE_FILE, directory: NATIVE_DIR, encoding: 'utf8' });
      const parsed = JSON.parse(r.data);
      if (parsed && (parsed.events || parsed.settings)) return parsed;
    } catch { /* gibt es noch nicht — kein Fehler */ }
    return null;
  }
  if (IS_ELECTRON && window.locked.readData) {
    try {
      const text = await window.locked.readData();
      return text ? JSON.parse(text) : null;
    } catch (e) { console.warn('Desktop-Datei nicht lesbar', e); return null; }
  }
  return null;
}

export function initPersistence() {
  if (IS_NATIVE) registerPersister(persistNative);
  else if (IS_ELECTRON && window.locked.writeData) {
    registerPersister(data => window.locked.writeData(JSON.stringify(data, null, 2)));
  }
}

// =========================== HTTP OHNE ORIGIN ===========================
/**
 * POST an den Microsoft-Token-Endpunkt.
 *
 * Aus einer WebView heraus schickt `fetch()` einen `Origin`-Header mit, den
 * Azure bei Redirect-URIs vom Typ „Mobile- und Desktopanwendungen" mit
 * AADSTS9002326 ablehnt. Android und Desktop tauschen deshalb über die native
 * Seite; nur die Web-App (echte SPA-Registrierung) darf direkt fetchen.
 */
export async function postForm(url, form) {
  const body = new URLSearchParams(form).toString();
  if (IS_NATIVE) {
    const Http = CAP().CapacitorHttp;
    if (!Http) throw new Error('CapacitorHttp nicht verfügbar');
    const res = await Http.request({
      url, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form,
    });
    const parsed = typeof res.data === 'string'
      ? (() => { try { return JSON.parse(res.data); } catch { return {}; } })()
      : (res.data || {});
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: parsed };
  }
  if (IS_ELECTRON && window.locked.postForm) {
    return window.locked.postForm(url, body);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const parsed = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: parsed };
}

// =========================== BROWSER ÖFFNEN ===========================
export async function openExternal(url) {
  if (IS_NATIVE && CAP().Browser) return CAP().Browser.open({ url });
  if (IS_ELECTRON && window.locked.openExternal) return window.locked.openExternal(url);
  window.open(url, '_blank', 'noopener');
}
export async function closeExternal() {
  try { if (IS_NATIVE && CAP().Browser) await CAP().Browser.close(); } catch {}
}

// =========================== BENACHRICHTIGUNGEN ===========================
export async function scheduleReminder(firstAt, text) {
  if (!IS_NATIVE) return;
  const LN = CAP().LocalNotifications;
  if (!LN) return;
  try {
    const perm = await LN.checkPermissions();
    if (perm.display !== 'granted') {
      const r = await LN.requestPermissions();
      if (r.display !== 'granted') return;
    }
    const existing = await LN.getPending();
    if (existing && existing.notifications && existing.notifications.length) {
      await LN.cancel({ notifications: existing.notifications.map(n => ({ id: n.id })) });
    }
    await LN.schedule({
      notifications: [{
        id: 1, title: 'Locked', body: text,
        schedule: { at: firstAt, repeats: true, every: 'day', allowWhileIdle: true },
      }],
    });
  } catch (e) { console.warn('Reminder konnte nicht gesetzt werden', e); }
}

/**
 * Eine Meldung, die sofort erscheint.
 *
 * Der Weg zurück ans Handgelenk: eine Benachrichtigung des Telefons steht auf
 * der Uhr. Ein Kommando, das von dort ausgelöst wurde, bestätigt sich damit
 * dort, wo es abgeschickt wurde — der Bildschirm des Telefons ist in dem Moment
 * niemandes Blickfeld.
 */
export async function notifyNow(text, id) {
  if (!IS_NATIVE) return false;
  const LN = CAP().LocalNotifications;
  if (!LN) return false;
  try {
    const perm = await LN.checkPermissions();
    if (perm.display !== 'granted') {
      const r = await LN.requestPermissions();
      if (r.display !== 'granted') return false;
    }
    await LN.schedule({ notifications: [{ id: id || 7001, title: 'Locked', body: text }] });
    return true;
  } catch (e) { console.warn('Meldung konnte nicht gezeigt werden', e); return false; }
}

// =========================== LAUNCHER-SHORTCUTS ===========================
/**
 * Die Kurzbefehle des Launchers setzen (langer Druck auf das App-Symbol).
 *
 * Sie kommen aus der Modell-Registry und nicht aus einer XML-Datei im Build:
 * Modelle sind Daten, ein neuer Käfig ist ein Eintrag und kein Release — das
 * gilt hier genauso wie für die Schnelltasten.
 *
 * @param {Array<{id,label,kurz,url,color}>} items
 */
export async function setLauncherShortcuts(items) {
  const S = CAP().Shortcuts;
  if (!IS_NATIVE || !S || !S.set) return false;
  try { await S.set({ items }); return true; }
  catch (e) { console.warn('Shortcuts konnten nicht gesetzt werden', e); return false; }
}

// =========================== UHR ===========================
/**
 * Modell-Registry und aktuellen Zustand an die Uhr geben.
 *
 * Der Datenkanal von Play Services hält das Element vor — die Uhr bekommt es
 * auch, wenn sie beim Ändern außer Reichweite war. Ohne Uhr-App passiert nichts;
 * das Element liegt dann eben ungelesen da.
 *
 * @param {string} json  fertig serialisiert (siehe core/command.js → watchPayload)
 */
export async function publishToWatch(json) {
  const W = CAP().WearBridge;
  if (!IS_NATIVE || !W || !W.publish) return false;
  try { await W.publish({ json }); return true; }
  catch (e) { console.warn('Uhr-Abgleich fehlgeschlagen', e); return false; }
}

// =========================== ZURÜCK-TASTE ===========================
/** Android-Zurück: erst eine Ebene zurück, dann in den Hintergrund. Ohne
 *  Listener beendet die Taste die App sofort. */
export function setupBackButton(onBack) {
  const App = CAP().App;
  if (!IS_NATIVE || !App || !App.addListener) return;
  App.addListener('backButton', () => { if (!onBack()) minimize(App); });
}
function minimize(App) {
  if (App.minimizeApp) App.minimizeApp();
  else if (App.exitApp) App.exitApp();
}

/**
 * Die App in den Hintergrund schicken.
 *
 * Für Kommandos von außen: wer am Handgelenk tippt, will das Telefon nicht
 * danach mit einer offenen App in der Tasche haben.
 */
export function minimizeApp() {
  const App = CAP().App;
  if (!IS_NATIVE || !App) return;
  minimize(App);
}

/** Die URL, mit der die App gestartet wurde — `null`, wenn sie normal geöffnet
 *  wurde. Ein Kaltstart über einen Shortcut kommt hier an, nicht über
 *  `onAppUrlOpen()`: den Listener gibt es beim Start noch nicht. */
export async function launchUrl() {
  const App = CAP().App;
  if (!IS_NATIVE || !App || !App.getLaunchUrl) return null;
  try {
    const r = await App.getLaunchUrl();
    return (r && r.url) || null;
  } catch { return null; }
}

/** Rücksprung aus dem System-Browser (locked://auth?...) */
export function onAppUrlOpen(handler) {
  const App = CAP().App;
  if (!IS_NATIVE || !App || !App.addListener) return;
  App.addListener('appUrlOpen', ev => handler(ev && ev.url));
}

/**
 * Rückkehr aus dem Hintergrund.
 *
 * `visibilitychange` feuert in der Android-WebView nicht überall zuverlässig,
 * Capacitor meldet den Wechsel dagegen sicher. Beide Wege sind angebunden; der
 * Aufrufer entprellt, damit die Doppelmeldung nichts kostet.
 */
export function onAppResume(handler) {
  const App = CAP().App;
  if (!IS_NATIVE || !App || !App.addListener) return;
  App.addListener('appStateChange', st => { if (st && st.isActive) handler(); });
}

// =========================== VERSION UND UPDATE ===========================
export const APP_VERSION = '__APP_VERSION__';
export const APP_COMMIT  = '__APP_COMMIT__';
export function versionLabel() {
  return APP_VERSION.startsWith('__') ? 'dev' : APP_VERSION;
}
function versionAsInt(v) {
  return String(v).replace(/^v/, '').split('.')
    .reduce((acc, part) => acc * 1000 + (parseInt(part, 10) || 0), 0);
}

/**
 * Neue Version im GitHub-Release?
 *
 * Nur für Android: die Prüfung endet in einem APK-Download. Der Desktop lässt
 * `electron-updater` im Hauptprozess arbeiten (siehe `onDesktopUpdate`), die
 * Web-App den Service Worker.
 */
export async function checkForAppUpdate() {
  if (!IS_NATIVE) return null;
  if (APP_VERSION.startsWith('__')) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const rel = await r.json();
    const latest = (rel.tag_name || '').replace(/^v/, '');
    if (!latest || versionAsInt(latest) <= versionAsInt(APP_VERSION)) return null;
    const apk = (rel.assets || []).find(a => a.name.toLowerCase().endsWith('.apk'));
    return { version: latest, url: apk ? apk.browser_download_url : rel.html_url };
  } catch (e) { console.warn('Update-Prüfung fehlgeschlagen', e); return null; }
}

/**
 * Update-Meldungen der Desktop-Hülle abonnieren.
 * Ereignisse: `available` · `progress` (percent) · `ready` (version) · `error`.
 * Auf Android und im Browser passiert nichts — dort gibt es andere Wege.
 */
export function onDesktopUpdate(handler) {
  if (!IS_ELECTRON || !window.locked.onUpdate) return;
  window.locked.onUpdate(handler);
}

/** Das geladene Desktop-Update installieren; die App startet dabei neu. */
export function installDesktopUpdate() {
  if (IS_ELECTRON && window.locked.installUpdate) return window.locked.installUpdate();
}

/** APK herunterladen und den Installer öffnen. */
export async function downloadAndInstallApk(url, version, onProgress) {
  const FS = CAP().Filesystem;
  const AppInstaller = CAP().AppInstaller;
  if (!FS || !AppInstaller) throw new Error('Update-Plugin fehlt');
  const filename = `locked-${String(version || 'update').replace(/[^0-9.]/g, '')}.apk`;
  let sub = null;
  try {
    let path;
    if (typeof FS.downloadFile === 'function') {
      // Nativer Download statt fetch(): GitHub liefert beim Release-Asset keine
      // CORS-Header, ein fetch() aus der WebView scheitert sofort.
      if (typeof FS.addListener === 'function' && onProgress) {
        sub = await FS.addListener('progress', p => {
          if (p && p.contentLength > 0) onProgress(p.bytes / p.contentLength);
        });
      }
      const r = await FS.downloadFile({ url, path: filename, directory: 'CACHE', progress: true });
      path = r && (r.path || r.uri);
      if (!path) throw new Error('Download lieferte keinen Dateipfad');
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1]);
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      });
      const w = await FS.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      path = w.uri;
    }
    await AppInstaller.installApk({ path });
  } finally {
    if (sub && typeof sub.remove === 'function') { try { await sub.remove(); } catch {} }
  }
}
