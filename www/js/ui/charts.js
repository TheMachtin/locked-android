/**
 * Diagramme als handgeschriebenes SVG.
 *
 * Keine Bibliothek: die App muss offline starten, und für eine Handvoll
 * Diagramme lohnt kein Megabyte Fremdcode, das obendrein Tokens im Speicher
 * mitliest. Alle Funktionen geben Markup zurück und hängen nichts selbst ein —
 * das Verdrahten von Klicks bleibt bei der aufrufenden Seite.
 *
 * Die Balkendiagramme je Zeitraum teilen sich `aggregatePeriods()` und
 * `saeulen()`: Punkte, Stunden und Orgasmen sind dieselbe Form mit einer
 * anderen Kennzahl, und drei eigene Fassungen davon würden früher oder später
 * drei verschiedene Vorstellungen davon entwickeln, was ein Monat ist.
 */

import { isoWeek } from '../core/time.js';
import { fmtInt, fmtNum, fmtDateShort, escapeHtml, MONTHS_SHORT_DE as MON_KURZ } from './format.js';
import { resolveModel, modelMap, brichtStrecke, KIND_ORGASM } from '../core/settings.js';

const leer = (txt) => `<div class="empty">${txt}</div>`;

function niceStep(max) {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  return (n <= 1 ? 0.2 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2) * pow;
}

// =========================== JE ZEITRAUM ===========================
/**
 * Die Tage zu Zeiträumen zusammenfassen — einmal für alle Balkendiagramme.
 *
 * Es gab dafür drei Anläufe in drei Funktionen, und jede hätte ihre eigene
 * Vorstellung davon entwickelt, was ein Monat ist. Hier steht eine: derselbe
 * Schlüssel, dieselbe Aufschrift, dieselbe Sortierung für Punkte, Stunden,
 * Orgasmen und die Tragezeit je Modell.
 */
export function aggregatePeriods(days, scale) {
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
    if (!m.has(key)) {
      m.set(key, {
        key, label, von: d.date, bis: d.date, tage: 0,
        netto: 0, einnahmen: 0, kosten: 0,
        stunden: 0, offen: 0, pause: 0,
        orgasmen: 0, abstandSumme: 0, abstandAnzahl: 0,
        hours: {},
      });
    }
    const x = m.get(key);
    x.tage++;
    if (d.date < x.von) x.von = d.date;
    if (d.date > x.bis) x.bis = d.date;
    x.netto += d.netto; x.einnahmen += d.einnahmen; x.kosten += d.kosten;
    x.stunden += d.verschlossenH; x.offen += d.offenH; x.pause += d.pauseH;
    // Balken und Abstandslinie beantworten beide eine Frage nach Orgasmen.
    // Ein Ereignis, das die Strecke nicht bricht, ist keiner und hat auch
    // keinen Abstand zum vorigen, der hier etwas hieße.
    for (const o of d.orgasmen) {
      if (!brichtStrecke(o.model)) continue;
      x.orgasmen++;
      // Der erste erfasste Orgasmus hat keinen Abstand — ihn als 0 zu zählen
      // würde den Schnitt des ersten Zeitraums nach unten ziehen.
      if (isFinite(o.abstandTage)) { x.abstandSumme += o.abstandTage; x.abstandAnzahl++; }
    }
    for (const [id, h] of Object.entries(d.hours)) x.hours[id] = (x.hours[id] || 0) + h;
  }
  const out = [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const x of out) x.abstand = x.abstandAnzahl ? x.abstandSumme / x.abstandAnzahl : null;
  return out;
}

/** Maßstab und Nulllinie eines Balkendiagramms. */
function achsen(werte, innerH, padT) {
  const posMax = Math.max(0, ...werte);
  const negMax = Math.abs(Math.min(0, ...werte));
  const step = niceStep(Math.max(posMax, negMax, 1));
  const yPos = Math.max(step, Math.ceil(posMax / step) * step);
  const yNeg = Math.ceil(negMax / step) * step;
  const yScale = innerH / (yPos + yNeg || 1);
  return { step, yPos, yNeg, yScale, zeroY: padT + yPos * yScale };
}

