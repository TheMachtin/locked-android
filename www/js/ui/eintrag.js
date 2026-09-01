/**
 * Eintrag-Seite: der Bildschirm, der im Alltag benutzt wird.
 *
 * Oben steht, was der Tag bisher gebracht hat und woraus sich das zusammensetzt —
 * die Aufschlüsselung kommt direkt aus `scoreDay()`, damit Anzeige und Rechnung
 * nicht auseinanderlaufen können. Darunter die Schnelltasten, die sich aus der
 * Modell-Registry aufbauen: ein neuer Käfig erscheint hier, sobald er in den
 * Einstellungen angelegt ist.
 */

import { STATE, calc, mutate, withUndo, settings as getSettings } from '../state.js';
import { showToast } from './toast.js';
import {
  fmtInt, fmtNum, fmtSigned, fmtDateShort, fmtDurationShort, fmtDurationLong, fmtAgo, fmtCountdownHM, fmtCountdownDH, msToHours, escapeHtml, weekdayOf, refTimeFor, MONTHS_DE,
} from './format.js';
import { dayTimeline } from './charts.js';
import { isoOf, isoDateAdd, hmOf, eventMs, calendarDaysBetween } from '../core/time.js';
import { lockPhaseStart, currentOrgasmPrice, regenState, expiredRegenEvents } from '../core/calc.js';
import { resolveModel, modelMap, KIND_ORGASM } from '../core/settings.js';
import { pendingEscalation, escalationEvents } from '../core/escalation.js';

const $ = id => document.getElementById(id);
let gewaehltesDatum = isoOf(new Date());
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
  if (m.kind === KIND_ORGASM) {
    const heutige = calc().byDate[gewaehltesDatum];
    const letzter = heutige && heutige.orgasmen[heutige.orgasmen.length - 1];
    showToast(letzter ? `${m.label} — ${fmtInt(letzter.price)} Punkte` : m.label, true);
  } else {
    showToast(`${m.label} ${zeit}`);
  }
  onNachEintrag();
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

