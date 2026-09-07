/**
 * Die Live-Ansicht: derselbe „Jetzt"-Block, nur zum Zusehen.
 *
 * Diese Seite hat keinen Token, keine Anmeldung und keinen Schreibweg. Sie
 * *kann* nichts ändern — das ist keine Einstellung, die jemand umlegen könnte,
 * sondern eine Eigenschaft des Aufbaus. Was sie zeigt, steht in einer kleinen
 * abgeleiteten Datei, die nur den Block enthält: keine Ereignisse, keine
 * Einstellungen, keine Punkte.
 *
 * Zwei Quellen, ein Renderer:
 *
 *   #q=<Adresse>   laufende Datei — neue Einträge erscheinen beim nächsten Holen
 *   #d=<Paket>     Momentaufnahme im Link — die Uhren laufen, der Rest steht
 *
 * Zwischen zwei Abrufen bleibt die Anzeige richtig, weil der Block aus
 * Zeitstempeln gerechnet wird: die Stunden zählen weiter, der Preis fällt.
 */

import { istJetztPayload } from './core/jetzt.js';
import { jetztItems, jetztModellHtml, jetztPreisHtml, payloadDekodieren } from './ui/jetzt.js';
import { statusRowFromItems } from './ui/status.js';
import { hmOf, isoOf } from './core/time.js';
import { fmtDateShort, escapeHtml } from './ui/format.js';

const $ = id => document.getElementById(id);

const NEU_LADEN_MS = 60000;   // wie oft die Datei geholt wird
const TAKT_MS      = 30000;   // wie oft die Uhren nachgezogen werden

let payload = null;
let quelle = null;
let geholtAm = null;
let fehler = null;

// =========================== QUELLE ===========================
/**
 * Aus einem OneDrive-Freigabelink die Adresse des Inhalts machen.
 *
 * Microsoft nimmt den Link base64-kodiert mit `u!` davor entgegen und liefert
 * den Dateiinhalt zurück. Alles andere wird unverändert benutzt — das ist der
 * Weg für eine Datei, die woanders liegt.
 */
export function inhaltsUrl(roh) {
  const url = String(roh || '').trim();
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  const istFreigabe = /(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$|\.sharepoint\.com$/i.test(host);
  if (!istFreigabe) return url;
  const b64 = btoa(url).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
}

function quelleAusHash() {
  const hash = location.hash.replace(/^#/, '');
  const p = new URLSearchParams(hash);
  const q = p.get('q');
  const d = p.get('d');
  if (q) return { art: 'datei', url: inhaltsUrl(q) };
  if (d) return { art: 'paket', roh: d };
  return null;
}

async function holen() {
  if (!quelle || quelle.art !== 'datei') return;
  try {
    const res = await fetch(quelle.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const daten = await res.json();
    if (!istJetztPayload(daten)) throw new Error('Unbekanntes Format');
    payload = daten;
    geholtAm = new Date();
    fehler = null;
  } catch (e) {
    console.warn('Nicht geholt', e);
    // Ein fehlgeschlagener Abruf verwirft nichts: der letzte Stand bleibt
    // stehen und läuft weiter — er ist nicht falsch, nur älter.
    fehler = payload ? 'zuletzt nicht erreichbar' : (e.message || 'nicht erreichbar');
  }
  zeichnen();
}

// =========================== ZEICHNEN ===========================
function zeichnen() {
  if (!payload) {
    $('jetztLeer').classList.remove('hide');
    $('jetztKarte').classList.add('hide');
    $('jetztLeer').innerHTML = fehler
      ? `<b>Nichts zu sehen.</b><br>${escapeHtml(fehler)}`
      : '<b>Kein Link.</b><br>Diese Seite braucht die Adresse, die zu ihr gehört.';
    return;
  }
  $('jetztLeer').classList.add('hide');
  $('jetztKarte').classList.remove('hide');

  const jetzt = new Date();
  $('jetztModell').innerHTML = jetztModellHtml(payload, jetzt);
  $('jetztStreaks').innerHTML = statusRowFromItems(jetztItems(payload, jetzt));

  const preis = jetztPreisHtml(payload, jetzt);
  const box = $('jetztPreis');
  box.classList.toggle('hide', !preis);
  if (preis) box.innerHTML = preis;

  $('jetztStand').innerHTML = standText(jetzt);
}

/**
 * Woher die Zahlen kommen und wie alt sie sind.
 *
 * Die Unterscheidung ist der Kern dieser Seite: die Uhren laufen immer richtig,
 * ein *neues Ereignis* sieht man aber erst nach dem nächsten Abruf. Wer das
 * nicht danebenschreibt, lässt eine Momentaufnahme wie eine Live-Übertragung
 * aussehen.
 */
function standText(jetzt) {
  const stand = payload.stand ? new Date(payload.stand) : null;
  const alter = stand
    ? (isoOf(stand) === isoOf(jetzt)
        ? `Stand ${hmOf(stand)}`
        : `Stand ${fmtDateShort(isoOf(stand))} ${hmOf(stand)}`)
    : 'Stand unbekannt';
  if (quelle && quelle.art === 'paket') {
    return `${alter} · Momentaufnahme — die Uhren laufen weiter, neue Einträge erscheinen nicht`;
  }
  if (fehler) return `${alter} · ${escapeHtml(fehler)}`;
  const geholt = geholtAm ? ` · zuletzt geholt ${hmOf(geholtAm)}` : '';
  return `${alter}${geholt}`;
}

// =========================== START ===========================
function start() {
  quelle = quelleAusHash();

  if (quelle && quelle.art === 'paket') {
    try {
      const p = payloadDekodieren(quelle.roh);
      if (!istJetztPayload(p)) throw new Error('Unbekanntes Format');
      payload = p;
    } catch (e) {
      console.warn('Paket nicht lesbar', e);
      fehler = 'Der Link ist unvollständig oder gehört zu einer anderen Fassung.';
    }
    zeichnen();
  } else if (quelle && quelle.art === 'datei' && quelle.url) {
    zeichnen();
    holen();
    setInterval(() => { if (document.visibilityState === 'visible') holen(); }, NEU_LADEN_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') holen();
    });
  } else {
    if (quelle) fehler = 'Die Adresse im Link ist unbrauchbar.';
    zeichnen();
  }

  // Die Uhren laufen unabhängig davon weiter, ob gerade etwas geholt wurde.
  setInterval(() => { if (payload && document.visibilityState === 'visible') zeichnen(); }, TAKT_MS);
  window.addEventListener('hashchange', () => location.reload());
}

start();