/**
 * Balken je Zeitraum — die gemeinsame Grundform.
 *
 * @param {Array}  data  aus aggregatePeriods()
 * @param {object} spec  { wert, farbe, titel, achse, klick }
 */
function saeulen(data, spec) {
  const W = 480, H = 200, padL = 40, padR = 8, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const werte = data.map(spec.wert);
  const a = achsen(werte, innerH, padT);
  const xstep = innerW / data.length;
  const barW = Math.max(2, Math.min(xstep * 0.75, 40));
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));
  const achse = spec.achse || fmtInt;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (let v = -a.yNeg; v <= a.yPos + 1e-9; v += a.step) {
    if (Math.abs(v) < 1e-9) continue;
    const y = a.zeroY - v * a.yScale;
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-opacity=".4" stroke-dasharray="2 3"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${achse(v)}</text>`;
  }
  svg += `<line x1="${padL}" y1="${a.zeroY.toFixed(1)}" x2="${W - padR}" y2="${a.zeroY.toFixed(1)}" stroke="var(--line)"/>`;
  data.forEach((d, i) => {
    const v = spec.wert(d);
    const cx = padL + xstep * (i + 0.5);
    const x = cx - barW / 2;
    const h = Math.abs(v) * a.yScale;
    const y = v >= 0 ? a.zeroY - h : a.zeroY;
    const klick = spec.klick === false ? '' : ' class="bar-clickable" style="cursor:pointer"';
    svg += `<rect${klick} data-key="${d.key}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
      + `width="${barW.toFixed(1)}" height="${Math.max(h, v ? 1 : 0).toFixed(1)}" fill="${spec.farbe(v, d)}" rx="2">`
      + `<title>${spec.titel(d)}</title></rect>`;
    if (i % labelEvery === 0) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.label}</text>`;
    }
  });
  return { svg: svg + '</svg>', achsen: a, geometrie: { W, H, padL, padR, padT, padB, innerW, innerH, xstep } };
}

export const METRIKEN = [
  { v: 'netto',    l: 'Punkte',    beschreibung: 'Tagesergebnisse zusammengezählt' },
  { v: 'stunden',  l: 'Stunden',   beschreibung: 'verschlossene Stunden' },
  { v: 'orgasmen', l: 'Orgasmen',  beschreibung: 'Anzahl je Zeitraum' },
];

/**
 * Ein Diagramm, drei Fragen: Punkte, verschlossene Stunden oder Orgasmen je
 * Zeitraum. Dieselben Balken, dieselbe Achse, derselbe Klick auf einen Tag —
 * nur die Kennzahl wechselt. Anklickbar (data-key).
 */
export function metricChart(days, scale, metric) {
  const data = aggregatePeriods(days, scale);
  if (!data.length) return leer('Noch keine Daten');

  if (metric === 'stunden') {
    return saeulen(data, {
      wert: d => d.stunden,
      farbe: () => 'var(--accent)',
      achse: v => fmtInt(v),
      titel: d => `${d.label}: ${fmtNum(d.stunden, 1)} h verschlossen`
        + ` (offen ${fmtNum(d.offen, 1)} h, Unterbrechung ${fmtNum(d.pause, 1)} h)`,
    }).svg;
  }
  if (metric === 'orgasmen') {
    return saeulen(data, {
      wert: d => d.orgasmen,
      farbe: () => 'var(--danger)',
      achse: v => fmtInt(v),
      titel: d => `${d.label}: ${fmtInt(d.orgasmen)} ${d.orgasmen === 1 ? 'Orgasmus' : 'Orgasmen'}`
        + (d.abstand != null ? `, Ø Abstand ${fmtNum(d.abstand, 1)} T` : ''),
    }).svg;
  }
  return saeulen(data, {
    wert: d => d.netto,
    farbe: v => (v >= 0 ? 'var(--accent)' : 'var(--bad)'),
    achse: v => fmtInt(v),
    titel: d => `${d.label}: ${fmtInt(d.netto)} (Einnahmen ${fmtInt(d.einnahmen)}, Kosten ${fmtInt(d.kosten)})`,
  }).svg;
}

// =========================== ORGASMEN IM VERLAUF ===========================
/**
 * Anzahl je Zeitraum als Balken, der durchschnittliche Abstand als Linie.
 *
 * Der Zähler oben im Dashboard sagt, wie es *gerade* steht. Ob die Strecken
 * länger oder kürzer werden, sagt er nicht — und das ist die Frage, um die es
 * bei einem Abstand geht. Die Linie hat ihre eigene Achse rechts: Anzahl und
 * Tage haben nichts gemeinsam außer der Zeitachse darunter.
 */
export function orgasmusChart(days, scale) {
  const data = aggregatePeriods(days, scale);
  if (!data.length) return leer('Noch keine Daten');
  if (!data.some(d => d.orgasmen)) return leer('Kein Orgasmus im Zeitraum');

  const basis = saeulen(data, {
    wert: d => d.orgasmen,
    farbe: () => 'var(--danger)',
    achse: v => fmtInt(v),
    klick: false,
    titel: d => `${d.label}: ${fmtInt(d.orgasmen)} ${d.orgasmen === 1 ? 'Orgasmus' : 'Orgasmen'}`
      + (d.abstand != null ? `, Ø Abstand ${fmtNum(d.abstand, 1)} T` : ''),
  });
  const g = basis.geometrie;
  const abstaende = data.filter(d => d.abstand != null).map(d => d.abstand);
  if (!abstaende.length) return basis.svg;

  // Auf eine runde Zahl aufgerundet: sonst klebt die Linie am oberen Rand und
  // sieht nach abgeschnitten aus statt nach „das ist der höchste Wert".
  const roh = Math.max(...abstaende, 1);
  const aStep = niceStep(roh);
  const aMax = Math.max(aStep, Math.ceil(roh / aStep) * aStep);
  const yOf = v => g.padT + g.innerH - (v / aMax) * g.innerH;
  const xOf = i => g.padL + g.xstep * (i + 0.5);

  // Die Linie bricht, wo kein Abstand vorliegt — durchzuziehen hieße, einen
  // Wert zu behaupten, den es in dem Zeitraum nicht gab.
  let pfad = '';
  let punkte = '';
  let offen = false;
  data.forEach((d, i) => {
    if (d.abstand == null) { offen = false; return; }
    const x = xOf(i).toFixed(1), y = yOf(d.abstand).toFixed(1);
    pfad += `${offen ? 'L' : 'M'} ${x} ${y} `;
    offen = true;
    punkte += `<circle cx="${x}" cy="${y}" r="2.6" fill="#c89060"><title>${d.label}: Ø Abstand ${fmtNum(d.abstand, 1)} T</title></circle>`;
  });

  let extra = `<path d="${pfad.trim()}" fill="none" stroke="#c89060" stroke-width="1.8" stroke-linejoin="round"/>${punkte}`;
  for (let i = 0; i <= 2; i++) {
    const v = (aMax * i) / 2;
    extra += `<text x="${g.W - g.padR + 2}" y="${(yOf(v) + 3).toFixed(1)}" font-size="9" fill="#c89060">${fmtInt(v)}</text>`;
  }
  // Die rechte Achse braucht Platz, den die Grundform nicht kennt.
  return basis.svg
    .replace(`viewBox="0 0 ${g.W} ${g.H}"`, `viewBox="0 0 ${g.W + 22} ${g.H}"`)
    .replace('</svg>', extra + '</svg>');
}

// =========================== TRAGEZEIT JE ZEITRAUM ===========================
/**
 * Gestapelte Stunden in den Modellfarben.
 *
 * Der Donut daneben zeigt die Aufteilung des ganzen Zeitraums; er kann nicht
 * zeigen, dass der eine Käfig im Frühjahr den anderen ersetzt hat. Gestapelt
 * statt nebeneinander, weil die Summe die zweite Aussage ist: wie viel von den
 * 24 Stunden eines Tages überhaupt erfasst war.
 */
export function stundenStackChart(days, settings, scale) {
  const data = aggregatePeriods(days, scale);
  if (!data.length) return leer('Noch keine Daten');
  const map = modelMap(settings);

  // Reihenfolge über alle Zeiträume gleich, sonst springen die Farben im Stapel.
  const summe = {};
  for (const d of data) for (const [id, h] of Object.entries(d.hours)) summe[id] = (summe[id] || 0) + h;
  const ids = Object.keys(summe)
    .filter(id => summe[id] > 0.004 && resolveModel(settings, map, id).kind !== KIND_ORGASM)
    .sort((a, b) => summe[b] - summe[a]);
  if (!ids.length) return leer('Noch keine Tragezeit');

  const W = 480, H = 200, padL = 40, padR = 8, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxSumme = Math.max(1, ...data.map(d => ids.reduce((s, id) => s + (d.hours[id] || 0), 0)));
  const step = niceStep(maxSumme);
  const yMax = Math.max(step, Math.ceil(maxSumme / step) * step);
  const yScale = innerH / yMax;
  const xstep = innerW / data.length;
  const barW = Math.max(2, Math.min(xstep * 0.8, 40));
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (let v = step; v <= yMax + 1e-9; v += step) {
    const y = padT + innerH - v * yScale;
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-opacity=".4" stroke-dasharray="2 3"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtInt(v)}</text>`;
  }
  svg += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--line)"/>`;
  data.forEach((d, i) => {
    const cx = padL + xstep * (i + 0.5);
    let unten = padT + innerH;
    for (const id of ids) {
      const h = d.hours[id] || 0;
      if (h <= 0.004) continue;
      const hoehe = h * yScale;
      const m = resolveModel(settings, map, id);
      svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(unten - hoehe).toFixed(1)}" width="${barW.toFixed(1)}" `
        + `height="${hoehe.toFixed(1)}" fill="${m.color}">`
        + `<title>${d.label} · ${escapeHtml(m.label)}: ${fmtNum(h, 1)} h</title></rect>`;
      unten -= hoehe;
    }
    if (i % labelEvery === 0) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.label}</text>`;
    }
  });
  svg += '</svg>';

  const legende = ids.map(id => {
    const m = resolveModel(settings, map, id);
    return `<span class="chart-legende-eintrag"><span class="dot" style="background:${m.color}"></span>${escapeHtml(m.label)}</span>`;
  }).join('');
  return svg + `<div class="chart-legende">${legende}</div>`;
}

// =========================== MUSTER NACH UHRZEIT ===========================
/**
 * Zu welcher Stunde eingetragen wird, über den ganzen Zeitraum.
 *
 * Das Wochentags-Diagramm beantwortet „an welchem Tag", diese Achse „zu welcher
 * Stunde". Getrennt nach Art des Eintrags, weil die interessante Frage nicht
 * ist, wann irgendetwas passiert, sondern wann geöffnet wird.
 */
const UHR_ARTEN = [
  { v: 'lock',  l: 'verschlossen',  farbe: 'var(--accent)' },
  { v: 'pause', l: 'Unterbrechung', farbe: '#8aa0b8' },
  { v: 'open',  l: 'offen',         farbe: 'var(--bad)' },
  { v: 'org',   l: 'Orgasmus',      farbe: 'var(--danger)' },
];

export function hourChart(days, settings) {
  const map = modelMap(settings);
  const stunden = Array.from({ length: 24 }, () => ({ lock: 0, pause: 0, open: 0, org: 0 }));
  let gesamt = 0;
  for (const d of days) {
    for (const ev of (d.events || [])) {
      const h = parseInt(String(ev.time).slice(0, 2), 10);
      if (!isFinite(h) || h < 0 || h > 23) continue;
      const m = resolveModel(settings, map, ev.type);
      const art = m.kind === KIND_ORGASM ? 'org' : m.locked ? 'lock' : m.pause ? 'pause' : 'open';
      stunden[h][art]++;
      gesamt++;
    }
  }
  if (!gesamt) return leer('Noch keine Einträge');

  const W = 480, H = 180, padL = 26, padR = 8, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(1, ...stunden.map(s => s.lock + s.pause + s.open + s.org));
  const step = niceStep(max);
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const yScale = innerH / yMax;
  const xstep = innerW / 24;
  const barW = Math.min(xstep * 0.78, 18);

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">`;
  for (let v = step; v <= yMax + 1e-9; v += step) {
    const y = padT + innerH - v * yScale;
    svg += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-opacity=".4" stroke-dasharray="2 3"/>`;
    svg += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtInt(v)}</text>`;
  }
  svg += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="var(--line)"/>`;
  stunden.forEach((s, h) => {
    const cx = padL + xstep * (h + 0.5);
    let unten = padT + innerH;
    const teile = UHR_ARTEN.map(a => `${a.l}: ${s[a.v]}`).filter((_, i) => s[UHR_ARTEN[i].v] > 0).join(', ');
    for (const a of UHR_ARTEN) {
      const n = s[a.v];
      if (!n) continue;
      const hoehe = n * yScale;
      svg += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(unten - hoehe).toFixed(1)}" width="${barW.toFixed(1)}" `
        + `height="${hoehe.toFixed(1)}" fill="${a.farbe}" rx="1">`
        + `<title>${String(h).padStart(2, '0')}:00 — ${teile}</title></rect>`;
      unten -= hoehe;
    }
    if (h % 3 === 0) {
      svg += `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${String(h).padStart(2, '0')}</text>`;
    }
  });
  svg += '</svg>';
  const legende = UHR_ARTEN.map(a =>
    `<span class="chart-legende-eintrag"><span class="dot" style="background:${a.farbe}"></span>${a.l}</span>`).join('');
  return svg + `<div class="chart-legende">${legende}</div>`;
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
export const LEER_FARBE = '#3a3024';

