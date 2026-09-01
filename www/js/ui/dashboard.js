/**
 * Dashboard: der Rückblick.
 *
 * Zwei Kennzahlen tragen die Seite. Das **Konto** summiert alles seit dem
 * Stichtag und beantwortet „wie viel insgesamt". Die **Form** klingt mit 3 % pro
 * Tag ab und beantwortet „wie läuft es zuletzt" — sie hat einen Grenzwert und
 * bleibt dadurch über Jahre vergleichbar, während das Konto zwangsläufig wächst.
 *
 * Ganz unten steht das Archiv der alten Ära, sofern die Datei eines enthält.
 */

import { STATE, calc } from '../state.js';
import { fmtInt, fmtNum, fmtSigned, fmtHours, fmtDateShort, fmtMonth } from './format.js';
import { nettoChart, verlaufChart, modellDonut, heatmap, weekdayChart } from './charts.js';
import { emptyTotals, computeTotals } from '../core/calc.js';

const $ = id => document.getElementById(id);
let jahrFilter = 'all';
let skala = 'month';
let detailsOffen = false;
let onDrilldown = () => {};

export function setDrilldownHandler(fn) { onDrilldown = fn; }

try { jahrFilter = localStorage.getItem('locked_dash_year') || 'all'; } catch {}

function passtZumJahr(d) { return jahrFilter === 'all' || d.date.startsWith(jahrFilter); }

function renderJahrFilter(days) {
  const jahre = [...new Set(days.filter(d => d.zaehlt).map(d => d.date.slice(0, 4)))].sort().reverse();
  const opts = ['all', ...jahre];
  if (!jahre.length || (jahrFilter !== 'all' && !jahre.includes(jahrFilter))) jahrFilter = 'all';
  const seg = $('yearFilter');
  seg.innerHTML = opts.map(y =>
    `<div class="seg-opt ${y === jahrFilter ? 'active' : ''}" data-year="${y}">${y === 'all' ? 'Alle' : y}</div>`).join('');
  seg.querySelectorAll('.seg-opt').forEach(o => o.addEventListener('click', () => {
    jahrFilter = o.dataset.year;
    try { localStorage.setItem('locked_dash_year', jahrFilter); } catch {}
    render();
  }));
}

export function render() {
  const { days, totals, settings, startedAt } = calc();
  renderJahrFilter(days);

  const gefiltert = days.filter(passtZumJahr);
  // Konto und Form laufen über die ganze Historie — ein Jahresfilter darf sie
  // nicht zurücksetzen, sonst stünde im Januar ein leeres Konto da. Alles
  // andere zählt nur den sichtbaren Ausschnitt.
  const t = gefiltert.length ? computeTotals(gefiltert) : emptyTotals();
  t.konto = totals.konto;
  t.form = totals.form;

  const kachel = (v, l, sub) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div>`
    + (sub ? `<div class="l" style="text-transform:none;letter-spacing:0;font-size:11px;margin-top:2px">${sub}</div>` : '')
    + '</div>';
  $('dashKpis').innerHTML =
      kachel(fmtInt(totals.konto), 'Kontostand',
        jahrFilter !== 'all' ? 'gesamt' : (startedAt ? 'seit ' + fmtDateShort(startedAt) : 'alles gezählt'))
    + kachel(fmtInt(totals.form), 'Form', 'Trend zuletzt')
    + kachel(fmtNum(t.avgNetto, 1), 'Ø pro Tag')
    + kachel(fmtInt(t.stundenVerschlossen), 'Std verschlossen')
    + kachel(fmtNum(t.avgStdTag, 1), 'Ø Std/Tag')
    + kachel(fmtInt(t.orgasmen), 'Orgasmen', t.orgasmKosten ? `−${fmtInt(t.orgasmKosten)} Punkte` : '');

  $('verlaufChart').innerHTML = verlaufChart(gefiltert);
  $('punkteChart').innerHTML = nettoChart(gefiltert, skala);
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

  $('heatmap').innerHTML = heatmap(gefiltert);
  $('heatmap').querySelectorAll('.hm-cell').forEach(c =>
    c.addEventListener('click', () => onDrilldown(c.dataset.iso)));

  renderArchiv();
  if (detailsOffen) renderDetails(t);
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
      ${zeile('Längste ungeöffnete Strecke', `${fmtInt(l.bestUoStreak.days)} T`)}
    </div>
    <div class="small">Eingefroren am ${fmtDateShort((l.eingefrorenAm || '').slice(0, 10))}.
      Diese Zahlen ändern sich nicht mehr — die alte Streak-Formel wuchs exponentiell
      und ließ sich mit den neuen Punkten nicht sinnvoll vergleichen.</div>`;
}

// =========================== DETAILS ===========================
function renderDetails(t) {
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
    + r('Tage durchgehend verschlossen', fmtInt(t.tageDurchgehend))
    + r('Tage mit Orgasmus', fmtInt(t.tageMitOrgasmus))
    + r('Einnahmen gesamt', fmtInt(t.einnahmen))
    + r('Kosten gesamt', fmtInt(t.kosten));

  $('weekdayChart').innerHTML = weekdayChart(t.byWeekday);
}

export function initDashboard() {
  document.querySelectorAll('#chartScale .seg-opt').forEach(o => o.addEventListener('click', () => {
    document.querySelectorAll('#chartScale .seg-opt').forEach(x => x.classList.remove('active'));
    o.classList.add('active');
    skala = o.dataset.scale;
    render();
  }));
  $('detailsToggle').addEventListener('click', () => {
    detailsOffen = !detailsOffen;
    $('detailsSection').classList.toggle('hide', !detailsOffen);
    $('detailsToggle').textContent = detailsOffen ? 'Details ausblenden ▴' : 'Details anzeigen ▾';
    if (detailsOffen) render();
  });
}
