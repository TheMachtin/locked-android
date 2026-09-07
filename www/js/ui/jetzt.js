/**
 * Der „Jetzt"-Block aus einem mitgegebenen Paket.
 *
 * Gegenstück zu `ui/status.js`: dieselben vier Kacheln, dieselbe Kopfzeile,
 * dieselbe Preiszeile — nur speist sich alles aus `core/jetzt.js` statt aus der
 * durchgerechneten Historie. Gezeichnet wird mit dem Renderer aus `status.js`;
 * hier steht nur, wie aus den Zahlen Beschriftungen werden.
 *
 * Das Paket kommt von außen — aus einer Datei, die jemand anderes abgelegt hat.
 * Es wird deshalb wie Fremdtext behandelt: jede Zeichenkette daraus geht durch
 * `escapeHtml()`, bevor sie in die Seite kommt.
 */

import { jetztWerte } from '../core/jetzt.js';
import { isoOf, hmOf } from '../core/time.js';
import { fmtInt, fmtNum, fmtDateShort, msToDays, escapeHtml } from './format.js';

/** „seit 14.08.26 08:30" — mit Datum, weil die Uhrzeit allein morgen lügt. */
function seitStempel(ms) {
  const d = new Date(ms);
  return `seit ${fmtDateShort(isoOf(d))} ${hmOf(d)}`;
}

/** Dieselben vier Kacheln wie `statusItems()`, aus dem Paket gerechnet. */
export function jetztItems(p, now) {
  const w = jetztWerte(p, now);
  const pauseLabel = p.lock && p.lock.pauseLabel ? escapeHtml(p.lock.pauseLabel) : null;

  return [
    {
      days: p.lock ? msToDays(w.lockMs) : 0, label: 'Verschlossen',
      ms: p.lock ? w.lockMs : null,
      since: !p.lock ? 'gerade offen'
        : seitStempel(p.lock.seitMs)
          + (pauseLabel ? `<br>${pauseLabel} seit ${hmOf(new Date(p.lock.pauseSeitMs))}` : ''),
    },
    {
      days: p.uo ? msToDays(w.uoMs) : 0, label: 'Ungeöffnet',
      ms: p.uo ? w.uoMs : null,
      since: p.uo
        ? (w.uoBonus
            ? `+${fmtNum(w.uoBonus, w.uoBonus % 1 ? 1 : 0)} heute · ${seitStempel(p.uo.seitMs)}`
            : seitStempel(p.uo.seitMs))
        : (pauseLabel ? `${pauseLabel} läuft` : 'gerade offen'),
    },
    {
      days: w.ofTage, label: 'Orgasmusfrei',
      ms: w.orMs,
      since: p.letzterOrgasmusMs != null ? seitStempel(p.letzterOrgasmusMs) : 'keiner erfasst',
    },
    {
      days: null, label: 'Multiplikator',
      text: `× ${fmtNum(w.mult, 2)}`,
      since: w.mult >= p.punkte.streakCap ? 'Deckel erreicht' : `Deckel × ${fmtNum(p.punkte.streakCap, 2)}`,
    },
  ];
}

/** „Modell jetzt: Holy Trainer (seit 08:30)" — dieselbe Zeile wie im Dashboard. */
export function jetztModellHtml(p, now) {
  const m = p.modell;
  if (!m) return '';
  const jetzt = now instanceof Date ? now : new Date();
  let seit = '';
  if (m.zeigtSeit && m.seitMs != null) {
    const d = new Date(m.seitMs);
    // Am selben Tag genügt die Uhrzeit; davor gehört das Datum dazu, sonst
    // liest sich ein drei Tage alter Wechsel wie einer von heute früh.
    seit = isoOf(d) === isoOf(jetzt)
      ? ` (seit ${hmOf(d)})`
      : ` (seit ${fmtDateShort(isoOf(d))} ${hmOf(d)})`;
  }
  const weiter = m.pause && p.lock ? ' <span class="hint">— Phase läuft weiter</span>' : '';
  return `<span class="dot" style="background:${escapeHtml(m.farbe || '#888')}"></span>`
    + `<span>Modell jetzt: <b>${escapeHtml(m.label)}</b>${seit}${weiter}</span>`;
}

/** Die Preiszeile — `null`, wenn die Datei kein Orgasmus-Modell kennt. */
export function jetztPreisHtml(p, now) {
  const { preis } = jetztWerte(p, now);
  if (!preis) return null;
  const warte = isFinite(preis.abstandTage)
    ? `${fmtNum(preis.abstandTage, 1)} Tage seit dem letzten`
    : 'noch keiner erfasst';
  return `<div><div class="l">${escapeHtml(preis.label)} kostet gerade</div>
    <div class="l" style="opacity:.8">${warte}</div></div><div class="v">−${fmtInt(preis.price)}</div>`;
}

// =========================== DIE QUELLE FINDEN ===========================
/**
 * Aus einem OneDrive-Freigabelink die Adressen machen, unter denen der Inhalt
 * liegen könnte.
 *
 * Microsoft nimmt die Freigabe als Kennung entgegen: der Link base64-kodiert,
 * mit `u!` davor. Unter welchem Pfad er den Inhalt dann *anonym* herausgibt,
 * ist die offene Frage — `shares/…/root/content` antwortet mit 401. Die Liste
 * steht deshalb hier vollständig: Eintrag 0 ist der Weg, den die Seite geht,
 * die übrigen probiert der Diagnose-Modus durch, bis einer 200 sagt.
 *
 * Alles, was nicht nach OneDrive aussieht, bleibt unverändert — das ist der
 * Weg für eine Datei, die woanders liegt.
 */
export function inhaltsKandidaten(roh) {
  const url = String(roh || '').trim();
  if (!/^https?:\/\//i.test(url)) return [];
  let host;
  try { host = new URL(url).hostname; } catch { return []; }
  if (!/(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$|\.sharepoint\.com$/i.test(host)) {
    return [{ name: 'Adresse direkt', url }];
  }
  const t = 'u!' + b64urlAus(new TextEncoder().encode(url));
  return [
    { name: 'shares · root/content',      url: `https://api.onedrive.com/v1.0/shares/${t}/root/content` },
    { name: 'shares · driveItem/content', url: `https://api.onedrive.com/v1.0/shares/${t}/driveItem/content` },
    { name: 'graph · driveItem/content',  url: `https://graph.microsoft.com/v1.0/shares/${t}/driveItem/content` },
    { name: 'Freigabelink · download=1',  url: mitParameter(url, 'download', '1') },
    { name: 'Freigabelink direkt',        url },
  ];
}

function mitParameter(url, name, wert) {
  try {
    const u = new URL(url);
    u.searchParams.set(name, wert);
    return u.toString();
  } catch { return url; }
}

/** Die Adresse, unter der die Seite den Inhalt holt. */
export function inhaltsUrl(roh) {
  const erste = inhaltsKandidaten(roh)[0];
  return erste ? erste.url : null;
}

// =========================== PAKET IN EINEN LINK ===========================
// Für den Fall ohne laufende Quelle: das Paket steckt dann im Link selbst. Die
// Uhren laufen weiter, neue Einträge erscheinen nicht — anders als bei einer
// Datei, die die App nachschreibt.

function b64urlAus(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function payloadKodieren(p) {
  return b64urlAus(new TextEncoder().encode(JSON.stringify(p)));
}

export function payloadDekodieren(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const roh = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
