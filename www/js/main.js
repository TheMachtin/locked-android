/**
 * Zusammenbau: Tabs, Start, Timer, Plattform-Anbindung.
 *
 * Hier steht nur die Verdrahtung. Was gerechnet wird, steht in core/; wie es
 * aussieht, in ui/; wo es herkommt, in sync/ und platform.js.
 */

import {
  STATE, subscribe, loadLocal, loadSyncBase, setData, registerSaver, notify,
} from './state.js';
import { showToast } from './ui/toast.js';
import { escapeHtml } from './ui/format.js';
import * as eintrag from './ui/eintrag.js';
import * as dashboard from './ui/dashboard.js';
import * as einstellungen from './ui/einstellungen.js';
import * as daten from './ui/daten.js';
import { initAuth, setAuthHandlers, isSignedIn, AUTH } from './sync/auth.js';
import { loadFromCloud, autosave, setSaveStateHandler } from './sync/onedrive.js';
import {
  refresh, lastSyncAt, isRefreshing, markSynced, setRefreshStateHandler,
} from './sync/refresh.js';
import { initPullToRefresh } from './ui/pull.js';
import { pad2 } from './core/time.js';
import { lastRealInteractionMs } from './core/escalation.js';
import { settings as getSettings } from './state.js';
import {
  IS_NATIVE, IS_ELECTRON, initPersistence, loadNativeFile, setupBackButton,
  scheduleReminder, checkForAppUpdate, downloadAndInstallApk,
  onDesktopUpdate, installDesktopUpdate, onAppResume,
} from './platform.js';

const $ = id => document.getElementById(id);
const TABS = ['eintrag', 'dashboard', 'einstellungen', 'daten'];
let aktiverTab = 'eintrag';

// =========================== TABS ===========================
function switchTab(name) {
  if (!TABS.includes(name)) return;
  aktiverTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  for (const t of TABS) $('page-' + t).classList.toggle('hide', t !== name);
  $('savebar').classList.toggle('hide', name !== 'eintrag');
  renderAktiv();
  window.scrollTo({ top: 0 });
}

/** Nur die sichtbare Seite neu zeichnen — das Dashboard rechnet die ganze
 *  Historie durch und muss nicht mitlaufen, während man Einträge tippt. */
function renderAktiv() {
  try {
    if (aktiverTab === 'eintrag') eintrag.render();
    else if (aktiverTab === 'dashboard') dashboard.render();
    else if (aktiverTab === 'einstellungen') einstellungen.render();
    else daten.render();
    updateMeta();
  } catch (e) {
    console.error('Render fehlgeschlagen', e);
    showToast('Anzeige-Fehler — Konsole prüfen', true);
  }
}

// =========================== KOPFZEILE ===========================
let saveState = 'idle';

/**
 * Wann zuletzt abgeglichen wurde — als Uhrzeit, nicht als „vor 5 Minuten".
 * Eine absolute Zeit muss nicht mitticken und lässt sich mit dem eigenen
 * Gefühl abgleichen: „ich war um zwei am PC" beantwortet die Frage sofort.
 */
function abgleichLabel() {
  const ms = lastSyncAt();
  if (!ms) return AUTH.account.username || 'angemeldet';
  const d = new Date(ms);
  const uhr = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const heute = d.toDateString() === new Date().toDateString();
  return heute ? `abgeglichen ${uhr}` : `abgeglichen ${d.getDate()}.${d.getMonth() + 1}. ${uhr}`;
}

function updateRefreshBtn() {
  const b = $('refreshBtn');
  if (!b) return;
  b.classList.toggle('laedt', isRefreshing());
  b.disabled = isRefreshing();
}

function updateMeta() {
  const el = $('meta');
  let txt;
  if (isSignedIn()) {
    txt = isRefreshing() ? 'gleiche ab…'
      : saveState === 'saving' ? 'speichere…'
      : saveState === 'saved' ? '✓ gespeichert'
      : saveState === 'error' ? '⚠ Fehler'
      : abgleichLabel();
  } else if (STATE.fileHandle) {
    txt = `${STATE.fileHandle.name}${STATE.dirty ? ' •' : ''}`;
  } else {
    const n = (STATE.data.events || []).length;
    txt = n ? `${n} Einträge${STATE.dirty ? ' •' : ''}` : 'keine Datei';
  }
  el.textContent = txt;
}

