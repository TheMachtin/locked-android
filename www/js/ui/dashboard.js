/**
 * Dashboard: der Rückblick.
 *
 * Zwei Kennzahlen tragen die Seite. Das **Konto** summiert alles seit dem
 * Stichtag und beantwortet „wie viel insgesamt". Die **Form** klingt mit 3 % pro
 * Tag ab und beantwortet „wie läuft es zuletzt" — sie hat einen Grenzwert und
 * bleibt dadurch über Jahre vergleichbar, während das Konto zwangsläufig wächst.
 *
 * Drei Blöcke stehen bewusst *außerhalb* des Zeitraums: „Jetzt", der
 * Orgasmus-Zähler und die beiden Kacheln Konto/Form. Sie beantworten Fragen an
 * die Gegenwart, und die ändert sich nicht dadurch, dass man daneben 2025
 * ausgewählt hat. Wo eine Kachel deshalb von ihrem Ausschnitt abweicht, sagt
 * sie es in ihrer Unterzeile.
 *
 * Ganz unten steht das Archiv der alten Ära, sofern die Datei eines enthält.
 */

import { STATE, calc } from '../state.js';
import {
  fmtInt, fmtNum, fmtSigned, fmtHours, fmtDateShort, fmtDurationShort, fmtMonth,
  escapeHtml, MONTHS_DE,
} from './format.js';
import {
  metricChart, orgasmusChart, stundenStackChart, hourChart, verlaufChart,
  modellDonut, heatmap, heatScale, heatLegend, weekdayChart, METRIKEN,
} from './charts.js';
import { emptyTotals, computeTotals, currentOrgasmPrice } from '../core/calc.js';
import { todayIso, resolveModel, modelMap, brichtStrecke, KIND_ORGASM } from '../core/settings.js';
import { eventMs } from '../core/time.js';
import { statusContext, currentModelHtml, statusRowHtml } from './status.js';
import {
  EBENEN, normalizeZeitraum, zeitraumMatch, zeitraumLabel, zeitraumText,
  zeitraumShift, zeitraumRange, kannBlaettern, defaultSkala, ankerBeimWechsel,
} from './zeitraum.js';

const $ = id => document.getElementById(id);
let zeitraum = normalizeZeitraum(null);
let skala = 'month';
let metrik = 'netto';
let detailsOffen = false;
let onDrilldown = () => {};

export function setDrilldownHandler(fn) { onDrilldown = fn; }

// =========================== GEMERKTER STAND ===========================
const LS_ZEITRAUM = 'locked_dash_zeitraum';
const LS_SKALA    = 'locked_dash_skala';
const LS_METRIK   = 'locked_dash_metrik';

function ladeStand() {
  try {
    const roh = localStorage.getItem(LS_ZEITRAUM);
    if (roh) zeitraum = normalizeZeitraum(JSON.parse(roh));
    else {
      // Der Vorgänger kannte nur Jahreszahlen. „2025" heißt jetzt Ebene Jahr
      // mit Anker 2025 — dieselbe Auskunft, nur in der neuen Form.
      const jahr = localStorage.getItem('locked_dash_year');
      if (jahr && jahr !== 'all') zeitraum = normalizeZeitraum({ ebene: 'year', anker: `${jahr}-01-01` });
    }
    const sk = localStorage.getItem(LS_SKALA);
    if (['month', 'week', 'day'].includes(sk)) skala = sk;
    else skala = defaultSkala(zeitraum.ebene);
    const me = localStorage.getItem(LS_METRIK);
    if (METRIKEN.some(m => m.v === me)) metrik = me;
  } catch {}
}
ladeStand();

function merkeStand() {
  try {
    localStorage.setItem(LS_ZEITRAUM, JSON.stringify(zeitraum));
    localStorage.setItem(LS_SKALA, skala);
    localStorage.setItem(LS_METRIK, metrik);
  } catch {}
}

// =========================== ZEITRAUM ===========================
/** Die Spanne, über die es überhaupt etwas zu blättern gibt. */
function grenzenVon(days) {
  const gezaehlt = days.filter(d => d.zaehlt);
  if (!gezaehlt.length) return null;
  const heute = todayIso();
  const bis = gezaehlt[gezaehlt.length - 1].date;
  return { von: gezaehlt[0].date, bis: bis > heute ? bis : heute };
}

