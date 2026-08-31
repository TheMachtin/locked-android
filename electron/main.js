/**
 * Desktop-Hülle (Electron).
 *
 * Sie lädt denselben `www/`-Ordner wie APK und Web-App und ergänzt nur, was ein
 * Browser nicht kann: eine Datei neben der Konfiguration, den Microsoft-Login
 * über einen Loopback-Port und die Fenstergröße über Neustarts hinweg.
 *
 * Ausgeliefert wird über ein eigenes `app://`-Schema statt über `file://`.
 * ES-Module unterliegen unter `file://` der Same-Origin-Regel und würden
 * blockiert; außerdem braucht `localStorage` eine echte Herkunft, sonst wäre
 * der lokale Zwischenspeicher nach jedem Start leer.
 */

import { app, BrowserWindow, shell, ipcMain, net, protocol } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(__dirname, '..', 'www');
const ORIGIN = 'app://locked';

const datenDatei = () => path.join(app.getPath('userData'), 'locked2.json');
const fensterDatei = () => path.join(app.getPath('userData'), 'fenster.json');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

// =========================== FENSTER ===========================
async function ladeFensterZustand() {
  try { return JSON.parse(await readFile(fensterDatei(), 'utf8')); }
  catch { return { width: 1100, height: 900 }; }
}
async function merkeFensterZustand(win) {
  if (win.isDestroyed()) return;
  const b = win.getBounds();
  try {
    await writeFile(fensterDatei(), JSON.stringify({ ...b, maximized: win.isMaximized() }), 'utf8');
  } catch {}
}

async function erstelleFenster() {
  const z = await ladeFensterZustand();
  const win = new BrowserWindow({
    width: z.width, height: z.height, x: z.x, y: z.y,
    minWidth: 420, minHeight: 560,
    backgroundColor: '#2b241b',
    title: 'Locked',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (z.maximized) win.maximize();

  // Links nach draußen gehören in den Systembrowser, nicht in dieses Fenster —
  // sonst könnte eine fremde Seite in einer App laufen, die OneDrive-Token hält.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); shell.openExternal(url); }
  });

  let merkTimer = null;
  const merken = () => { clearTimeout(merkTimer); merkTimer = setTimeout(() => merkeFensterZustand(win), 400); };
  win.on('resize', merken);
  win.on('move', merken);
  win.on('close', () => merkeFensterZustand(win));

  await win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

// =========================== DATEIAUSLIEFERUNG ===========================
function registriereProtokoll() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pfad = decodeURIComponent(url.pathname);
    if (!pfad || pfad === '/') pfad = '/index.html';
    // Pfadtraversal ausschließen: alles muss unter www/ bleiben.
    const ziel = path.normalize(path.join(WWW, pfad));
    if (!ziel.startsWith(WWW)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(ziel).toString());
  });
}

// =========================== MICROSOFT-LOGIN ===========================
// Der Auth-Code kommt über einen kurzlebigen Server auf 127.0.0.1 zurück. In
// Azure genügt dafür der Eintrag "http://localhost" unter "Mobile- und
// Desktopanwendungen" — beliebige Ports sind dort ausdrücklich erlaubt.
let authServer = null;
let authAufloesen = null;
// Puffer für den Fall, dass der Rücksprung schneller da ist als der Aufruf, der
// auf ihn wartet. Ohne ihn wäre die Anmeldung ein Rennen, das man verlieren kann.
let authErgebnis = null;

function beendeAuthServer() {
  if (authServer) { try { authServer.close(); } catch {} authServer = null; }
}

const ANTWORT_SEITE = (titel, text) => `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${titel}</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#2b241b;color:#f3ead9;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
div{max-width:32rem;padding:2rem}h1{font-size:1.25rem;color:#84cc16}</style></head>
<body><div><h1>${titel}</h1><p>${text}</p></div></body></html>`;

function starteAuthServer() {
  return new Promise((resolve, reject) => {
    beendeAuthServer();
    authServer = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const params = Object.fromEntries(url.searchParams);
      const fehler = !!params.error;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fehler
        ? ANTWORT_SEITE('Anmeldung fehlgeschlagen', params.error_description || params.error)
        : ANTWORT_SEITE('Angemeldet', 'Du kannst dieses Fenster schließen und zu Locked zurückkehren.'));
      if (authAufloesen) { authAufloesen(params); authAufloesen = null; }
      else authErgebnis = params;
      setTimeout(beendeAuthServer, 500);
    });
    authServer.on('error', reject);
    // Port 0 = das Betriebssystem sucht einen freien.
    authServer.listen(0, '127.0.0.1', () => {
      resolve(`http://localhost:${authServer.address().port}/`);
    });
  });
}

// =========================== IPC ===========================
function registriereIpc() {
  ipcMain.handle('auth:begin', async () => {
    authErgebnis = null;
    return { redirectUri: await starteAuthServer() };
  });

  ipcMain.handle('auth:await', () => new Promise((resolve) => {
    if (authErgebnis) { const p = authErgebnis; authErgebnis = null; resolve(p); return; }
    authAufloesen = resolve;
    // Wer den Browser wegklickt, soll nicht ewig auf ein Versprechen warten.
    setTimeout(() => {
      if (authAufloesen === resolve) {
        authAufloesen = null;
        beendeAuthServer();
        resolve({ error: 'timeout', error_description: 'Zeitüberschreitung — Anmeldung abgebrochen.' });
      }
    }, 5 * 60 * 1000);
  }));

  /** Token-Tausch über Node: ein fetch() aus dem Fenster schickte einen
   *  Origin-Header mit, den Azure bei Desktop-Redirect-URIs ablehnt. */
  ipcMain.handle('http:postForm', async (_e, url, body) => {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = { error: 'unparseable', error_description: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, body: parsed };
  });

  ipcMain.handle('data:read', async () => {
    try { return await readFile(datenDatei(), 'utf8'); }
    catch { return null; }
  });
  ipcMain.handle('data:write', async (_e, text) => {
    await mkdir(path.dirname(datenDatei()), { recursive: true });
    await writeFile(datenDatei(), text, 'utf8');
    return true;
  });
  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:version', () => app.getVersion());
}

// =========================== START ===========================
// Zwei Instanzen schrieben abwechselnd dieselbe Datei — die zweite reicht ihren
// Start an die erste weiter und beendet sich.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    registriereProtokoll();
    registriereIpc();
    await erstelleFenster();
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await erstelleFenster();
    });
  });

  app.on('window-all-closed', () => {
    beendeAuthServer();
    if (process.platform !== 'darwin') app.quit();
  });
}
