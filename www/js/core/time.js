/**
 * Datums- und Zeithelfer.
 *
 * Alles rechnet in *lokaler* Zeit: toISOString() wäre UTC und würde den Tag
 * je nach Zeitzone verschieben. Datumsarithmetik läuft über 12:00 Uhr mittags,
 * damit ein Sommerzeitwechsel (23- oder 25-Stunden-Tag) nicht auf den Nachbartag
 * kippt.
 */

export function pad2(n) { return String(n).padStart(2, '0'); }

/** "HH:MM" → Minuten seit Mitternacht */
export function timeToMin(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minuten seit Mitternacht → "HH:MM" */
export function minToTime(min) {
  const m = Math.max(0, Math.round(min));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

/** Date → "YYYY-MM-DD" (lokal) */
export function isoOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Date → "HH:MM" (lokal) */
export function hmOf(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/** Minuten seit Mitternacht (lokal) */
export function minutesOf(d) { return d.getHours() * 60 + d.getMinutes(); }

/** ISO-Datum um n Tage verschieben */
export function isoDateAdd(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** Überschrittene Tagesgrenzen zwischen zwei Zeitpunkten */
export function calendarDaysBetween(aMs, bMs) {
  const a = new Date(aMs); a.setHours(12, 0, 0, 0);
  const b = new Date(bMs); b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Ganze Kalendertage zwischen zwei ISO-Daten (b − a) */
export function isoDaysBetween(aIso, bIso) {
  return calendarDaysBetween(
    new Date(aIso + 'T12:00:00').getTime(),
    new Date(bIso + 'T12:00:00').getTime(),
  );
}

/** Zeitpunkt eines Events als ms */
export function eventMs(e) {
  return new Date(`${e.date}T${e.time}:00`).getTime();
}

/** Sortierschlüssel eines Events — lexikografisch identisch zur Zeitachse */
export function eventSortKey(e) { return e.date + 'T' + e.time; }

/** ISO 8601 Kalenderwoche, "YYYY-Www" */
export function isoWeek(iso) {
  const d = new Date(iso + 'T12:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getFullYear()}-W${pad2(week)}`;
}