function renderZeitraum(days) {
  const grenzen = grenzenVon(days);
  $('zeitraumEbene').innerHTML = EBENEN.map(e =>
    `<div class="seg-opt ${e.v === zeitraum.ebene ? 'active' : ''}" data-ebene="${e.v}">${e.l}</div>`).join('');
  $('zeitraumEbene').querySelectorAll('.seg-opt').forEach(o => o.addEventListener('click', () => {
    if (o.dataset.ebene === zeitraum.ebene) return;
    zeitraum = normalizeZeitraum({
      ebene: o.dataset.ebene,
      anker: ankerBeimWechsel(zeitraum, o.dataset.ebene, todayIso()),
    });
    // Ein Monat in Monatsbalken wäre ein einzelner Balken. Die Auflösung zieht
    // deshalb mit — verstellen kann man sie danach immer noch.
    skala = defaultSkala(zeitraum.ebene);
    merkeStand();
    render();
  }));

  const nav = $('zeitraumNav');
  nav.classList.toggle('hide', zeitraum.ebene === 'all');
  $('zrLabel').textContent = zeitraumLabel(zeitraum);
  for (const [id, dir] of [['zrPrev', -1], ['zrNext', 1]]) {
    const btn = $(id);
    btn.disabled = !kannBlaettern(zeitraum, dir, grenzen);
    btn.onclick = () => {
      if (!kannBlaettern(zeitraum, dir, grenzen)) return;
      zeitraum = zeitraumShift(zeitraum, dir);
      merkeStand();
      render();
    };
  }

  const r = zeitraumRange(zeitraum);
  $('zeitraumSub').textContent = r ? `${fmtDateShort(r.von)} – ${fmtDateShort(r.bis)}` : 'die ganze Historie';

  document.querySelectorAll('#chartScale .seg-opt').forEach(o =>
    o.classList.toggle('active', o.dataset.scale === skala));
}

