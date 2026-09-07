/**
 * Wo die Dateien in OneDrive liegen.
 *
 * Der Ordner stand bisher als Konstante im Code — ein Umzug hieß: neue Version
 * bauen. Er liegt jetzt pro Gerät im `localStorage`, und zwar bewusst *nicht*
 * in `data.settings`: die Einstellungen stehen in genau der Datei, die man erst
 * finden muss, um sie zu lesen. Ein Pfad, der sich selbst enthält, wäre nicht
 * auflösbar — und ein Merge-Konflikt darüber schickte ein Gerät ins Leere.
 *
 * Der Preis dafür ist ehrlich: nach einem Umzug muss der Ordner an jeder
 * Installation einmal gesetzt werden. Das ist einmal pro Umzug, nicht einmal
 * pro Tag.
 */

const LS_ORDNER = 'locked_cloud_folder_v1';

/** Wo die Dateien lagen, bevor der Ordner einstellbar war. */
export const STANDARD_ORDNER = '/Documents/sonstiges/Keuschhaltung';

export const DATEI_DATEN  = 'locked2.json';
export const DATEI_JETZT  = 'jetzt.json';
export const DATEI_LEGACY = 'locked.json';

/**
 * Auf die Form bringen, die Graph erwartet: führender Schrägstrich, keiner am
 * Ende, keine leeren oder relativen Abschnitte. Der Wurzelordner ist `''` —
 * daraus wird mit dem Dateinamen `/locked2.json`.
 */
export function normalizeOrdner(roh) {
  const teile = String(roh == null ? '' : roh)
    .replace(/\\/g, '/')
    .split('/')
    .map(t => t.trim())
    .filter(t => t && t !== '.' && t !== '..');
  return teile.length ? '/' + teile.join('/') : '';
}

export function cloudOrdner() {
  try {
    const roh = localStorage.getItem(LS_ORDNER);
    if (roh != null) return normalizeOrdner(roh);
  } catch {}
  return STANDARD_ORDNER;
}

/** @returns der übernommene Ordner in normalisierter Form. */
export function setCloudOrdner(roh) {
  const ordner = normalizeOrdner(roh);
  try { localStorage.setItem(LS_ORDNER, ordner); } catch (e) { console.warn('Ordner nicht merkbar', e); }
  return ordner;
}

const pfad = (datei) => `${cloudOrdner()}/${datei}`;

/** Die 2.0-Datei mit der Historie. */
export const datenPfad = () => pfad(DATEI_DATEN);
/** Der abgeleitete „Jetzt"-Block für die Live-Ansicht. */
export const jetztPfad = () => pfad(DATEI_JETZT);
/** Die alte 1.x-Datei — nur für den einmaligen Umzug. */
export const legacyPfad = () => pfad(DATEI_LEGACY);
