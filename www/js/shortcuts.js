/**
 * Kommandos ausführen und Kurzbefehle bereitstellen.
 *
 * Was ein Kommando *bedeutet*, steht in `core/command.js`; hier steht, was
 * daraufhin passiert: eintragen, speichern, melden — und zurück in den
 * Hintergrund. Die Reihenfolge ist der eigentliche Inhalt dieser Datei.
 *
 * Drei Wege führen herein, alle mit derselben Anweisung:
 *
 *   Kaltstart      der Shortcut startet die App; die URL steht in `launchUrl()`
 *   App läuft      Android reicht sie über `appUrlOpen` nach
 *   Web/Desktop    `?log=…` in der Adresse der Seite
 *
 * Gespeichert wird *bevor* die App sich verabschiedet. Eine Automation löst aus,
 * während das Telefon in der Tasche liegt — wer erst beim nächsten Öffnen
 * synchronisiert, hat den Eintrag am PC eine halbe Stunde später immer noch
 * nicht.
 */

import { STATE, calc, mutate, subscribe, settings as getSettings } from './state.js';
import { showToast } from './ui/toast.js';
import { fmtInt } from './ui/format.js';
import { KIND_ORGASM } from './core/settings.js';
import {
  parseCommand, planCommand, shortcutModels, commandUrl, kuerzelMap, watchPayload,
  CMD_PARAM, CMD_PARAMS, MAX_SHORTCUTS, MAX_TILE_BUTTONS,
} from './core/command.js';
import {
  IS_NATIVE, onAppUrlOpen, launchUrl, minimizeApp, notifyNow, setLauncherShortcuts,
  publishToWatch, confirmToWatch,
} from './platform.js';
import { autosave } from './sync/onedrive.js';

let onNachEintrag = () => {};
export function setEntryHook(fn) { onNachEintrag = fn; }

// Derselbe Start kann auf zwei Wegen ankommen (Launch-URL *und* appUrlOpen,
// je nach Android-Fassung). Der Dublettenschutz in planCommand() fängt den
// doppelten Eintrag ab; dieses Fenster verhindert zusätzlich die doppelte
// Meldung.
const WIEDERHOLFENSTER_MS = 4000;
let zuletzt = { url: null, ms: 0 };

// =========================== SICHTBARKEIT ===========================
/**
 * Seit wann die App ununterbrochen sichtbar ist — 0, wenn gerade nicht.
 *
 * Ein Kommando von der Uhr weckt die App aus dem Hintergrund und soll sie
 * danach dorthin zurückschicken (`minimizeApp()`). Lief sie aber schon eine
 * Weile im Vordergrund — man sieht sich gerade das Dashboard an —, wäre genau
 * dasselbe Minimieren ein Rauswurf aus der eigenen Nutzung. Die Uhr weckt die
 * Activity in beiden Fällen kurz auf; `document.visibilityState` allein
 * unterscheidet die Fälle deshalb nicht zuverlässig, ihre *Dauer* schon: ein
 * Kommando, das die App gerade erst geweckt hat, trifft auf `sichtbarSeitMs`
 * von vor einem Wimpernschlag, ein Kommando während laufender Nutzung auf
 * einen deutlich älteren Zeitstempel.
 */
let sichtbarSeitMs = 0;
const BEREITS_OFFEN_MS = 1200;

function trackSichtbarkeit() {
  if (typeof document === 'undefined') return;
  const aktualisieren = () => {
    if (document.visibilityState === 'visible') { if (!sichtbarSeitMs) sichtbarSeitMs = Date.now(); }
    else sichtbarSeitMs = 0;
  };
  aktualisieren();
  document.addEventListener('visibilitychange', aktualisieren);
}

/** War die App schon eine Weile offen, bevor dieses Kommando ankam? */
function warBereitsOffen() {
  return sichtbarSeitMs > 0 && (Date.now() - sichtbarSeitMs) > BEREITS_OFFEN_MS;
}

/**
 * Ein Kommando ausführen.
 * @returns {Promise<boolean>} ob die URL überhaupt eins war
 */
