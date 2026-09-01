/** Anzeige-Formatierung. Deutsch, mit Tabellenziffern im Blick. */

import { isoOf, pad2 } from '../core/time.js';

export const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function fmtNum(n, dp = 2) {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('de-DE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtInt(n) {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString('de-DE');
}
/** Mit Vorzeichen — für Beträge, bei denen die Richtung die Aussage ist. */
export function fmtSigned(n, dp = 0) {
  if (n == null || !isFinite(n)) return '—';
  const v = dp ? fmtNum(n, dp) : fmtInt(n);
  return n > 0 ? '+' + v : v;
}
export function fmtHours(h) {
  if (h == null || !isFinite(h)) return '—';
  return h.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' h';
}

export function msToHours(ms) { return Math.floor(Math.max(0, ms) / 3600000); }

/** ms → "12 T 5 h" bzw. "5 h 12 min" */
export function fmtDurationShort(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return `${d} T ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
export function fmtDurationLong(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  return `${d} T ${h} h ${m} min`;
}
export function fmtAgo(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  if (ms < 0) return 'später';
  if (ms < 60000) return 'gerade eben';
  return 'vor ' + fmtDurationShort(ms);
}
export function fmtCountdownHM(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}h`;
}
export function fmtCountdownDH(ms) {
  const totalH = Math.max(0, Math.ceil(ms / 3600000));
  const d = Math.floor(totalH / 24), h = totalH % 24;
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

/** "2026-08-14" → "14.08.26" */
export function fmtDateShort(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y.slice(2)}`;
}
/** "2026-08-14" → "14.08.2026" */
export function fmtDateLong(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}
/** "2026-08" → "August 2026" */
export function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS_DE[parseInt(m, 10) - 1]} ${y}`;
}
export function weekdayOf(iso) {
  return DAYS_DE[new Date(iso + 'T12:00:00').getDay()];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Bezugszeitpunkt für Dauern: heute = jetzt, sonst Tagesende. */
export function refTimeFor(iso, now) {
  const n = now || new Date();
  if (iso === isoOf(n)) return n;
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