// =========================== SEITE ===========================
export function render() {
  const { days, byDate, totals, settings, startedAt } = calc();
  renderZeitraum(days);

  const gefiltert = days.filter(d => zeitraumMatch(zeitraum, d.date));
  // Konto und Form laufen über die ganze Historie — ein Ausschnitt darf sie
  // nicht zurücksetzen, sonst stünde im Januar ein leeres Konto da. Alles
  // andere zählt nur den sichtbaren Ausschnitt.
  const t = gefiltert.length ? computeTotals(gefiltert) : emptyTotals();
  t.konto = totals.konto;
  t.form = totals.form;

  // Unter jeder Kachel steht, worauf sich ihre Zahl bezieht. „Ø pro Tag" allein
  // beantwortet die Frage nicht, die man dabei hat — Durchschnitt wovon, geteilt
  // durch welche Tage —, und bei einem Ausschnitt kommt dazu, dass Konto und
  // Form absichtlich über die ganze Historie laufen.
  const kachel = (v, l, sub) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div>`
    + (sub ? `<div class="l sub">${sub}</div>` : '')
    + '</div>';
  const abklang = fmtNum((1 - settings.points.formDecay) * 100, 0);
  const nenner = `÷ ${fmtInt(t.kalendertage)} ${t.kalendertage === 1 ? 'Kalendertag' : 'Kalendertage'}`;
  const ganzeHistorie = zeitraum.ebene !== 'all' ? 'ganze Historie · ' : '';
  $('dashKpis').innerHTML =
      kachel(fmtInt(totals.konto), 'Kontostand',
        ganzeHistorie + (startedAt ? 'seit ' + fmtDateShort(startedAt) : 'alles gezählt'))
    + kachel(fmtInt(totals.form), 'Form', ganzeHistorie + `klingt ${abklang} %/Tag ab`)
    + kachel(fmtNum(t.avgNetto, 1), 'Ø pro Tag', `Punkte ${nenner}`)
    + kachel(fmtInt(t.stundenVerschlossen), 'Std verschlossen', zeitraumText(zeitraum))
    + kachel(fmtNum(t.avgStdTag, 1), 'Ø Std/Tag', `verschlossen ${nenner}`)
    + kachel(fmtInt(t.orgasmen), 'Orgasmen', orgasmSub(t, zeitraum));

  renderJetzt(days, byDate, settings);
  renderOrgasmCounter(settings);

  $('verlaufChart').innerHTML = verlaufChart(gefiltert);

  const m = METRIKEN.find(x => x.v === metrik) || METRIKEN[0];
  $('metricSub').textContent = m.beschreibung;
  document.querySelectorAll('#chartMetric .seg-opt').forEach(o =>
    o.classList.toggle('active', o.dataset.metric === metrik));
  $('punkteChart').innerHTML = metricChart(gefiltert, skala, metrik);
  $('punkteChart').querySelectorAll('.bar-clickable').forEach(r =>
    r.addEventListener('click', () => onDrilldown(datumAusSchluessel(r.dataset.key))));

  const donut = modellDonut(t.hoursByModel, settings);
  $('modellDonut').innerHTML = donut.svg;
  // Die Zeit vor dem Stichtag ist nicht verschwunden, sie gehört nur zur alten
  // Ära — sie hier zu verschweigen wäre so irreführend wie sie einzumischen.
  const alt = STATE.data.legacy;
  $('modellList').innerHTML = donut.liste + (alt
    ? `<div class="small">Davor, in der alten Ära: ${fmtHours(alt.stundenVerschlossen)} verschlossen
       (${fmtDateShort(alt.von)}–${fmtDateShort(alt.bis)}).</div>`
    : '');
  $('stundenStack').innerHTML = stundenStackChart(gefiltert, settings, skala);

  $('orgasmusChart').innerHTML = orgasmusChart(gefiltert, skala);

  $('heatmap').innerHTML = heatmap(gefiltert, settings);
  $('heatmap').querySelectorAll('.hm-cell').forEach(c =>
    c.addEventListener('click', () => onDrilldown(c.dataset.iso)));
  $('heatLegend').innerHTML = heatLegend(heatScale(settings), settings);

  renderArchiv();
  if (detailsOffen) renderDetails(t, gefiltert, settings);
}

// =========================== JETZT ===========================
/**
 * Der laufende Zustand: Modell, Preis, die vier Uhren.
 *
 * Er stand einmal zusätzlich im Eintrag-Tab, und damit stand dieselbe Auskunft
 * zweimal in der App — die Seite zum Eintragen war ein zweites Dashboard.
 * Jetzt steht er nur hier. Der Block kommt aus `status.js`, die Live-Ansicht
 * (`jetzt.html`) benutzt denselben Code. Der Zeitraum gilt hier nicht: „jetzt"
 * ist jetzt, auch wenn daneben 2025 ausgewählt ist.
 */
function renderJetzt(days, byDate, settings) {
  const iso = todayIso();
  const ctx = statusContext(iso, { days, byDate, settings, events: STATE.data.events });
  $('jetztModell').innerHTML = currentModelHtml(ctx);
  $('jetztStreaks').innerHTML = statusRowHtml(ctx);

  const p = currentOrgasmPrice(STATE.data, settings, ctx.refMs);
  const box = $('jetztPreis');
  if (!p) { box.classList.add('hide'); return; }
  box.classList.remove('hide');
  const warte = isFinite(p.abstandTage)
    ? `${fmtNum(p.abstandTage, 1)} Tage seit dem letzten`
    : 'noch keiner erfasst';
  box.innerHTML = `<div><div class="l">${escapeHtml(p.model.label)} kostet gerade</div>
    <div class="l" style="opacity:.8">${warte}</div></div><div class="v">−${fmtInt(p.price)}</div>`;
}

// =========================== ORGASMUS-ZÄHLER ===========================
/**
 * Vier rollende Fenster.
 *
 * Der Zähler stand im Eintrag-Tab und beantwortete dort eine Frage, die
 * niemand beim Eintragen hat. Er gehört zum Rückblick — aber nicht zum
 * Zeitraum daneben: „letzte 30 Tage" heißt immer die letzten 30 Tage, sonst
 * stünde bei ausgewähltem 2025 eine 0 darin, die nichts bedeutet.
 */
function renderOrgasmCounter(s) {
  const map = modelMap(s);
  const jetzt = new Date();
  const refMs = jetzt.getTime();
  // Gezählt wird, was ein Orgasmus ist. Ein Ereignis, das die Strecke nicht
  // bricht, steht in denselben vier Fenstern falsch — „letzte 30 T: 2" neben
  // einer Kachel „Orgasmusfrei: 40 T" wäre ein Widerspruch auf einem Bildschirm.
  // Verschwiegen wird es deshalb nicht: es steht in der Zeile darunter.
  const ereignisse = (STATE.data.events || [])
    .map(e => ({ e, t: eventMs(e), m: resolveModel(s, map, e.type) }))
    .filter(x => x.m.kind === KIND_ORGASM && isFinite(x.t) && x.t <= refMs)
    .sort((a, b) => a.t - b.t);
  const alle = ereignisse.filter(x => brichtStrecke(x.m));
  const sonstige = ereignisse.length - alle.length;

  const monat = todayIso().slice(0, 7);
  const letzter = alle[alle.length - 1] || null;
  const fenster = tage => alle.filter(x => x.t >= refMs - tage * 86400000).length;
  const avgGap = alle.length >= 2 ? (letzter.t - alle[0].t) / (alle.length - 1) : null;

  const kachel = (v, l, sub) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div>`
    + (sub ? `<div class="l sub">${sub}</div>` : '') + '</div>';
  $('orgCounter').innerHTML =
      kachel(fmtInt(alle.filter(x => x.e.date.startsWith(monat)).length),
        MONTHS_DE[parseInt(monat.slice(5), 10) - 1], 'laufender Monat')
    + kachel(fmtInt(fenster(30)), 'letzte 30 T')
    + kachel(fmtInt(fenster(90)), 'letzte 90 T')
    + kachel(letzter ? fmtDurationShort(refMs - letzter.t) : '—', 'seit letztem',
        letzter ? `${fmtDateShort(letzter.e.date)} ${letzter.e.time}` : 'keiner erfasst');

  // Die beiden längeren Maßstäbe stehen als Zeile statt als Kachel: sie
  // beantworten dieselbe Frage eine Stufe gröber und sollen die vier Zahlen
  // darüber nicht verdünnen.
  const auto = alle.filter(x => x.e.auto_inactivity).length;
  const teile = [`Letzte 365 Tage: <b>${fmtInt(fenster(365))}</b>`];
  if (avgGap != null) teile.push(`Ø Abstand: <b>${fmtNum(avgGap / 86400000, 1)} T</b>`);
  if (alle.length) teile.push(`erfasst: <b>${fmtInt(alle.length)}</b>`);
  if (auto) teile.push(`${auto} automatisch (Inaktivität)`);
  if (sonstige) teile.push(`dazu <b>${fmtInt(sonstige)}</b> ohne Bruch der Strecke`);
  $('orgLast').innerHTML = (alle.length || sonstige)
    ? teile.join(' · ')
    : 'Noch kein Orgasmus erfasst.';
}

