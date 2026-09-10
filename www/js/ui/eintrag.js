/**
 * Eintrag-Seite: der Bildschirm, der im Alltag benutzt wird.
 *
 * Er beantwortet genau zwei Fragen: *was trage ich ein* und *was steht heute
 * schon drin*. Deshalb steht der Schnelleintrag ganz oben und darunter die
 * Einträge des gewählten Tages, sonst nichts. Der laufende Zustand — Modell,
 * die vier Uhren, Preis, Konto, Form — stand hier einmal zusätzlich und war
 * damit ein zweites Dashboard; er steht jetzt nur noch dort, in der Karte
 * „Jetzt", und kommt in beiden Fällen aus `ui/status.js`.
 *
 * Geblieben ist das Tagesergebnis, aber als Fußzeile der Einträge: die Zahl
 * gehört zu dem, was darüber steht, und ihre Aufschlüsselung kommt direkt aus
 * `scoreDay()` — Anzeige und Rechnung können so nicht auseinanderlaufen.
 */

import { STATE, calc, mutate, withUndo, settings as getSettings } from '../state.js';
import { showToast } from './toast.js';
import {
  fmtInt, fmtNum, fmtSigned, fmtDateShort, fmtDurationShort,
  fmtCountdownHM, fmtCountdownDH, escapeHtml, weekdayOf,
} from './format.js';
import { dayTimeline } from './charts.js';
import { isoOf, isoDateAdd, hmOf } from '../core/time.js';
import { regenState, expiredRegenEvents } from '../core/calc.js';
import { resolveModel, modelMap, KIND_ORGASM } from '../core/settings.js';
import { pendingEscalation, escalationEvents } from '../core/escalation.js';

const $ = id => document.getElementById(id);
let gewaehltesDatum = isoOf(new Date());
let aufschluesselungOffen = false;
let onNachEintrag = () => {};

export function setDate(iso) { gewaehltesDatum = iso; }
export function getDate() { return gewaehltesDatum; }
export function setEntryHook(fn) { onNachEintrag = fn; }

const heute = () => isoOf(new Date());

// =========================== SCHNELLEINTRAG ===========================
/** Tasten aus der Registry aufbauen. Archivierte Modelle bleiben draußen. */
function renderQuickButtons() {
  const s = getSettings();
  const wrap = $('quick');
  const aktiv = s.models.filter(m => !m.archived);
  const modelle = aktiv.filter(m => m.kind !== KIND_ORGASM && !m.regen);
  const regen = aktiv.find(m => m.regen);
  const orgasmen = aktiv.filter(m => m.kind === KIND_ORGASM);

  // Ungerade Anzahl in einem Zweispalter ließe eine Lücke — die letzte Taste
  // bekommt dann die volle Breite.
  const voll = modelle.length % 2 === 1;
  let html = modelle.map((m, i) => taste(m, voll && i === modelle.length - 1)).join('');
  if (regen) html += taste(regen, true, `<div class="qb-sub" data-sub="${regen.id}">verfügbar</div>`);
  html += orgasmen.map(m => taste(m, true)).join('');
  wrap.innerHTML = html;

  wrap.querySelectorAll('.qb').forEach(bindHold);
  renderRegenButton();
}

function taste(m, voll, extra) {
  const klassen = ['qb'];
  if (m.kind === KIND_ORGASM) klassen.push('danger');
  else if (m.regen) klassen.push('regen');
  else klassen.push('go');
  if (voll) klassen.push('span-all');
  const rand = m.kind === KIND_ORGASM || m.regen ? '' : `style="--qb-farbe:${m.color}"`;
  return `<button class="${klassen.join(' ')}" data-model="${escapeHtml(m.id)}" type="button" ${rand}>
    <span class="hold-fill"></span>
    <div class="qb-main">${escapeHtml(m.label)}</div>${extra || ''}
  </button>`;
}