setRefreshStateHandler(() => { updateRefreshBtn(); updateMeta(); });

setSaveStateHandler((zustand) => {
  saveState = zustand;
  updateMeta();
  if (zustand === 'saved') {
    setTimeout(() => { if (saveState === 'saved') { saveState = 'idle'; updateMeta(); } }, 1500);
  }
});

// =========================== ABGLEICH ===========================
/** Cloud-Stand laden und den Zeitpunkt merken — außer das Laden ging schief. */
async function ladenUndMerken() {
  const r = await loadFromCloud({ silent: true, onMessage: (m, bad) => showToast(m, bad) });
  if (!r || !r.fehler) markSynced();
  return r;
}

/**
 * Rückkehr in den Vordergrund.
 *
 * Die Lücke, die man am Handy nicht sieht: die App war „ja schon offen", also
 * lief kein Start-Load — und zeigte den Stand von vorhin, während am PC längst
 * etwas eingetragen war. Der Mindestabstand hält kurzes Wegtippen davon ab,
 * jedes Mal Funkverkehr auszulösen. Still ist nur das „alles aktuell"; was
 * hereinkommt, wird auch hier gemeldet.
 */
const RUECKKEHR_MIN_MS = 30000;
function refreshBeiRueckkehr() {
  if (!isSignedIn() || document.visibilityState === 'hidden') return;
  const zuletzt = lastSyncAt();
  if (zuletzt && Date.now() - zuletzt < RUECKKEHR_MIN_MS) return;
  refresh({ silent: true });
}

// =========================== BENACHRICHTIGUNGEN ===========================
async function reminderNeu() {
  if (!IS_NATIVE) return;
  const s = getSettings();
  const lastMs = lastRealInteractionMs(STATE.data.events);
  if (!lastMs) return;
  const erst = new Date(lastMs + s.rules.inactivityReminderDays * 86400000);
  if (erst.getTime() < Date.now()) {
    const t = new Date();
    t.setHours(8, 0, 0, 0);
    if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1);
    erst.setTime(t.getTime());
  }
  await scheduleReminder(erst, `Zeit für einen Eintrag — ab Tag ${s.rules.inactivityAutoDays} schlägt die App fehlende vor.`);
}

// =========================== UPDATE-BANNER ===========================
function zeigeBanner(id, html, onClick) {
  let b = $(id);
  if (b) return b;
  b = document.createElement('div');
  b.id = id;
  b.className = 'update-banner';
  b.innerHTML = html;
  document.body.appendChild(b);
  const btn = b.querySelector('button');
  if (btn && onClick) btn.addEventListener('click', () => onClick(btn, b));
  return b;
}

async function pruefeAppUpdate() {
  const neu = await checkForAppUpdate();
  if (!neu) return;
  zeigeBanner('appUpdateBanner',
    `<span class="msg">Neue App-Version <b>${escapeHtml(neu.version)}</b> verfügbar</span>`
    + `<button type="button" class="btn primary" style="padding:8px 14px">Installieren</button>`,
    async (btn, banner) => {
      try {
        btn.textContent = 'Lade…';
        await downloadAndInstallApk(neu.url, neu.version, p => { btn.textContent = `Lade ${Math.round(p * 100)} %`; });
        btn.textContent = 'OK';
      } catch (e) {
        console.error('Update fehlgeschlagen', e);
        banner.querySelector('.msg').innerHTML =
          `<b>Update fehlgeschlagen</b><br><span style="font-size:12px;color:var(--muted)">${escapeHtml(e.message || e)}</span>`;
        btn.textContent = 'Erneut versuchen';
      }
    });
}

/**
 * Desktop-Update: der Hauptprozess lädt im Hintergrund und meldet sich hier.
 * Installiert wird erst auf Klick — ein Neustart mitten im Eintippen wäre eine
 * unangenehme Überraschung.
 */
function initDesktopUpdates() {
  onDesktopUpdate(ev => {
    if (ev.kind === 'error') { console.warn('Update:', ev.message); return; }
    if (ev.kind === 'available') {
      zeigeBanner('desktopUpdateBanner',
        `<span class="msg">Neue Version <b>${escapeHtml(ev.version || '')}</b> wird geladen…</span>`);
      return;
    }
    if (ev.kind === 'progress') {
      const b = $('desktopUpdateBanner');
      const msg = b && b.querySelector('.msg');
      if (msg) msg.innerHTML = `Neue Version wird geladen… <b>${ev.percent} %</b>`;
      return;
    }
    if (ev.kind === 'ready') {
      const b = $('desktopUpdateBanner');
      if (b) b.remove();
      zeigeBanner('desktopUpdateBanner',
        `<span class="msg">Version <b>${escapeHtml(ev.version || '')}</b> ist bereit</span>`
        + '<button class="btn primary" type="button" style="padding:8px 14px">Neu starten</button>',
        (btn) => { btn.textContent = 'Starte neu…'; installDesktopUpdate(); });
    }
  });
}

