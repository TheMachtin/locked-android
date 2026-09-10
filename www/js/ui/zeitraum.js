/**
 * Der Zeitraum, den das Dashboard zeigt.
 *
 * Vorher stand hier eine Reihe Jahreszahlen. Die beantwortet „wie war 2025",
 * aber nicht „wie läuft dieser Monat" — und genau das ist die Frage, die man
 * im Rückblick am häufigsten hat. Statt einer Liste von Ausschnitten gibt es
 * deshalb eine **Ebene** (Alles, Jahr, Quartal, Monat) und einen **Anker**, den
 * man mit ‹ › durchblättert. Zwei Klicks reichen damit von „alles" bis „März
 * 2025", ohne dass die Auswahl mit jedem Jahr länger wird.
 *
 * Bewusst frei von DOM: die Ebene-Logik ist eine Aussage über Daten (welcher
 * Tag gehört zum Ausschnitt) und wird in test/zeitraum.test.js geprüft.
 */

import { isoOf, pad2 } from '../core/time.js';
import { MONTHS_DE, MONTHS_SHORT_DE } from './format.js';

export const EBENEN = [
  { v: 'all',     l: 'Alles' },
  { v: 'year',    l: 'Jahr' },
  { v: 'quarter', l: 'Quartal' },
  { v: 'month',   l: 'Monat' },
];
const EBENEN_IDS = EBENEN.map(e => e.v);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 1–4. Januar ist Q1, Dezember ist Q4. */
export function quartalOf(iso) {
  return Math.floor((parseInt(String(iso).slice(5, 7), 10) - 1) / 3) + 1;
}

/**
 * Der erste Tag der Einheit, in der `iso` liegt.
 * Der Anker ist damit für dieselbe Einheit immer derselbe Wert, egal über
 * welchen Tag man hineingekommen ist — sonst zeigte „‹" je nach Klickweg auf
 * unterschiedliche Nachbarn.
 */
export function ankerOf(ebene, iso) {
  const jahr = String(iso).slice(0, 4);
  if (ebene === 'year') return `${jahr}-01-01`;
  if (ebene === 'quarter') return `${jahr}-${pad2((quartalOf(iso) - 1) * 3 + 1)}-01`;
  if (ebene === 'month') return `${String(iso).slice(0, 7)}-01`;
  return `${jahr}-01-01`;
}

/** Aus einem gespeicherten (oder fehlenden) Wert einen benutzbaren machen. */
export function normalizeZeitraum(raw, heuteIso) {
  const heute = ISO.test(heuteIso || '') ? heuteIso : isoOf(new Date());
  const src = (raw && typeof raw === 'object') ? raw : {};
  const ebene = EBENEN_IDS.includes(src.ebene) ? src.ebene : 'all';
  const anker = ISO.test(src.anker || '') ? src.anker : heute;
  return { ebene, anker: ankerOf(ebene, anker) };
}

/** Gehört dieser Tag in den Ausschnitt? */
export function zeitraumMatch(z, iso) {
  if (!z || z.ebene === 'all') return true;
  if (z.ebene === 'year') return iso.slice(0, 4) === z.anker.slice(0, 4);
  if (z.ebene === 'month') return iso.slice(0, 7) === z.anker.slice(0, 7);
  return iso.slice(0, 4) === z.anker.slice(0, 4) && quartalOf(iso) === quartalOf(z.anker);
}

/** Erster und letzter Tag des Ausschnitts. `null` für „alles". */
export function zeitraumRange(z) {
  if (!z || z.ebene === 'all') return null;
  const jahr = parseInt(z.anker.slice(0, 4), 10);
  const monat = parseInt(z.anker.slice(5, 7), 10);
  const monate = z.ebene === 'year' ? 12 : z.ebene === 'quarter' ? 3 : 1;
  const start = z.ebene === 'year' ? `${jahr}-01-01` : `${jahr}-${pad2(monat)}-01`;
  const ersterMonat = z.ebene === 'year' ? 1 : monat;
  // Tag 0 des Folgemonats ist der letzte Tag des Vormonats — Schaltjahre und
  // 30-Tage-Monate müssen hier nicht bekannt sein.
  const ende = new Date(jahr, ersterMonat - 1 + monate, 0, 12, 0, 0);
  return { von: start, bis: isoOf(ende) };
}

