/**
 * Diagramme als handgeschriebenes SVG.
 *
 * Keine Bibliothek: die App muss offline starten, und für fünf Diagramme lohnt
 * kein Megabyte Fremdcode, das obendrein Tokens im Speicher mitliest.
 * Alle Funktionen geben Markup zurück und hängen nichts selbst ein — das
 * Verdrahten von Klicks bleibt bei der aufrufenden Seite.
 */

import { isoWeek } from '../core/time.js';
import { fmtInt, fmtNum, fmtDateShort, escapeHtml } from './format.js';
import { resolveModel, modelMap, KIND_ORGASM } from '../core/settings.js';

const MON_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const leer = (txt) => `<div class="empty">${txt}</div>`;

function niceStep(max) {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  return (n <= 1 ? 0.2 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2) * pow;
}

// =========================== TAGES-NETTO ===========================
export function aggregateNetto(days, scale) {
  const m = new Map();
  for (const d of days) {
    if (!d.zaehlt) continue;
    let key, label;
    if (scale === 'month') {
      key = d.date.slice(0, 7);
      label = MON_KURZ[parseInt(d.date.slice(5, 7), 10) - 1];
    } else if (scale === 'week') {
      key = isoWeek(d.date);
      label = 'KW' + key.slice(-2);
    } else {
      key = d.date;
      label = d.date.slice(8);
    }
    if (!m.has(key)) m.set(key, { key, label, netto: 0, einnahmen: 0, kosten: 0 });
    const x = m.get(key);
    x.netto += d.netto; x.einnahmen += d.einnahmen; x.kosten += d.kosten;
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Balken je Zeitraum, Null-Linie in der Mitte. Anklickbar (data-key). */
export function nettoChart(days, scale) {
  const data = aggregateNetto(days, scale);
  if (!data.length) return leer('Noch keine Daten');

  const posMax = Math.max(1, ...data.map(d => d.netto));
  const negMax = Math.abs(Math.min(0, ...data.map(d => d.netto)));

  const W = 480, H = 200, padL = 40, padR = 8, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const step = niceStep(Math.max(posMax, negMax));
  const yPos = Math.ceil(posMax / step) * step;
  const yNeg = Math.ceil(negMax / step) * step;
  const yScale = innerH / (yPos + yNeg || 1);
  const zeroY = padT + yPos * yScale;

  const xstep = innerW / data.length;
  const barW = Math.max(2, Math.min(xstep * 0.75, 40));
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (let v = -yNeg; v <= yPos + 1e-9; v += step) {
    if (Math.abs(v) < 1e-9) continue;
    const y = zeroY - v * yScale;
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-opacity=".4" stroke-dasharray="2 3"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtInt(v)}</text>`;
  }
  svg += `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" stroke="var(--line)"/>`;
  data.forEach((d, i) => {
    const cx = padL + xstep * (i + 0.5);
    const x = cx - barW / 2;
    const h = Math.abs(d.netto) * yScale;
    const y = d.netto >= 0 ? zeroY - h : zeroY;
    const farbe = d.netto >= 0 ? 'var(--accent)' : 'var(--bad)';
    svg += `<rect class="bar-clickable" data-key="${d.key}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
      + `width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${farbe}" rx="2" style="cursor:pointer">`
      + `<title>${d.label}: ${fmtInt(d.netto)} (Einnahmen ${fmtInt(d.einnahmen)}, Kosten ${fmtInt(d.kosten)})</title></rect>`;
    if (i % labelEvery === 0) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.label}</text>`;
    }
  });
  return svg + '</svg>';
}

// =========================== KONTO UND FORM ===========================
/**
 * Zwei Linien: das mitlaufende Konto und der abklingende Form-Wert.
 * Sie stehen bewusst zusammen — die eine sagt „insgesamt", die andere „zuletzt",
 * und erst der Abstand zwischen beiden zeigt, ob es gerade auf- oder abwärtsgeht.
 */
export function verlaufChart(days) {
  const d = days.filter(x => x.zaehlt);
  if (d.length < 2) return leer('Zu wenig Daten für einen Verlauf');

  const W = 480, H = 190, padL = 44, padR = 44, padT = 12, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const kMin = Math.min(0, ...d.map(x => x.konto));
  const kMax = Math.max(1, ...d.map(x => x.konto));
  const fMin = Math.min(0, ...d.map(x => x.form));
  const fMax = Math.max(1, ...d.map(x => x.form));
  const xOf = i => padL + (i / (d.length - 1)) * innerW;
  const kY = v => padT + innerH - ((v - kMin) / (kMax - kMin || 1)) * innerH;
  const fY = v => padT + innerH - ((v - fMin) / (fMax - fMin || 1)) * innerH;

  const pfad = (yFn, key) => d.map((x, i) => `${i ? 'L' : 'M'} ${xOf(i).toFixed(1)} ${yFn(x[key]).toFixed(1)}`).join(' ');

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i) / 4;
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
    svg += `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--accent)">${fmtInt(kMax - (kMax - kMin) * i / 4)}</text>`;
    svg += `<text x="${W - padR + 4}" y="${y + 3}" font-size="9" fill="#c89060">${fmtInt(fMax - (fMax - fMin) * i / 4)}</text>`;
  }
  if (kMin < 0) {
    const y0 = kY(0);
    svg += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" stroke="var(--bad)" stroke-opacity=".5"/>`;
  }
  svg += `<path d="${pfad(fY, 'form')}" fill="none" stroke="#c89060" stroke-width="1.8" stroke-linejoin="round"/>`;
  svg += `<path d="${pfad(kY, 'konto')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  const marken = Math.min(6, d.length);
  for (let i = 0; i < marken; i++) {
    const idx = Math.round((i / (marken - 1 || 1)) * (d.length - 1));
    svg += `<text x="${xOf(idx).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === marken - 1 ? 'end' : 'middle'}" `
      + `font-size="9" fill="var(--muted)">${fmtDateShort(d[idx].date)}</text>`;
  }
  return svg + '</svg>';
}

// =========================== TRAGEZEIT JE MODELL ===========================
export function modellDonut(hoursByModel, settings) {
  const map = modelMap(settings);
  const eintraege = Object.entries(hoursByModel)
    .filter(([, h]) => h > 0)
    .map(([id, h]) => ({ id, h, m: resolveModel(settings, map, id) }))
    .filter(x => x.m.kind !== KIND_ORGASM)
    .sort((a, b) => b.h - a.h);
  const total = eintraege.reduce((s, x) => s + x.h, 0);
  if (!total) return { svg: leer('Noch keine Tragezeit'), liste: '' };

  const size = 168, r = 62, sw = 22, cx = size / 2, cy = size / 2;
  let winkel = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 ${size} ${size}" style="width:168px;height:168px;display:block">`;
  for (const x of eintraege) {
    const anteil = x.h / total;
    const ende = winkel + anteil * Math.PI * 2;
    const gross = anteil > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(winkel), y1 = cy + r * Math.sin(winkel);
    const x2 = cx + r * Math.cos(ende), y2 = cy + r * Math.sin(ende);
    // Ein voller Kreis ließe sich als Bogen nicht zeichnen (Start = Ende).
    if (anteil > 0.999) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${x.m.color}" stroke-width="${sw}">`
        + `<title>${escapeHtml(x.m.label)}: ${fmtInt(x.h)} h</title></circle>`;
    } else {
      svg += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${gross} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" `
        + `stroke="${x.m.color}" stroke-width="${sw}" fill="none" stroke-linecap="butt">`
        + `<title>${escapeHtml(x.m.label)}: ${fmtInt(x.h)} h</title></path>`;
    }
    winkel = ende;
  }
  svg += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)">${fmtInt(total)}</text>`;
  svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">Stunden</text></svg>`;

  const liste = eintraege.map(x => `<div class="model-line">
    <span class="dot" style="background:${x.m.color}"></span>
    <span class="name">${escapeHtml(x.m.label)}</span>
    <span class="val">${fmtInt(x.h)} h · ${fmtNum(x.h / total * 100, 0)} %</span>
  </div>`).join('');
  return { svg, liste };
}