function initServiceWorker() {
  if (IS_NATIVE || IS_ELECTRON || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          zeigeBanner('swBanner',
            '<span class="msg">Neue Version verfügbar</span><button class="btn primary" type="button">Aktualisieren</button>',
            () => sw.postMessage('skipWaiting'));
        }
      });
    });
  }).catch(e => console.warn('Service Worker nicht registriert', e));

  let laedtNeu = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (laedtNeu) return;
    laedtNeu = true;
    window.location.reload();
  });
}

// =========================== START ===========================
function initTabs() {
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));
}

async function start() {
  initPersistence();
  registerSaver(autosave);
  setAuthHandlers({
    change: () => { daten.renderAuth(); updateMeta(); },
    signedIn: async () => { await ladenUndMerken(); },
  });

  loadLocal();
  loadSyncBase();
  initTabs();
  eintrag.initEintrag();
  eintrag.setEntryHook(reminderNeu);
  dashboard.initDashboard();
  dashboard.setDrilldownHandler(iso => { eintrag.setDate(iso); switchTab('eintrag'); });
  einstellungen.initEinstellungen();
  daten.initDaten();
  subscribe(renderAktiv);

  $('savebar').classList.remove('hide');
  renderAktiv();

  // Nativer Speicher schlägt den localStorage-Cache: er überlebt ein Räumen
  // der WebView-Daten.
  const nativ = await loadNativeFile();
  if (nativ) { setData(nativ); STATE.dirty = false; }

  await initAuth();
  if (isSignedIn()) await ladenUndMerken();

  setupBackButton(() => {
    if (aktiverTab !== 'eintrag') { switchTab('eintrag'); return true; }
    if (window.scrollY > 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    return false;
  });
  initServiceWorker();
  initDesktopUpdates();
  pruefeAppUpdate();
  reminderNeu();

  // Laufende Zähler (Regen-Countdown, Stunden, „jetzt"-Marke) jede Minute.
  setInterval(() => { if (aktiverTab === 'eintrag') eintrag.render(); }, 60000);

  // Drei Wege in den Vordergrund: Capacitor meldet es nativ am sichersten,
  // `visibilitychange` deckt PWA und WebView ab, `focus` den Desktop. Der
  // Mindestabstand in refreshBeiRueckkehr macht die Überschneidung folgenlos.
  onAppResume(refreshBeiRueckkehr);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBeiRueckkehr();
  });
  window.addEventListener('focus', refreshBeiRueckkehr);

  // Ohne OneDrive gibt es nichts zu holen — dann bleibt die Geste aus, statt
  // jedes Hochziehen mit derselben Fehlermeldung zu beantworten. Der Knopf in
  // der Kopfzeile sagt in dem Fall, warum.
  initPullToRefresh({ onRefresh: () => refresh(), kannZiehen: isSignedIn });

  updateRefreshBtn();

  window.addEventListener('online', () => {
    if (STATE.dirty && isSignedIn()) { showToast('Wieder online — speichere…'); autosave(); }
  });
  window.addEventListener('offline', () => showToast('Offline — Änderungen bleiben lokal gemerkt'));
}

$('refreshBtn').addEventListener('click', () => { refresh(); });

$('quickSave').addEventListener('click', async () => {
  try {
    if (isSignedIn()) { const { saveToCloud } = await import('./sync/onedrive.js'); await saveToCloud(); showToast('In OneDrive gespeichert'); }
    else { const { saveFile } = await import('./sync/files.js'); const r = await saveFile(); showToast(r.method === 'fsa' ? 'Gespeichert' : 'Heruntergeladen'); }
    notify();
  } catch (e) { console.error(e); showToast('Fehler beim Speichern', true); }
});

start().catch(e => {
  console.error('Start fehlgeschlagen', e);
  showToast('Start fehlgeschlagen — Konsole prüfen', true);
});
