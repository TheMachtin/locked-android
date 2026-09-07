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
import {
  jetztItems, jetztModellHtml, jetztPreisHtml, payloadDekodieren,
  inhaltsUrl, inhaltsKandidaten,
} from './ui/jetzt.js';
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
// Wie aus einem Freigabelink eine Abrufadresse wird, steht in `ui/jetzt.js` —
// dort ist es ohne DOM und damit prüfbar.

function quelleAusHash() {
  const hash = location.hash.replace(/^#/, '');
  const p = new URLSearchParams(hash);
  const q = p.get('q');
  const d = p.get('d');
  const diag = p.get('diag');
  if (diag) return { art: 'diagnose', roh: diag };
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

// =========================== DIAGNOSE ===========================
/**
 * Welche Adressform gibt die Freigabe anonym heraus?
 *
 * Die Frage ließ sich nur dort beantworten, wo die Verbindung besteht — also
 * hier, im Browser des Betrachters, statt durch Raten im Code. Probiert werden
 * die Kandidaten der Reihe nach; was zählt, ist der Unterschied zwischen einer
 * *Statuszeile* und einer *Ausnahme*: eine Antwort mit lesbarem Status hat die
 * CORS-Prüfung bestanden und scheitert nur an der Berechtigung. Ein Block
 * dagegen kommt gar nicht erst bis zum Status.
 *
 * Die Adressen selbst werden bewusst nicht angezeigt: sie enthalten die
 * Freigabe-Kennung, und diese Seite ist zum Herzeigen gedacht.
 */
async function pruefeAdresse(url) {
  if (!url) return 'keine Adresse';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return `HTTP ${res.status}`;
    try {
      const daten = await res.json();
      return istJetztPayload(daten) ? 'HTTP 200 · Paket erkannt ✓' : 'HTTP 200 · anderer Inhalt';
    } catch { return 'HTTP 200 · kein JSON'; }
  } catch (e) {
    return `blockiert · ${e.message || e}`;
  }
}

async function diagnose(roh) {
  const karte = $('jetztLeer');
  const kandidaten = inhaltsKandidaten(roh);
  karte.classList.remove('hide');
  $('jetztKarte').classList.add('hide');

  if (!kandidaten.length) {
    karte.innerHTML = '<b>Diagnose</b><br>Die Adresse im Link ist unbrauchbar.';
    return;
  }

  const stand = kandidaten.map(() => 'wartet');
  const zeichneListe = () => {
    karte.innerHTML = '<b>Diagnose</b>'
      + '<div class="small" style="margin-top:0">Welche Adressform gibt die Datei anonym heraus?</div>'
      + '<div class="breakdown">'
      + kandidaten.map((k, i) =>
          `<div class="row"><span>${escapeHtml(k.name)}</span><b>${escapeHtml(stand[i])}</b></div>`).join('')
      + '</div>'
      + '<div class="small">Die Adressen selbst stehen hier nicht — sie enthalten die '
      + 'Freigabe-Kennung, und dieser Zettel ist zum Herzeigen gedacht.</div>';
  };
  zeichneListe();

  for (let i = 0; i < kandidaten.length; i++) {
    stand[i] = 'läuft…';
    zeichneListe();
    stand[i] = await pruefeAdresse(kandidaten[i].url);
    zeichneListe();
  }
}

// =========================== START ===========================
function start() {
  quelle = quelleAusHash();

  if (quelle && quelle.art === 'diagnose') {
    diagnose(quelle.roh);
    return;                                  // keine Uhren, kein Nachladen
  }

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