/**
 * Die Farbskala des Kalenders — abgeleitet aus den eigenen Sätzen, nicht fest
 * verdrahtet.
 *
 * Feste Schwellen (früher: „++ ab 25") messen an einem Maßstab, den die Datei
 * gar nicht kennt. Wer seinen Stundensatz halbiert, käme nie wieder über „+",
 * und wer ihn verdoppelt, hätte ab dem ersten Tag nur noch „+++" — die Farbe
 * sagte dann etwas über die Einstellungen aus statt über den Tag.
 *
 * Zwei Bezugsgrößen spannen die Skala auf:
 *   `voll` — ein Tag durchgehend verschlossen, ohne jeden Zuschlag
 *            (24 h × bester Satz eines verschlossenen Modells).
 *   `best` — der beste denkbare Tag: derselbe Tag mit vollem Ungeöffnet-Zuschlag
 *            und dem gedeckelten Streak-Multiplikator.
 *
 * Daraus die Bänder: ein ganzer verschlossener Tag ist „++" — nicht die
 * Ausnahme, sondern das, was ein guter Tag hier heißt. „+++" beginnt auf halbem
 * Weg von dort zum Maximum, ist also den Strecken und dem Multiplikator
 * vorbehalten. Mit den Standardsätzen: voll = 12, best = 38, „++" ab 12,
 * „+++" ab 25.
 */