/**
 * Die Unterzeile der Orgasmus-Kachel.
 *
 * Die Kosten stehen für *alle* bepreisten Ereignisse, die Zahl darüber nur für
 * die Orgasmen — ohne den Zusatz stünde da ein Betrag, den die Zahl daneben
 * nicht erklärt.
 */
function orgasmSub(t, zeitraum) {
  if (!t.orgasmKosten) return zeitraumText(zeitraum);
  return `−${fmtInt(t.orgasmKosten)} Punkte`
    + (t.sonstigeEreignisse ? ` · dazu ${fmtInt(t.sonstigeEreignisse)} ohne Bruch der Strecke` : '');
}

function datumAusSchluessel(key) {
  if (skala === 'month') return `${key}-01`;
  if (skala === 'day') return key;
  // ISO-Kalenderwoche → Montag dieser Woche
  const [jahr, kw] = key.split('-W');
  const jan4 = new Date(parseInt(jahr, 10), 0, 4, 12, 0, 0);
  const montag1 = new Date(jan4);
  montag1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const ziel = new Date(montag1);
  ziel.setDate(montag1.getDate() + (parseInt(kw, 10) - 1) * 7);
  return `${ziel.getFullYear()}-${String(ziel.getMonth() + 1).padStart(2, '0')}-${String(ziel.getDate()).padStart(2, '0')}`;
}

// =========================== ARCHIV ===========================
/**
 * Die alte Ära. Sie steht nur da, wenn die Datei einen Schnappschuss enthält —
 * wer die App frisch installiert, sieht diese Karte nie.
 */