// =========================== HERO ===========================
function renderHero() {
  const iso = gewaehltesDatum;
  const { days, byDate, totals } = calc();
  const s = getSettings();
  const d = byDate[iso];

  $('datum').value = iso;
  $('wochentag').textContent = weekdayOf(iso);
  document.querySelectorAll('#datePills .pill').forEach(p => {
    p.classList.toggle('active', isoDateAdd(heute(), parseInt(p.dataset.offset, 10)) === iso);
  });

  // Aktuelles Modell
  const map = modelMap(s);
  let cur = d ? d.prevEndModel : null;
  let curZeit = '00:00';
  if (d) {
    for (const ev of d.events) {
      if (resolveModel(s, map, ev.type).kind === KIND_ORGASM) continue;
      cur = ev.type; curZeit = ev.time;
    }
  }
  const curM = cur ? resolveModel(s, map, cur) : null;
  $('currentModel').innerHTML = curM
    ? `<span class="dot" style="background:${curM.color}"></span><span>Modell ${iso === heute() ? 'jetzt' : 'Ende ' + fmtDateShort(iso)}: `
      + `<b>${escapeHtml(curM.label)}</b>${curM.locked ? ` (seit ${curZeit})` : ''}</span>`
    : '';

  // Tageszahl
  const netto = d && d.zaehlt ? d.netto : 0;
  const num = $('heroNum');
  num.textContent = fmtSigned(netto);
  num.classList.toggle('neg', netto < 0);
  num.classList.toggle('zero', netto === 0);
  $('heroLabel').textContent = d && !d.zaehlt ? 'vor dem Stichtag' : 'Punkte heute';

  $('heroBreakdown').innerHTML = d ? breakdownHtml(d, s) : '';

  // Konto und Form
  const gestern = byDate[isoDateAdd(iso, -1)];
  const formDelta = d && gestern ? d.form - gestern.form : 0;
  $('kontoRow').innerHTML = `
    <div class="konto-box">
      <div class="v ${(d ? d.konto : totals.konto) < 0 ? 'neg' : ''}">${fmtInt(d ? d.konto : totals.konto)}</div>
      <div class="l">Kontostand</div>
    </div>
    <div class="konto-box">
      <div class="v">${fmtInt(d ? d.form : totals.form)}</div>
      <div class="l">Form</div>
      <div class="trend ${formDelta >= 0 ? 'up' : 'down'}">${formDelta >= 0 ? '▲' : '▼'} ${fmtSigned(formDelta)}</div>
    </div>`;

  renderStreakRow(iso, days, d, s);
  renderPreis(s);
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
  if (d.bonus) {
    zeilen.push(zeile(`Durchgehend verschlossen${d.bonusVorlaeufig ? ' <span class="hint">(vorläufig)</span>' : ''}`,
      d.bonus, 'plus'));
  }
  if (d.mult !== 1) {
    zeilen.push(zeile(`Streak-Multiplikator × ${fmtNum(d.mult, 2)}`,
      d.einnahmen - (d.verdienstBasis + d.bonus), 'plus'));
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

function renderStreakRow(iso, days, d, s) {
  const refMs = refTimeFor(iso).getTime();
  const idx = d ? days.indexOf(d) : -1;

  let ofTage = 0;
  for (let i = idx; i >= 0 && days[i].orgasmusfrei; i--) ofTage++;
  const letzterOr = letzterOrgasmusVor(refMs, s);
  const lock = lockPhaseStart(STATE.data.events, s, refMs);

  const eintraege = [
    {
      days: ofTage, label: 'Orgasmusfrei',
      ms: letzterOr != null ? Math.max(0, refMs - letzterOr) : null,
      since: letzterOr != null ? `seit ${fmtDateShort(isoOf(new Date(letzterOr)))} ${hmOf(new Date(letzterOr))}` : 'keiner erfasst',
    },
    {
      days: lock ? calendarDaysBetween(lock.ms, refMs) : 0, label: 'Verschlossen',
      ms: lock ? Math.max(0, refMs - lock.ms) : null,
      since: lock ? `seit ${fmtDateShort(isoOf(new Date(lock.ms)))} ${hmOf(new Date(lock.ms))}` : 'gerade offen',
    },
    {
      days: null, label: 'Multiplikator',
      text: `× ${fmtNum(d ? d.mult : 1, 2)}`,
      since: d && d.mult >= s.points.streakCap ? 'Deckel erreicht' : `Deckel × ${fmtNum(s.points.streakCap, 2)}`,
    },
  ];

  $('streakRow').innerHTML = eintraege.map(x => `<div class="streak-item">
    <div class="days">${x.text != null ? x.text : `${x.days} T`}${x.ms != null
      ? ` <span class="hrs" title="${fmtDurationLong(x.ms)}">(${fmtInt(msToHours(x.ms))} h)</span>` : ''}</div>
    <div class="label">${x.label}</div>
    <div class="since">${x.since || '—'}</div>
  </div>`).join('');
}

function letzterOrgasmusVor(refMs, s) {
  const map = modelMap(s);
  let best = null;
  for (const e of (STATE.data.events || [])) {
    if (resolveModel(s, map, e.type).kind !== KIND_ORGASM) continue;
    const t = eventMs(e);
    if (isFinite(t) && t <= refMs && (best == null || t > best)) best = t;
  }
  return best;
}

/** Das Preisschild — die zentrale Zahl des Modells gehört sichtbar in die App. */
function renderPreis(s) {
  const box = $('preisBox');
  const p = currentOrgasmPrice(STATE.data, s, refTimeFor(gewaehltesDatum).getTime());
  if (!p) { box.classList.add('hide'); return; }
  box.classList.remove('hide');
  const warte = isFinite(p.abstandTage)
    ? `${fmtNum(p.abstandTage, 1)} Tage seit dem letzten`
    : 'noch keiner erfasst';
  box.innerHTML = `<div><div class="l">${escapeHtml(p.model.label)} kostet gerade</div>
    <div class="l" style="opacity:.8">${warte}</div></div><div class="v">−${fmtInt(p.price)}</div>`;
}

// =========================== ORGASMUS-ZÄHLER ===========================
function renderOrgasmCounter() {
  const s = getSettings();
  const map = modelMap(s);
  const iso = gewaehltesDatum;
  const refMs = refTimeFor(iso).getTime();
  const alle = (STATE.data.events || [])
    .filter(e => resolveModel(s, map, e.type).kind === KIND_ORGASM)
    .map(e => ({ e, t: eventMs(e) }))
    .filter(x => isFinite(x.t) && x.t <= refMs)
    .sort((a, b) => a.t - b.t);

  const monat = iso.slice(0, 7);
  const letzter = alle[alle.length - 1] || null;
  const fenster = tage => alle.filter(x => x.t >= refMs - tage * 86400000).length;
  const avgGap = alle.length >= 2 ? (letzter.t - alle[0].t) / (alle.length - 1) : null;

  const kachel = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('orgCounter').innerHTML =
      kachel(fmtInt(alle.filter(x => x.e.date.startsWith(monat)).length), MONTHS_DE[parseInt(monat.slice(5), 10) - 1])
    + kachel(fmtInt(fenster(30)), 'letzte 30 T')
    + kachel(fmtInt(fenster(90)), 'letzte 90 T')
    + kachel(fmtInt(fenster(365)), 'letzte 365 T')
    + kachel(letzter ? fmtDurationShort(refMs - letzter.t) : '—', 'seit letztem')
    + kachel(avgGap != null ? fmtNum(avgGap / 86400000, 1) + ' T' : '—', 'Ø Abstand');

  const amTag = alle.filter(x => x.e.date === iso).length;
  const istHeute = iso === heute();
  $('orgSub').textContent = amTag > 0
    ? `${amTag}× ${istHeute ? 'heute' : 'am ' + fmtDateShort(iso)}`
    : (istHeute ? 'heute keiner' : 'keiner am ' + fmtDateShort(iso));

  const auto = alle.filter(x => x.e.auto_inactivity).length;
  $('orgLast').innerHTML = letzter
    ? `Letzter: <b>${fmtDateShort(letzter.e.date)} ${letzter.e.time}</b> (${fmtAgo(refMs - letzter.t)})`
      + (auto ? ` · ${auto} automatisch (Inaktivität)` : '')
    : 'Noch kein Orgasmus erfasst.';
}

// =========================== EINTRÄGE ===========================
function renderEvents() {
  const s = getSettings();
  const map = modelMap(s);
  const iso = gewaehltesDatum;
  const { byDate } = calc();
  const d = byDate[iso];
  const wrap = $('events');
  $('evDateLabel').textContent = fmtDateShort(iso);

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
  renderEscalation();
  renderHero();
  renderOrgasmCounter();
  renderEvents();
}