/**
 * Eine Schwelle der Skala als Text. Krumme Sätze ergeben krumme Schwellen — dann
 * steht die Nachkommastelle da, sonst nicht. Typografisches Minus statt des
 * Bindestrichs aus `toLocaleString`: daneben steht „−−" als Zeichen, zwei
 * verschiedene Striche in einem Feld sähen nach Zufall aus.
 */
const schwelle = (n) => (Number.isInteger(n) ? fmtInt(n) : fmtNum(n, 1)).replace('-', '−');

export function heatScale(settings) {
  const saetze = settings.models
    .filter(m => m.kind !== KIND_ORGASM && m.locked && m.rate > 0)
    .map(m => m.rate);
  // Ohne einen verschlossenen Satz (alles auf 0 gestellt) bliebe die Skala
  // stehen. Dann trägt der Ungeöffnet-Zuschlag den Maßstab allein.
  const voll = saetze.length ? 24 * Math.max(...saetze) : Math.max(1, settings.points.bonusUngeoeffnetCap);
  const best = (voll + settings.points.bonusUngeoeffnetCap) * settings.points.streakCap;
  const spitze = (voll + best) / 2;
  const klein = voll / 4;
  return [
    { bis: -voll,    zeichen: '−−',  farbe: '#c2553f', vorn: '#fff',
      text: `unter ${schwelle(-voll)}` },
    { bis: 0,        zeichen: '−',   farbe: '#8a5a48', vorn: '#fff',
      text: `${schwelle(-voll)} bis 0` },
    { bis: klein,    zeichen: '0',   farbe: '#5a4b39', vorn: 'var(--text)',
      text: `0 bis ${schwelle(klein)}` },
    { bis: voll,     zeichen: '+',   farbe: '#3f5212', vorn: 'var(--accent)',
      text: `${schwelle(klein)} bis ${schwelle(voll)}` },
    { bis: spitze,   zeichen: '++',  farbe: '#65a30d', vorn: '#fff',
      text: `${schwelle(voll)} bis ${schwelle(spitze)}` },
    { bis: Infinity, zeichen: '+++', farbe: '#84cc16', vorn: '#1a1a0e',
      text: `ab ${schwelle(spitze)}` },
  ];
}