/** Um eine Einheit weiter (dir = +1) oder zurück (dir = −1). */
export function zeitraumShift(z, dir) {
  if (!z || z.ebene === 'all') return z;
  const d = new Date(z.anker + 'T12:00:00');
  if (z.ebene === 'year') d.setFullYear(d.getFullYear() + dir);
  else if (z.ebene === 'quarter') d.setMonth(d.getMonth() + 3 * dir);
  else d.setMonth(d.getMonth() + dir);
  return { ebene: z.ebene, anker: ankerOf(z.ebene, isoOf(d)) };
}

/**
 * Darf in diese Richtung geblättert werden?
 *
 * `grenzen` ist die Spanne, über die überhaupt Daten vorliegen (plus heute).
 * Ohne Grenze blättert man in leere Jahre hinaus und weiß nicht, ob dort nie
 * etwas war oder ob man sich verklickt hat.
 */
export function kannBlaettern(z, dir, grenzen) {
  if (!z || z.ebene === 'all') return false;
  if (!grenzen) return true;
  const jetzt = zeitraumRange(z);
  const ziel = zeitraumRange(zeitraumShift(z, dir));
  if (!ziel || !jetzt) return true;
  const schneidet = r => !(r.bis < grenzen.von || r.von > grenzen.bis);
  if (schneidet(ziel)) return true;
  // Steht die Auswahl selbst außerhalb der Daten — etwa nach einem Wechsel der
  // Ebene —, muss der Weg zurück offen bleiben. Sonst klemmt sie in einem
  // leeren Jahr fest, in dem beide Pfeile grau sind.
  if (!schneidet(jetzt)) return dir > 0 ? ziel.von <= grenzen.bis : ziel.bis >= grenzen.von;
  return false;
}

/**
 * Der Anker beim Wechsel der Ebene.
 *
 * Von „Jahr 2026" auf „Quartal" ist das laufende Quartal gemeint, nicht Q1 —
 * die Ebene wird feiner, der betrachtete Zeitpunkt bleibt. Liegt heute nicht im
 * bisherigen Ausschnitt (man sah sich 2024 an), dann dessen letzter Tag: das
 * ist der Teil, den man zuletzt im Blick hatte.
 */
export function ankerBeimWechsel(z, neueEbene, heuteIso) {
  const heute = ISO.test(heuteIso || '') ? heuteIso : isoOf(new Date());
  const r = zeitraumRange(z);
  if (!r) return heute;
  if (heute >= r.von && heute <= r.bis) return heute;
  return r.bis;
}

/** Die Aufschrift zwischen den Pfeilen. */
export function zeitraumLabel(z) {
  if (!z || z.ebene === 'all') return 'Alles';
  const jahr = z.anker.slice(0, 4);
  if (z.ebene === 'year') return jahr;
  if (z.ebene === 'quarter') return `Q${quartalOf(z.anker)} ${jahr}`;
  return `${MONTHS_SHORT_DE[parseInt(z.anker.slice(5, 7), 10) - 1]} ${jahr}`;
}

/** „im März 2026" — für die Unterzeilen der Kacheln, ausgeschrieben. */
export function zeitraumText(z) {
  if (!z || z.ebene === 'all') return 'seit dem Stichtag';
  const jahr = z.anker.slice(0, 4);
  if (z.ebene === 'year') return `im Jahr ${jahr}`;
  if (z.ebene === 'quarter') return `in Q${quartalOf(z.anker)} ${jahr}`;
  return `im ${MONTHS_DE[parseInt(z.anker.slice(5, 7), 10) - 1]} ${jahr}`;
}

/**
 * Die Auflösung, die zu einer Ebene passt.
 *
 * Ein Monat in Monatsbalken wäre ein einzelner Balken, „alles" in Tagesbalken
 * wären tausend. Die Wahl bleibt trotzdem frei — sie wird nur beim Wechsel der
 * Ebene vorgeschlagen.
 */
export function defaultSkala(ebene) {
  if (ebene === 'month') return 'day';
  if (ebene === 'quarter') return 'week';
  return 'month';
}