function renderArchiv() {
  const card = $('archivCard');
  const l = STATE.data.legacy;
  if (!l) { card.classList.add('hide'); return; }
  card.classList.remove('hide');
  const zeile = (l1, v) => `<div class="row"><span>${l1}</span><b>${v}</b></div>`;
  // `bestUoStreak` heißt „ungeöffnet", meint aber die 1.x-Definition: *kein
  // Eintrag an dem Tag*. Mit der Kachel „Ungeöffnet" im Block „Jetzt" hat das
  // nichts zu tun — unter demselben Namen stünden zwei verschiedene Zahlen in
  // derselben App. Das Feld in der Datei bleibt, die Zeile heißt anders.
  $('archivBody').innerHTML = `
    <div class="stamp">Formel 1.x · abgeschlossen</div>
    <div class="gross">${fmtInt(l.punkte)}</div>
    <div class="small" style="margin-top:0">Punkte vom ${fmtDateShort(l.von)} bis ${fmtDateShort(l.bis)}</div>
    <div class="breakdown" style="border-top:none;padding-top:8px">
      ${zeile('Kalendertage', fmtInt(l.kalendertage))}
      ${zeile('Tage mit Einträgen', fmtInt(l.tage))}
      ${zeile('Stunden verschlossen', fmtHours(l.stundenVerschlossen))}
      ${zeile('Orgasmen', fmtInt(l.orgasmen))}
      ${zeile('Längste orgasmusfreie Strecke', `${fmtInt(l.bestOfStreak.days)} T`)}
      ${zeile('Längste Strecke ohne Eintrag', `${fmtInt(l.bestUoStreak.days)} T`)}
    </div>
    <div class="small">Eingefroren am ${fmtDateShort((l.eingefrorenAm || '').slice(0, 10))}.
      Diese Zahlen ändern sich nicht mehr — die alte Streak-Formel wuchs exponentiell
      und ließ sich mit den neuen Punkten nicht sinnvoll vergleichen.</div>`;
}

// =========================== DETAILS ===========================
function renderDetails(t, gefiltert, settings) {
  $('monthTable').innerHTML = t.monatlich.length
    ? `<table class="tbl"><thead><tr><th>Monat</th><th>Tage</th><th>Std</th><th>Ein</th><th>Aus</th><th>Netto</th></tr></thead><tbody>`
      + t.monatlich.slice().reverse().map(m => `<tr>
          <td>${fmtMonth(m.month)}</td><td>${m.tage}</td><td>${fmtInt(m.stunden)}</td>
          <td class="pos">${fmtInt(m.einnahmen)}</td><td class="neg">${fmtInt(m.kosten)}</td>
          <td><b class="${m.netto < 0 ? 'neg' : 'pos'}">${fmtSigned(m.netto)}</b></td></tr>`).join('')
      + '</tbody></table>'
    : '<div class="empty">Noch keine Monate</div>';

  const r = (l, v) => `<div class="rec"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  $('records').innerHTML =
      r('Bester Tag', fmtSigned(t.besterTag))
    + r('Schlechtester Tag', fmtSigned(t.schlechtesterTag))
    + r('Längste orgasmusfreie Strecke', `${t.bestOfStreak.days} T`
        + (t.bestOfStreak.end ? ` <span style="color:var(--muted);font-size:11px">bis ${fmtDateShort(t.bestOfStreak.end)}</span>` : ''))
    + r('Längste ungeöffnete Strecke', `${t.bestUoStreak.days} T`
        + (t.bestUoStreak.end ? ` <span style="color:var(--muted);font-size:11px">bis ${fmtDateShort(t.bestUoStreak.end)}</span>` : ''))
    + r('Volle Tage ungeöffnet', fmtInt(t.tageUngeoeffnet) + (t.uoEinnahmen
        ? ` <span style="color:var(--muted);font-size:11px">+${fmtInt(t.uoEinnahmen)} Punkte</span>` : ''))
    + r('Tage mit Orgasmus', fmtInt(t.tageMitOrgasmus))
    + r('Einnahmen gesamt', fmtInt(t.einnahmen))
    + r('Kosten gesamt', fmtInt(t.kosten));

  $('weekdayChart').innerHTML = weekdayChart(t.byWeekday);
  $('hourChart').innerHTML = hourChart(gefiltert, settings);
}

export function initDashboard() {
  document.querySelectorAll('#chartScale .seg-opt').forEach(o => o.addEventListener('click', () => {
    skala = o.dataset.scale;
    merkeStand();
    render();
  }));
  document.querySelectorAll('#chartMetric .seg-opt').forEach(o => o.addEventListener('click', () => {
    metrik = o.dataset.metric;
    merkeStand();
    render();
  }));
  $('detailsToggle').addEventListener('click', () => {
    detailsOffen = !detailsOffen;
    $('detailsSection').classList.toggle('hide', !detailsOffen);
    $('detailsToggle').textContent = detailsOffen ? 'Details ausblenden ▴' : 'Details anzeigen ▾';
    if (detailsOffen) render();
  });
}