export async function runCommand(url) {
  const cmd = parseCommand(url);
  if (!cmd) return false;

  const jetzt = Date.now();
  if (zuletzt.url === url && jetzt - zuletzt.ms < WIEDERHOLFENSTER_MS) return true;
  zuletzt = { url, ms: jetzt };

  const s = getSettings();
  const plan = planCommand(STATE.data, s, cmd);
  if (!plan.ok) {
    showToast(plan.fehler, true);
    await notifyNow(plan.fehler);
    return true;
  }
  if (plan.doppelt) {
    showToast(plan.meldung);
    // Steht schon: für die Uhr ist das erledigt wie ein neuer Eintrag. Sonst
    // schickte sie denselben Tipp bis in alle Ewigkeit erneut.
    await confirmToWatch(cmd.uhr);
    await abschluss(plan.meldung, cmd);
    return true;
  }

  mutate(data => {
    data.events.push(plan.event);
    data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, { save: false });

  const meldung = plan.model.kind === KIND_ORGASM ? mitPreis(plan) : plan.meldung;
  showToast(meldung, plan.model.kind === KIND_ORGASM);
  // Abgewartet, nicht nebenbei: der Haken stellt die Inaktivitäts-Erinnerung neu
  // und räumt dabei wartende Benachrichtigungen weg. Die Bestätigung unten darf
  // nicht in dieses Aufräumen geraten.
  try { await onNachEintrag(); } catch (e) { console.warn('Nach-Eintrag-Haken', e); }

  // Erst speichern, dann verabschieden — in dieser Reihenfolge, sonst schließt
  // sich die App über einer laufenden Übertragung.
  try { await autosave(); } catch (e) { console.error('Speichern nach Kommando fehlgeschlagen', e); }
  // Jetzt steht der Eintrag: die Uhr darf ihn vergessen. Vorher nicht — bis
  // hierher hätte jeder Abbruch ihn verloren, und sie ist die einzige Stelle,
  // die ihn dann noch hätte.
  await confirmToWatch(cmd.uhr);
  await abschluss(meldung, cmd);
  return true;
}

/** Der Preis gehört in die Bestätigung: er ist die Zahl, die das Ereignis kostet. */
function mitPreis(plan) {
  const tag = calc().byDate[plan.event.date];
  const treffer = tag && tag.orgasmen
    && tag.orgasmen.find(o => o.event.time === plan.event.time && o.event.type === plan.event.type);
  return treffer
    ? `${plan.model.label} ${plan.event.time} · −${fmtInt(treffer.price)} Punkte`
    : plan.meldung;
}

/**
 * Melden und aus dem Weg gehen.
 *
 * Die Benachrichtigung ist nicht Zierrat: sie ist auf Android der einzige Weg,
 * eine Bestätigung an die Uhr zu bringen. `app=1` in der URL hält die App
 * stattdessen offen — für den Fall, dass man doch gleich weiterarbeiten will.
 */
async function abschluss(meldung, cmd) {
  await notifyNow(meldung);
  // Wer gerade in der App war, soll drinbleiben — nur ein Kommando, das sie
  // erst geweckt hat, schickt sie zurück, wo sie herkam.
  if (IS_NATIVE && !cmd.zeigen && !warBereitsOffen()) minimizeApp();
}

// =========================== KURZBEFEHLE UND UHR ===========================
let letzterLauncher = '';
let letzteUhr = '';

/**
 * Startbildschirm und Uhr der Registry nachziehen.
 *
 * Beides hängt am selben Auslöser (jede Änderung am Zustand), aber an
 * getrennten Merkern: die Launcher-Liste ändert sich nur, wenn ein Modell
 * dazukommt oder umbenannt wird — die Uhr auch dann, wenn ein Eintrag den
 * getragenen Zustand ändert. Ein gemeinsamer Merker würde entweder die eine
 * Seite verschlafen oder die andere unnötig neu setzen.
 */
export function syncGeraete(settings) {
  if (!IS_NATIVE) return;
  syncLauncherShortcuts(settings);
  syncUhr(settings);
}

/** Die Kurzbefehle des Launchers der Registry nachziehen. */
export function syncLauncherShortcuts(settings) {
  if (!IS_NATIVE) return;
  const liste = shortcutModels(settings, MAX_SHORTCUTS);
  // Das Kürzel gehört zur Kennung: eine Umbenennung anderswo in der Registry kann
  // ein Kürzel hier verschieben, ohne dass sich an dieser Liste sonst etwas ändert.
  const kurz = kuerzelMap(settings);
  const kennung = JSON.stringify(liste.map(m => [m.id, m.label, m.color, kurz[m.id]]));
  if (kennung === letzterLauncher) return;
  letzterLauncher = kennung;
  setLauncherShortcuts(liste.map(m => ({
    id: m.id,
    label: m.label,
    kurz: m.label.length > 12 ? m.label.slice(0, 11) + '…' : m.label,
    initialen: kurz[m.id] || '',
    url: commandUrl(m.id),
    color: m.color,
  })));
}

/** Registry und aktuellen Zustand an die Uhr geben. */
function syncUhr(settings) {
  const json = JSON.stringify(watchPayload(STATE.data, settings, MAX_TILE_BUTTONS));
  // Der Inhalt *ist* der Merker: was gleich bleibt, muss nicht gesendet werden.
  if (json === letzteUhr) return;
  letzteUhr = json;
  publishToWatch(json);
}

// =========================== AUFBAU ===========================
/**
 * Anbinden. Wird aus `main.js` aufgerufen, *nachdem* der Cloud-Stand geladen
 * ist: ein Kommando schreibt sofort und soll nicht gegen einen veralteten Stand
 * laufen.
 */
export async function initShortcuts() {
  trackSichtbarkeit();
  onAppUrlOpen(url => {
    runCommand(url).catch(e => console.error('Kommando fehlgeschlagen', e));
  });

  syncGeraete(getSettings());
  subscribe(() => syncGeraete(getSettings()));

  // Web und Desktop: der Befehl steht in der Adresse. Danach wird er entfernt —
  // sonst trüge ein Neuladen (oder ein Lesezeichen auf die aktuelle Seite) ihn
  // ein zweites Mal ein.
  if (!IS_NATIVE && typeof location !== 'undefined' && location.search.includes(CMD_PARAM + '=')) {
    const adresse = location.href;
    if (parseCommand(adresse)) {
      const sauber = new URL(adresse);
      for (const name of CMD_PARAMS) sauber.searchParams.delete(name);
      history.replaceState(null, '', sauber.pathname + sauber.search + sauber.hash);
      await runCommand(adresse);
    }
  }

  const start = await launchUrl();
  if (start) await runCommand(start);
}
