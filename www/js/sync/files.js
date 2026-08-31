/**
 * Dateien von Hand: laden, sichern, exportieren.
 * Der Weg für den Fall, dass OneDrive nicht will — und für Backups.
 */

import { STATE, setData } from '../state.js';
import { isoOf } from '../core/time.js';
import { normalizeSettings, resolveModel, modelMap, KIND_ORGASM } from '../core/settings.js';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => isoOf(new Date());

/** JSON-Datei auswählen und laden. @returns {{name}} oder null bei Abbruch. */
export async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      STATE.fileHandle = handle;
      setData(parsed);
      STATE.dirty = false;
      return { name: file.name, data: parsed };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      try {
        const parsed = JSON.parse(await f.text());
        setData(parsed);
        STATE.dirty = false;
        resolve({ name: f.name, data: parsed });
      } catch (e) { reject(e); }
    };
    inp.click();
  });
}

/** Eine JSON-Datei nur einlesen, ohne den Zustand zu ersetzen (für den Import). */
export async function readJsonFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      try { resolve({ name: f.name, data: JSON.parse(await f.text()) }); }
      catch (e) { reject(e); }
    };
    inp.click();
  });
}

export async function saveFile() {
  const blob = new Blob([JSON.stringify(STATE.data, null, 2)], { type: 'application/json' });
  if (STATE.fileHandle && STATE.fileHandle.createWritable) {
    try {
      const w = await STATE.fileHandle.createWritable();
      await w.write(blob);
      await w.close();
      STATE.dirty = false;
      return { method: 'fsa' };
    } catch (e) { console.error('Direktes Schreiben fehlgeschlagen', e); }
  }
  download(blob, 'locked2.json');
  STATE.dirty = false;
  return { method: 'download' };
}

export function backup() {
  download(new Blob([JSON.stringify(STATE.data, null, 2)], { type: 'application/json' }),
    `locked-backup-${stamp()}.json`);
}

/** Roh-Events als CSV — inklusive der Modellnamen, sonst sind IDs außerhalb der App wertlos. */
export function exportCsv() {
  const s = normalizeSettings(STATE.data.settings);
  const map = modelMap(s);
  const rows = [['Datum', 'Zeit', 'Typ', 'Bezeichnung', 'Automatisch', 'Zeit geschätzt']];
  for (const e of (STATE.data.events || []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    rows.push([e.date, e.time, e.type, resolveModel(s, map, e.type).label,
      (e.auto_inactivity || e.auto_regen_timeout) ? 'x' : '', e.time_estimated ? 'x' : '']);
  }
  const csv = rows.map(r => r.map(c => /[",;\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';')).join('\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `locked-events-${stamp()}.csv`);
}

// SheetJS liegt lokal statt beim CDN und wird nur für den Export geladen.
let xlsxPending = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPending) return xlsxPending;
  xlsxPending = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS nicht verfügbar'));
    s.onerror = () => { xlsxPending = null; reject(new Error('SheetJS konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
  return xlsxPending;
}

/** Excel-Mappe: Events, Tage mit ihrer Wertung, Modelle und Einstellungen. */
export async function exportXlsx(calcResult) {
  const XLSX = await loadXlsx();
  const s = calcResult.settings;
  const map = modelMap(s);
  const wb = XLSX.utils.book_new();

  const evRows = [['Datum', 'Zeit', 'Typ', 'Bezeichnung', 'Automatisch', 'Geschätzt']];
  for (const e of (STATE.data.events || []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    evRows.push([e.date, e.time, e.type, resolveModel(s, map, e.type).label,
      (e.auto_inactivity || e.auto_regen_timeout) ? 'x' : '', e.time_estimated ? 'x' : '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evRows), 'Einträge');

  const modelIds = s.models.filter(m => m.kind !== KIND_ORGASM).map(m => m.id);
  const dayRows = [[
    'Datum', 'Zählt', 'Verschlossen h', 'Offen h', 'Multiplikator', 'Bonus',
    'Einnahmen', 'Stundenkosten', 'Orgasmuskosten', 'Netto', 'Konto', 'Form',
    'Orgasmen', ...modelIds.map(id => `h ${id}`),
  ]];
  for (const d of calcResult.days) {
    dayRows.push([
      d.date, d.zaehlt ? 'x' : '', r2(d.verschlossenH), r2(d.offenH), r2(d.mult), r2(d.bonus),
      r2(d.einnahmen), r2(d.stundenKosten), r2(d.orgasmKosten), r2(d.netto), r2(d.konto), r2(d.form),
      d.orgasmen.length, ...modelIds.map(id => r2(d.hours[id] || 0)),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dayRows), 'Tage');

  const mRows = [['ID', 'Art', 'Bezeichnung', 'Punkte/h', 'Verschlossen', 'Offen-Zustand',
    'Regeneration', 'Archiviert', 'Preis min', 'Preis max', 'Halbwertszeit T']];
  for (const m of s.models) {
    mRows.push([m.id, m.kind, m.label, m.rate ?? '', m.locked ? 'x' : '', m.isOpen ? 'x' : '',
      m.regen ? 'x' : '', m.archived ? 'x' : '', m.priceMin ?? '', m.priceMax ?? '', m.halflifeDays ?? '']);
  }
  mRows.push([]);
  mRows.push(['Einstellung', 'Wert']);
  for (const [k, v] of Object.entries(s.points)) mRows.push([k, v]);
  for (const [k, v] of Object.entries(s.rules)) mRows.push([k, v]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mRows), 'Regeln');

  if (STATE.data.legacy) {
    const l = STATE.data.legacy;
    const lRows = [['Archiv (Formel 1.x, eingefroren)', ''],
      ['von', l.von], ['bis', l.bis], ['Stichtag', l.stichtag],
      ['Punkte', r2(l.punkte)], ['Tage mit Einträgen', l.tage], ['Kalendertage', l.kalendertage],
      ['Stunden verschlossen', r2(l.stundenVerschlossen)], ['Orgasmen', l.orgasmen],
      ['Beste orgasmusfreie Strecke', l.bestOfStreak.days]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lRows), 'Archiv');
  }
  XLSX.writeFile(wb, `locked-export-${stamp()}.xlsx`);
}

function r2(n) { return typeof n === 'number' ? Math.round(n * 100) / 100 : n; }