// =========================== KALENDER ===========================
function heatColor(netto) {
  if (netto == null) return '#3a3024';
  if (netto < -20) return '#c2553f';
  if (netto < 0)   return '#8a5a48';
  if (netto < 10)  return '#5a4b39';
  if (netto < 25)  return '#3f5212';
  if (netto < 35)  return '#65a30d';
  return '#84cc16';
}

export function heatmap(days) {
  const gezaehlt = days.filter(d => d.zaehlt);
  if (!gezaehlt.length) return leer('Noch keine Daten');
  const byYear = {};
  for (const d of gezaehlt) (byYear[d.date.slice(0, 4)] ||= {})[d.date] = d;
  return Object.keys(byYear).sort().map(y => heatmapYear(y, byYear[y])).join('');
}

function heatmapYear(year, byIso) {
  const jahr = parseInt(year, 10);
  const start = new Date(jahr, 0, 1);
  const ende = new Date(jahr, 11, 31);
  const tage = [];
  for (let d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) tage.push(new Date(d));

  const cell = 11, gap = 2, padL = 18, padT = 14;
  const firstOff = (start.getDay() + 6) % 7;
  const cols = Math.ceil((firstOff + tage.length) / 7);
  const W = padL + cols * (cell + gap);
  const H = padT + 7 * (cell + gap);

  let svg = `<div style="margin-bottom:12px"><div style="font-size:13px;color:var(--muted);font-weight:600;margin-bottom:4px">${year}</div>`;
  svg += `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (const [idx, name] of [[0, 'Mo'], [2, 'Mi'], [4, 'Fr']]) {
    svg += `<text x="0" y="${padT + idx * (cell + gap) + cell - 1}" font-size="8" fill="var(--muted)">${name}</text>`;
  }
  let letzterMonat = -1;
  tage.forEach((d, i) => {
    const pos = firstOff + i;
    const col = Math.floor(pos / 7), row = pos % 7;
    const x = padL + col * (cell + gap), y = padT + row * (cell + gap);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rec = byIso[iso];
    if (d.getMonth() !== letzterMonat && d.getDate() <= 7) {
      letzterMonat = d.getMonth();
      svg += `<text x="${x}" y="${padT - 4}" font-size="8" fill="var(--muted)">${MON_KURZ[d.getMonth()]}</text>`;
    }
    const titel = rec
      ? `${fmtDateShort(iso)}: ${fmtInt(rec.netto)} Punkte, ${fmtNum(rec.verschlossenH, 1)} h verschlossen`
      : `${fmtDateShort(iso)}: nichts erfasst`;
    svg += `<rect class="hm-cell" data-iso="${iso}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" `
      + `fill="${heatColor(rec ? rec.netto : null)}" style="cursor:pointer"><title>${titel}</title></rect>`;
  });
  return svg + '</svg></div>';
}

// =========================== WOCHENTAGE ===========================
export function weekdayChart(byWeekday) {
  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const daten = [1, 2, 3, 4, 5, 6, 0].map((wd, i) => {
    const w = byWeekday[wd];
    return { label: labels[i], avg: w.tage ? w.netto / w.tage : 0, tage: w.tage };
  });
  const max = Math.max(1, ...daten.map(d => Math.abs(d.avg)));
  return `<div class="wd-chart">${daten.map(d => {
    const anteil = Math.abs(d.avg) / max;
    const farbe = d.avg >= 0 ? 'var(--accent)' : 'var(--bad)';
    return `<div class="wd-bar" title="${d.label}: ${fmtNum(d.avg, 1)} Punkte im Schnitt aus ${d.tage} Tagen">
      <div class="wd-fill" style="height:${(anteil * 100).toFixed(0)}%;background:${farbe}"></div>
      <div class="wd-val">${fmtInt(d.avg)}</div>
      <div class="wd-lbl">${d.label}</div></div>`;
  }).join('')}</div>`;
}

// =========================== TAGESVERLAUF ===========================
/** Der farbige Balken über 24 Stunden im Eintrag-Tab. */
export function dayTimeline(rec, settings, nowMin) {
  const map = modelMap(settings);
  const grenze = typeof nowMin === 'number' ? Math.min(1440, nowMin) : 1440;
  const segmente = [];
  let cur = rec.prevEndModel;
  let curMin = 0;
  for (const ev of rec.events) {
    const m = resolveModel(settings, map, ev.type);
    if (m.kind === KIND_ORGASM) continue;
    const [h, mi] = String(ev.time).split(':').map(Number);
    const t = h * 60 + mi;
    if (t > curMin) segmente.push({ start: curMin, end: t, id: cur });
    cur = ev.type;
    curMin = t;
  }
  if (curMin < 1440) segmente.push({ start: curMin, end: 1440, id: cur });
  const sichtbar = segmente.filter(s => s.start < grenze)
    .map(s => (s.end > grenze ? { ...s, end: grenze } : s));

  const orMarks = rec.events
    .filter(e => resolveModel(settings, map, e.type).kind === KIND_ORGASM)
    .map(e => { const [h, mi] = String(e.time).split(':').map(Number); return h * 60 + mi; });

  const W = 480, H = 48, padL = 4, padR = 4, top = 4, barH = 24;
  const innerW = W - padL - padR;
  const scale = min => padL + (min / 1440) * innerW;
  const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  svg += `<rect x="${padL}" y="${top}" width="${innerW}" height="${barH}" fill="var(--panel-2)" rx="4"/>`;
  for (const s of sichtbar) {
    const m = resolveModel(settings, map, s.id);
    const x = scale(s.start), w = scale(s.end) - x;
    const bis = (s.end === grenze && grenze < 1440) ? `${hhmm(s.end)} (jetzt)` : hhmm(s.end);
    svg += `<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(1)}" height="${barH}" fill="${m.color}">`
      + `<title>${escapeHtml(m.label)} ${hhmm(s.start)}–${bis}</title></rect>`;
  }
  if (grenze < 1440) {
    const x = scale(grenze);
    svg += `<line x1="${x.toFixed(1)}" y1="${top - 3}" x2="${x.toFixed(1)}" y2="${top + barH + 3}" `
      + `stroke="var(--text)" stroke-width="1.5" opacity=".8"><title>jetzt ${hhmm(grenze)}</title></line>`;
  }
  for (const m of orMarks) {
    const x = scale(m);
    svg += `<line x1="${x.toFixed(1)}" y1="${top - 2}" x2="${x.toFixed(1)}" y2="${top + barH + 2}" stroke="var(--danger)" stroke-width="2"/>`;
    svg += `<circle cx="${x.toFixed(1)}" cy="${top - 2}" r="3" fill="var(--danger)"/>`;
  }
  for (let h = 0; h <= 24; h += 6) {
    const x = scale(h * 60);
    svg += `<text x="${x.toFixed(1)}" y="${H - 2}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}" `
      + `font-size="9" fill="var(--muted)">${String(h).padStart(2, '0')}</text>`;
  }
  return svg + '</svg>';
}