/** Gedrückt halten statt tippen: ein Fehlgriff in der Hosentasche wäre sonst ein Eintrag. */
const HOLD_MS = 800;
function bindHold(btn) {
  let timer = null;
  let ausgeloest = false;
  const start = (e) => {
    if (btn.disabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ausgeloest = false;
    btn.classList.add('holding');
    timer = setTimeout(() => {
      ausgeloest = true;
      btn.classList.remove('holding');
      timer = null;
      addEvent(btn.dataset.model, hmOf(new Date()));
      if (navigator.vibrate) navigator.vibrate(30);
    }, HOLD_MS);
  };
  const abbruch = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    btn.classList.remove('holding');
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', abbruch);
  btn.addEventListener('pointercancel', abbruch);
  btn.addEventListener('pointerleave', abbruch);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!ausgeloest && !timer) showToast('Halten zum Speichern');
  });
}

export function addEvent(typ, zeit) {
  const s = getSettings();
  const m = resolveModel(s, modelMap(s), typ);
  mutate(data => {
    data.events.push({ date: gewaehltesDatum, time: zeit, type: typ });
    data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  });
  // Auf einem anderen Tag als heute muss die Meldung das Datum nennen: die
  // Tasten stehen über der Datumswahl, und ein stiller Eintrag auf den Vortag
  // fällt erst Tage später auf.
  const wo = gewaehltesDatum === heute() ? '' : ` am ${fmtDateShort(gewaehltesDatum)}`;
  if (m.kind === KIND_ORGASM) {
    const heutige = calc().byDate[gewaehltesDatum];
    const letzter = heutige && heutige.orgasmen[heutige.orgasmen.length - 1];
    showToast(letzter ? `${m.label}${wo} — ${fmtInt(letzter.price)} Punkte` : m.label + wo, true);
  } else {
    showToast(`${m.label} ${zeit}${wo}`);
  }
  onNachEintrag();
}

/**
 * Der Hinweis über den Tasten, wenn ein anderer Tag als heute gewählt ist.
 *
 * Die Reihenfolge auf der Seite macht ihn nötig: die Tasten stehen oben, die
 * Datumswahl darunter. Ohne die Warnung landet ein Eintrag stillschweigend auf
 * dem Tag, den man vorhin zum Nachsehen ausgewählt hat.
 */
function renderQuickHinweis() {
  const anders = gewaehltesDatum !== heute();
  $('quickDatumHinweis').classList.toggle('hide', !anders);
  $('quickSub').textContent = anders ? 'auf einen anderen Tag' : 'jetzt';
  if (anders) {
    $('quickDatumText').innerHTML =
      `Trägt auf <b>${weekdayOf(gewaehltesDatum)}, ${fmtDateShort(gewaehltesDatum)}</b> ein — mit der Uhrzeit von jetzt.`;
  }
}

// =========================== REGENERATION ===========================
function renderRegenButton() {
  const s = getSettings();
  const reg = s.models.find(m => m.regen && !m.archived);
  if (!reg) return;
  const btn = document.querySelector(`.qb[data-model="${reg.id}"]`);
  if (!btn) return;
  const sub = btn.querySelector('.qb-sub');
  const st = regenState(STATE.data, s);
  btn.classList.remove('regen-available', 'regen-active', 'regen-cooldown');
  if (st.state === 'available') {
    btn.disabled = false;
    btn.classList.add('regen-available');
    if (sub) sub.textContent = 'verfügbar';
  } else if (st.state === 'active') {
    btn.disabled = true;
    btn.classList.add('regen-active');
    if (sub) sub.textContent = `läuft ${fmtCountdownHM(st.deadlineMs)}`;
  } else {
    btn.disabled = true;
    btn.classList.add('regen-cooldown');
    if (sub) sub.textContent = `wieder in ${fmtCountdownDH(st.remainMs)}`;
  }
}