/** Das Band, in das ein Tagesergebnis fällt. `null` für „nichts erfasst". */
export function heatBand(netto, scale) {
  if (netto == null) return null;
  return scale.find(b => netto < b.bis) || scale[scale.length - 1];
}

/**
 * Die Legende mit den Zahlen, die gerade gelten — die Frage „nach was
 * berechnet sich die Farbe" soll unter dem Kalender beantwortet sein und nicht
 * im Quelltext.
 */
export function heatLegend(scale, settings) {
  const voll = scale[3].bis;
  const felder = scale.map(b => `<div class="hl" style="background:${b.farbe};color:${b.vorn}">
    <div class="z">${b.zeichen}</div><div class="r">${b.text}</div></div>`).join('');
  return `<div class="heat-legend">${felder}</div>
    <div class="legend" style="text-align:left">
      Die Farbe zeigt das <b>Tagesergebnis</b> in Punkten — dieselbe Zahl, die im
      Eintrag-Tab unter den Einträgen des Tages steht. Die Schwellen kommen aus deinen eigenen
      Sätzen: ein Tag durchgehend verschlossen bringt <b>${schwelle(voll)}</b> Punkte,
      und ab da ist ein Tag „++". „+++" beginnt bei <b>${schwelle(scale[4].bis)}</b>,
      also auf halbem Weg zum besten denkbaren Tag
      (${schwelle((voll + settings.points.bonusUngeoeffnetCap) * settings.points.streakCap)}
      Punkte, mit vollem Ungeöffnet-Zuschlag und Streak-Deckel).
      Ein leeres Kästchen heißt „nichts erfasst".
    </div>`;
}

export function heatmap(days, settings) {
  const gezaehlt = days.filter(d => d.zaehlt);
  if (!gezaehlt.length) return leer('Noch keine Daten');
  const scale = heatScale(settings);
  const byYear = {};
  for (const d of gezaehlt) (byYear[d.date.slice(0, 4)] ||= {})[d.date] = d;
  return Object.keys(byYear).sort().map(y => heatmapYear(y, byYear[y], scale)).join('');
}

function heatmapYear(year, byIso, scale) {
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
    const band = heatBand(rec ? rec.netto : null, scale);
    const titel = rec
      ? `${fmtDateShort(iso)}: ${fmtInt(rec.netto)} Punkte (${band.zeichen}), ${fmtNum(rec.verschlossenH, 1)} h verschlossen`
      : `${fmtDateShort(iso)}: nichts erfasst`;
    svg += `<rect class="hm-cell" data-iso="${iso}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" `
      + `fill="${band ? band.farbe : LEER_FARBE}" style="cursor:pointer"><title>${titel}</title></rect>`;
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