/** Abgelaufene Regenerationen nachtragen. Läuft beim Rendern mit. */
export function processExpiredRegens() {
  const s = getSettings();
  const fehlend = expiredRegenEvents(STATE.data, s);
  if (!fehlend.length) return false;
  const offen = resolveModel(s, modelMap(s), fehlend[0].type);
  mutate(data => {
    data.events.push(...fehlend);
    data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, { silent: true });
  showToast(`Regeneration abgelaufen — ${offen.label} eingetragen`, true);
  return true;
}

// =========================== TAG UND ERGEBNIS ===========================
function renderTagKopf() {
  const iso = gewaehltesDatum;
  $('datum').value = iso;
  $('wochentag').textContent = weekdayOf(iso);
  $('evDateLabel').textContent = fmtDateShort(iso);
  document.querySelectorAll('#datePills .pill').forEach(p => {
    p.classList.toggle('active', isoDateAdd(heute(), parseInt(p.dataset.offset, 10)) === iso);
  });
}

/**
 * Die Fußzeile der Einträge: eine Zahl, die Aufschlüsselung auf Klick.
 *
 * Sie war einmal die große Zahl über der halben Seite. Was sie sagt, ändert
 * sich dadurch nicht — nur, dass sie jetzt bei dem steht, woraus sie entsteht.
 */
function renderTagesergebnis() {
  const { byDate } = calc();
  const s = getSettings();
  const d = byDate[gewaehltesDatum];
  const netto = d && d.zaehlt ? d.netto : 0;

  const num = $('dayResultNum');
  num.textContent = d ? fmtSigned(netto) : '—';
  num.classList.toggle('neg', !!d && netto < 0);
  num.classList.toggle('zero', !d || netto === 0);
  $('dayResultLabel').textContent = d && !d.zaehlt ? 'vor dem Stichtag' : 'Tagesergebnis';

  const html = d ? breakdownHtml(d, s) : '';
  const box = $('dayBreakdown');
  box.innerHTML = html;
  const zeigbar = !!html;
  $('dayResult').classList.toggle('leer', !zeigbar);
  box.classList.toggle('hide', !(zeigbar && aufschluesselungOffen));
  $('dayResultChev').textContent = zeigbar && aufschluesselungOffen ? '▴' : '▾';
}

/** Die Aufschlüsselung des Tages, Zeile für Zeile. */
function breakdownHtml(d, s) {
  if (!d.zaehlt) {
    return `<div class="breakdown"><div class="row hint">Dieser Tag liegt vor dem Stichtag
      (${fmtDateShort(calc().startedAt)}) und zählt nicht ins Konto. Stunden und
      Orgasmen werden trotzdem erfasst.</div></div>`;
  }
  const zeilen = [];
  const map = modelMap(s);
  const stunden = Object.entries(d.hours)
    .filter(([, h]) => h > 0.004)
    .map(([id, h]) => ({ m: resolveModel(s, map, id), h }))
    .sort((a, b) => b.h - a.h);

  for (const x of stunden) {
    if (!x.m.rate) continue;
    const betrag = x.h * x.m.rate;
    zeilen.push(zeile(`${escapeHtml(x.m.label)} · ${fmtNum(x.h, 1)} h × ${fmtNum(x.m.rate, 2)}`,
      betrag, betrag >= 0 ? 'plus' : 'minus'));
  }
  // Eine Unterbrechung hat den Satz 0 und fiele aus der Aufschlüsselung heraus —
  // zusammen mit der Erklärung, warum die Stunden nirgends auftauchen.
  if (d.pauseH > 0.004) {
    const namen = stunden.filter(x => x.m.pause).map(x => escapeHtml(x.m.label)).join(', ')
      || 'Unterbrechung';
    zeilen.push(`<div class="row hint"><span>${namen} · ${fmtNum(d.pauseH, 1)} h`
      + ` — zählt nicht als offen</span><b>±0</b></div>`);
  }
  if (d.uoBonus) {
    const deckel = d.uoBonus >= s.points.bonusUngeoeffnetCap ? ' <span class="hint">(Deckel)</span>' : '';
    zeilen.push(zeile(`Ungeöffnet · ${d.uoTage}. Tag am Stück${deckel}`, d.uoBonus, 'plus'));
  }
  if (d.mult !== 1) {
    // Alles, worauf der Multiplikator wirkt, muss hier abgezogen werden —
    // sonst stünde der Ungeöffnet-Zuschlag zweimal in der Liste und die Zeilen
    // summierten sich nicht mehr auf das Tagesergebnis.
    zeilen.push(zeile(`Streak-Multiplikator × ${fmtNum(d.mult, 2)}`,
      d.einnahmen - (d.verdienstBasis + d.uoBonus), 'plus'));
  }
  for (const o of d.orgasmen) {
    const wartezeit = isFinite(o.abstandTage) ? `nach ${fmtNum(o.abstandTage, 1)} T` : 'erster erfasster';
    zeilen.push(zeile(`${escapeHtml(o.model.label)} ${o.event.time} · ${wartezeit}`, -o.price, 'minus'));
  }
  if (!zeilen.length) return '';
  zeilen.push(`<div class="row sum"><span>Tagesergebnis</span><span>${fmtSigned(d.netto)}</span></div>`);
  return `<div class="breakdown">${zeilen.join('')}</div>`;
}
function zeile(label, betrag, klasse) {
  return `<div class="row ${klasse}"><span>${label}</span><b>${fmtSigned(betrag, Math.abs(betrag) < 10 ? 1 : 0)}</b></div>`;
}

// =========================== EINTRÄGE ===========================
function renderEvents() {
  const s = getSettings();
  const map = modelMap(s);
  const iso = gewaehltesDatum;
  const { byDate } = calc();
  const d = byDate[iso];
  const wrap = $('events');

  const evs = (STATE.data.events || []).filter(e => e.date === iso)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  $('dayTimeline').innerHTML = d
    ? dayTimeline(d, s, iso === heute() ? new Date().getHours() * 60 + new Date().getMinutes() : 1440)
    : '';

  if (!evs.length) {
    if (!d) { wrap.innerHTML = '<div class="empty" style="text-align:center">Noch keine Einträge</div>'; return; }
    const carry = resolveModel(s, map, d.prevEndModel);
    wrap.innerHTML = `<div class="ev carry">
      <span class="tag" style="background:${carry.color}22;color:${carry.color};border-color:${carry.color}">${escapeHtml(carry.id)}</span>
      <span style="color:var(--muted);font-size:13px"><b style="color:var(--text)">${escapeHtml(carry.label)}</b> · läuft vom Vortag durch</span>
      <span style="color:var(--muted);font-size:12px">durchgehend</span><span></span></div>`;
    return;
  }

  const optionen = s.models.filter(m => !m.archived || evs.some(e => e.type === m.id));
  wrap.innerHTML = '';
  for (const ev of evs) {
    const m = resolveModel(s, map, ev.type);
    const row = document.createElement('div');
    row.className = 'ev' + (ev.time_estimated ? ' estimated' : '');
    const opts = optionen.map(o =>
      `<option value="${escapeHtml(o.id)}" ${o.id === ev.type ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')
      + (optionen.some(o => o.id === ev.type) ? '' : `<option value="${escapeHtml(ev.type)}" selected>${escapeHtml(ev.type)} (unbekannt)</option>`);
    const auto = ev.auto_inactivity || ev.auto_regen_timeout;
    row.innerHTML = `
      <select class="tag-select ${m.kind === KIND_ORGASM ? 'danger' : (m.regen ? 'warm' : '')}" title="Modell ändern">${opts}</select>
      <span style="color:var(--muted);font-size:13px">${escapeHtml(m.label)}${ev.time_estimated ? ' <i>(geschätzt)</i>' : ''}${auto ? ' <i>(automatisch)</i>' : ''}</span>
      <input type="time" value="${ev.time}">
      <button class="del" title="Entfernen" type="button">×</button>`;

    row.querySelector('select').addEventListener('change', e => {
      const neu = e.target.value;
      mutate(data => {
        const ziel = data.events.find(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
        if (ziel) ziel.type = neu;
      });
    });
    row.querySelector('input').addEventListener('change', e => {
      const neu = e.target.value;
      if (!/^\d{2}:\d{2}$/.test(neu)) return;
      mutate(data => {
        const ziel = data.events.find(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
        if (!ziel) return;
        ziel.time = neu;
        delete ziel.time_estimated;
        data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      });
    });
    row.querySelector('.del').addEventListener('click', () => {
      withUndo(() => {
        mutate(data => {
          const i = data.events.findIndex(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
          if (i >= 0) data.events.splice(i, 1);
        });
      }, showToast, `${m.label} ${ev.time} entfernt`);
    });
    wrap.appendChild(row);
  }
}

// =========================== INAKTIVITÄT ===========================
function renderEscalation() {
  const card = $('escalationCard');
  const v = pendingEscalation(STATE.data, { settings: getSettings() });
  if (!v.faellig) { card.classList.add('hide'); return; }
  const s = getSettings();
  const map = modelMap(s);
  const teile = [];
  if (v.offen) {
    teile.push(`<b>${escapeHtml(resolveModel(s, map, v.offen.type).label)}</b> ab ${fmtDateShort(v.offen.date)} ${v.offen.time}`);
  }
  if (v.orgasmen.length) {
    const von = fmtDateShort(v.orgasmen[0].date);
    const bis = fmtDateShort(v.orgasmen[v.orgasmen.length - 1].date);
    teile.push(`<b>${v.orgasmen.length}×&nbsp;${escapeHtml(resolveModel(s, map, v.orgasmen[0].type).label)}</b> (${von}${v.orgasmen.length > 1 ? '–' + bis : ''})`);
  }
  $('escalationSince').textContent = 'seit ' + fmtDurationShort(v.seitMs);
  $('escalationText').innerHTML =
    `Die Inaktivitäts-Regel würde eintragen: ${teile.join(' und ')}. `
    + `Übernehmen schreibt ${v.anzahl === 1 ? '1 Eintrag' : v.anzahl + ' Einträge'} in deine Daten, `
    + `Verwerfen setzt die Frist neu.`;
  card.classList.remove('hide');
}

// =========================== AUFBAU ===========================
export function initEintrag() {
  $('datum').addEventListener('change', e => {
    if (e.target.value) { gewaehltesDatum = e.target.value; render(); }
  });
  document.querySelectorAll('#datePills .pill').forEach(p => {
    p.addEventListener('click', () => {
      gewaehltesDatum = isoDateAdd(heute(), parseInt(p.dataset.offset, 10));
      render();
    });
  });
  $('quickHeute').addEventListener('click', () => {
    gewaehltesDatum = heute();
    render();
  });
  $('dayResult').addEventListener('click', () => {
    aufschluesselungOffen = !aufschluesselungOffen;
    renderTagesergebnis();
  });
  $('escalationApply').addEventListener('click', () => {
    const v = pendingEscalation(STATE.data, { settings: getSettings() });
    if (!v.faellig) return;
    mutate(data => {
      data.events.push(...escalationEvents(v));
      data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    });
    showToast(`${v.anzahl === 1 ? '1 Eintrag' : v.anzahl + ' Einträge'} übernommen`, true);
    onNachEintrag();
  });
  $('escalationDismiss').addEventListener('click', () => {
    const v = pendingEscalation(STATE.data, { settings: getSettings() });
    mutate(data => {
      data.meta ||= {};
      data.meta.escalationDismissedAt = new Date().toISOString();
    });
    showToast(`${v.anzahl === 1 ? '1 Vorschlag' : v.anzahl + ' Vorschläge'} verworfen`);
    onNachEintrag();
  });
  $('resetDay').addEventListener('click', () => {
    const iso = gewaehltesDatum;
    const anzahl = (STATE.data.events || []).filter(e => e.date === iso).length;
    if (!anzahl) { showToast('Tag ist leer'); return; }
    withUndo(() => {
      mutate(data => { data.events = data.events.filter(e => e.date !== iso); });
    }, showToast, `${fmtDateShort(iso)} geleert (${anzahl === 1 ? '1 Eintrag' : anzahl + ' Einträge'})`);
  });
}

let letzteRegistry = '';
export function render() {
  processExpiredRegens();
  // Die Tasten nur neu bauen, wenn sich die Registry geändert hat — sonst
  // ginge ein gerade gehaltener Knopf bei jedem Minutentakt verloren.
  const s = getSettings();
  const kennung = JSON.stringify(s.models.map(m => [m.id, m.label, m.color, m.archived, !!m.regen]));
  if (kennung !== letzteRegistry) { letzteRegistry = kennung; renderQuickButtons(); }
  else renderRegenButton();
  renderQuickHinweis();
  renderEscalation();
  renderTagKopf();
  renderEvents();
  renderTagesergebnis();
}
