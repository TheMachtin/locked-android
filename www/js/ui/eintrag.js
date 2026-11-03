/**
 * „Heute": der Bildschirm, der im Alltag benutzt wird.
 *
 * Er beantwortet die Fragen, mit denen man die App öffnet: *wie steht es
 * gerade*, *was trage ich ein*, *was steht heute schon drin*. Deshalb ganz oben
 * eine Zeile mit den drei Uhren, darunter die Tasten, darunter der Tag. Keine
 * Karten, keine Überschriften — es ist der einzige Ort für diese Dinge.
 *
 * Bis 2.5 stand der Zustand in einer Karte „Jetzt" im Dashboard und hier gar
 * nicht; in 2.2 stand er an beiden Stellen. Jetzt steht er nur hier, als eine
 * Zeile statt einer Karte, und kommt aus `ui/status.js` — derselben Rechnung,
 * aus der die Live-Ansicht ihre Kacheln baut.
 *
 * Zwei Auskünfte stehen dort, wo man drückt: welches Modell läuft, auf seiner
 * Taste, und was ein Orgasmus gerade kostet, auf dessen Taste.
 *
 * Das Tagesergebnis steht neben dem Tag; seine Aufschlüsselung kommt direkt aus
 * `scoreDay()` — Anzeige und Rechnung können so nicht auseinanderlaufen.
 */

import { STATE, calc, mutate, withUndo, settings as getSettings } from '../state.js';
import { showToast } from './toast.js';
import {
  fmtInt, fmtNum, fmtSigned, fmtDateShort, fmtDurationShort,
  fmtCountdownHM, fmtCountdownDH, escapeHtml, weekdayOf,
} from './format.js';
import { dayTimeline } from './charts.js';
import { statusContext, statusKompakt } from './status.js';
import { isoOf, isoDateAdd, hmOf } from '../core/time.js';
import { regenState, expiredRegenEvents, lastOrgasmMs } from '../core/calc.js';
import { resolveModel, modelMap, orgasmPrice, KIND_ORGASM } from '../core/settings.js';
import { pendingEscalation, escalationEvents } from '../core/escalation.js';
import { planCommand, currentRunAt } from '../core/command.js';

const $ = id => document.getElementById(id);
let gewaehltesDatum = isoOf(new Date());
let aufschluesselungOffen = false;
let statusOffen = false;
/** Der Eintrag, dessen Zeile gerade zum Bearbeiten offen ist — `date|time|type`. */
let offenerEintrag = null;
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
  if (regen) html += taste(regen, true);
  html += orgasmen.map(m => taste(m, true)).join('');
  wrap.innerHTML = html;

  wrap.querySelectorAll('.qb').forEach(bindTap);
}

/** Eine Farbe aus der Registry mit Deckkraft — `#rrggbb` → `#rrggbbaa`. */
function getoent(farbe, alpha) {
  return /^#[0-9a-f]{6}$/i.test(farbe || '')
    ? farbe + Math.round(alpha * 255).toString(16).padStart(2, '0')
    : `rgba(255,255,255,${alpha})`;
}

function taste(m, voll) {
  const klassen = ['qb'];
  if (m.kind === KIND_ORGASM) klassen.push('danger');
  else if (m.regen) klassen.push('regen');
  else klassen.push('modell');
  if (voll) klassen.push('span-all');
  const farbe = m.kind === KIND_ORGASM || m.regen ? ''
    : `style="--qb-farbe:${escapeHtml(m.color)};--qb-ton:${getoent(m.color, 0.22)}"`;
  // Jede Taste hat eine Unterzeile: beim laufenden Modell steht darin, seit
  // wann, bei der Regeneration ihr Zustand, bei einem Ereignis sein Preis.
  const sub = '<div class="qb-sub"></div>';
  return `<button class="${klassen.join(' ')}" data-model="${escapeHtml(m.id)}" type="button" ${farbe}>
    <div class="qb-main">${escapeHtml(m.label)}</div>${sub}
  </button>`;
}

/**
 * Tippen trägt ein. Die Absicherung gegen einen Fehlgriff ist das Rückgängig in
 * der Meldung, nicht eine Wartezeit vor dem Speichern.
 *
 * Bis 2.4 musste man die Taste knapp eine Sekunde halten. Das sollte einen
 * Fehlgriff in der Hosentasche abfangen — und erzeugte einen schlimmeren: wer
 * zu kurz drückte, bekam eine grüne Meldung „Halten zum Speichern", die genau
 * wie die Bestätigung aussah, und merkte erst am nächsten Tag, dass nichts
 * eingetragen war. Ein Fehlgriff ist sichtbar und lässt sich zurücknehmen; ein
 * Eintrag, der nie stattfand, ist unsichtbar.
 *
 * Doppeltippen trägt nicht zweimal ein: dieselbe Taste ist für einen Moment
 * taub, und ein zweites Mal dasselbe Modell gilt ohnehin als „läuft schon".
 */
const TAUB_MS = 1200;
let letzterTipp = { id: null, ms: 0 };

function bindTap(btn) {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const id = btn.dataset.model;
    const jetzt = Date.now();
    if (letzterTipp.id === id && jetzt - letzterTipp.ms < TAUB_MS) return;
    letzterTipp = { id, ms: jetzt };
    if (addEvent(id, hmOf(new Date()))) {
      if (navigator.vibrate) navigator.vibrate(25);
      bestaetigen(id);
    }
  });
}

/** Die getippte Taste kurz aufleuchten lassen — die Antwort dort, wo der Finger ist. */
function bestaetigen(id) {
  const btn = document.querySelector(`#quick .qb[data-model="${CSS.escape(id)}"]`);
  if (!btn) return;
  btn.classList.remove('gesetzt');
  // Neu auslösen, auch wenn die Animation von eben noch läuft.
  void btn.offsetWidth;
  btn.classList.add('gesetzt');
  setTimeout(() => btn.classList.remove('gesetzt'), 700);
}

/**
 * Einen Eintrag auf den gewählten Tag schreiben.
 *
 * Der Plan kommt aus `planCommand()` — derselben Prüfung, durch die auch
 * Kurzbefehl und Uhr gehen. Anders als dort wird ein unveränderter Zustand hier
 * aber nicht geschrieben: die Taste des laufenden Modells ist markiert, und wer
 * sie trotzdem tippt, will meist nur wissen, ob der Wechsel von vorhin drin ist.
 *
 * @returns {boolean} ob etwas eingetragen wurde
 */
export function addEvent(typ, zeit) {
  const s = getSettings();
  const plan = planCommand(STATE.data, s, { modell: typ, zeit, datum: gewaehltesDatum });
  if (!plan.ok) { showToast(plan.fehler, true); return false; }
  const m = plan.model;
  // Auf einem anderen Tag als heute muss die Meldung das Datum nennen: die
  // Tasten stehen über der Datumswahl, und ein stiller Eintrag auf den Vortag
  // fällt erst Tage später auf.
  const wo = gewaehltesDatum === heute() ? '' : ` am ${fmtDateShort(gewaehltesDatum)}`;

  if (plan.doppelt) {
    showToast(`${m.label} ${zeit}${wo} steht schon drin`, 'info');
    return false;
  }
  if (plan.unveraendert && m.kind !== KIND_ORGASM) {
    const lauf = currentRunAt(STATE.data.events, s, Date.parse(`${gewaehltesDatum}T${zeit}:00`));
    showToast(`${m.label} läuft schon${lauf.ms != null ? ' ' + seitText(lauf.ms) : ''} — nichts eingetragen`, 'info');
    return false;
  }

  const ev = plan.event;
  mutate(data => {
    data.events.push({ ...ev });
    data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  });

  const zurueck = { label: 'Rückgängig', run: () => zuruecknehmen(ev, m.label) };
  if (m.kind === KIND_ORGASM) {
    const tag = calc().byDate[ev.date];
    const o = tag && tag.orgasmen.find(x => x.event.time === ev.time && x.event.type === ev.type);
    const preis = o && o.price ? ` — ${fmtInt(o.price)} Punkte` : '';
    showToast(`${m.label} ${zeit}${wo}${preis}`, true, zurueck);
  } else {
    showToast(`${m.label} ab ${zeit}${wo}`, false, zurueck);
  }
  onNachEintrag();
  return true;
}

/** Genau den einen Eintrag wieder entfernen — nicht den ganzen Stand zurückdrehen.
 *  Dazwischen kann ein Abgleich mit dem anderen Gerät gelegen haben. */
function zuruecknehmen(ev, label) {
  let weg = false;
  mutate(data => {
    const i = data.events.findIndex(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
    if (i >= 0) { data.events.splice(i, 1); weg = true; }
  });
  showToast(weg ? `${label} ${ev.time} zurückgenommen` : 'Schon nicht mehr da', 'info');
  onNachEintrag();
}

/** „seit 14:32", „seit gestern 22:10", „seit Mo 27.10." */
function seitText(ms) {
  const d = new Date(ms);
  const iso = isoOf(d);
  if (iso === heute()) return `seit ${hmOf(d)}`;
  if (iso === isoDateAdd(heute(), -1)) return `seit gestern ${hmOf(d)}`;
  return `seit ${weekdayOf(iso)} ${fmtDateShort(iso).slice(0, 6)}`;
}

/**
 * Das laufende Modell auf seiner Taste markieren.
 *
 * Gemessen an *jetzt*, nicht am gewählten Tag: die Tasten tragen mit der
 * Uhrzeit von jetzt ein, und die Frage, die die Markierung beantwortet, ist
 * „was trage ich gerade".
 */
function renderAktiv() {
  const s = getSettings();
  const jetzt = Date.now();
  const lauf = currentRunAt(STATE.data.events, s, jetzt);
  // Der Preis eines Ereignisses hängt am Abstand zum letzten Orgasmus. Er
  // steht auf der Taste, weil das die Stelle ist, an der man ihn wissen will —
  // bis 2.5 stand er als rote Box im Dashboard, einen Tab entfernt.
  const letzter = lastOrgasmMs(STATE.data.events || [], s, jetzt);
  const abstand = letzter != null ? (jetzt - letzter) / 86400000 : Infinity;
  const map = modelMap(s);
  document.querySelectorAll('#quick .qb').forEach(btn => {
    if (btn.classList.contains('danger')) {
      const m = resolveModel(s, map, btn.dataset.model);
      const preis = Math.round(orgasmPrice(m, abstand, 1));
      const sub = btn.querySelector('.qb-sub');
      if (sub) sub.textContent = preis > 0 ? `kostet gerade −${fmtInt(preis)}` : '';
      return;
    }
    const aktiv = btn.dataset.model === lauf.id;
    btn.classList.toggle('aktiv', aktiv);
    btn.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
    if (btn.classList.contains('regen')) return;   // eigene Unterzeile, siehe unten
    const sub = btn.querySelector('.qb-sub');
    if (sub) sub.textContent = aktiv ? (lauf.ms != null ? seitText(lauf.ms) : 'läuft') : '';
  });
}

/**
 * Die drei Uhren oben: verschlossen, ungeöffnet, orgasmusfrei.
 *
 * Immer *jetzt*, nicht der gewählte Tag — dieselbe Regel wie für die
 * Markierung auf den Tasten. Ein Tipp zeigt, seit wann jede läuft; die Zeile
 * selbst bleibt dadurch kurz genug, um die Tasten nicht nach unten zu schieben.
 */
function renderStatus() {
  const { days, byDate, settings } = calc();
  const ctx = statusContext(heute(), { days, byDate, settings, events: STATE.data.events || [] });
  const uhren = statusKompakt(ctx);
  // Die Einheiten leiser als die Zahl: „4 T 6 h" liest sich als „4 · 6".
  const zahl = w => escapeHtml(w).replace(/(\d) (T|h|min)\b/g, '$1<small> $2</small>');
  $('statusZeile').innerHTML = uhren.map(u => `<div class="uhr">
      <div class="v">${zahl(u.wert)}</div>
      <div class="l">${u.label}${u.zusatz ? ` · <b>${u.zusatz}</b>` : ''}</div>
    </div>`).join('');
  $('statusZeile').setAttribute('aria-expanded', statusOffen ? 'true' : 'false');
  const zeile = (l, v) => `<div class="sd-zeile"><span>${l}</span><span>${v}</span></div>`;
  $('statusDetails').innerHTML =
      zeile('Verschlossen', uhren[0].seit)
    + zeile('Ungeöffnet', uhren[1].seit)
    + zeile('Orgasmusfrei', uhren[2].seit)
    + zeile(`Multiplikator ${uhren[2].zusatz}`, uhren[2].deckel);
  $('statusDetails').classList.toggle('hide', !statusOffen);
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
/**
 * Die Datumszeile: ‹ Heute · Di 03.11.26 ›.
 *
 * Vorher standen hier ein Datumsfeld und vier Knöpfe (Heute, Gestern,
 * Vorgestern, −7T) — fünf Bedienelemente für eine Frage. Die Pfeile gehen einen
 * Tag weiter, die Mitte öffnet den Kalender für alles, was weiter weg liegt.
 * In die Zukunft geht es nicht: dort gibt es nichts einzutragen.
 */
function renderTagKopf() {
  const iso = gewaehltesDatum;
  const h = heute();
  $('datum').value = iso;
  $('datum').max = h;
  const relativ = iso === h ? 'Heute'
    : iso === isoDateAdd(h, -1) ? 'Gestern'
    : iso === isoDateAdd(h, -2) ? 'Vorgestern' : '';
  $('tagText').innerHTML = (relativ ? `<b>${relativ}</b> · ` : '')
    + `${weekdayOf(iso)} ${fmtDateShort(iso)}`;
  $('tagNext').disabled = iso >= h;
  const anzahl = (STATE.data.events || []).filter(e => e.date === iso).length;
  $('resetDay').classList.toggle('hide', !anzahl);
}

function tagWechseln(iso) {
  if (!iso) return;
  const h = heute();
  gewaehltesDatum = iso > h ? h : iso;
  offenerEintrag = null;
  render();
}

/**
 * Das Ergebnis des Tages, rechts neben dem Tag; die Aufschlüsselung auf Tipp.
 *
 * Es war einmal die große Zahl über der halben Seite, dann die Fußzeile der
 * Einträge. Jetzt steht es dort, wo man auf den Tag schaut, und braucht keine
 * eigene Zeile mehr.
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
  $('dayResultLabel').textContent = d && !d.zaehlt ? 'vor Stichtag'
    : gewaehltesDatum === heute() ? 'heute' : 'Ergebnis';

  const html = d ? breakdownHtml(d, s) : '';
  const box = $('dayBreakdown');
  box.innerHTML = html;
  const zeigbar = !!html;
  $('dayResult').classList.toggle('leer', !zeigbar);
  box.classList.toggle('hide', !(zeigbar && aufschluesselungOffen));
  $('dayResult').setAttribute('aria-expanded', zeigbar && aufschluesselungOffen ? 'true' : 'false');
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
/**
 * Die Einträge des Tages als ruhige Liste: Uhrzeit, Farbe, Name.
 *
 * Bis 2.5 war jede Zeile ein kleines Formular — Auswahlfeld, daneben derselbe
 * Name noch einmal, ein Zeitfeld und ein ×, und das Auswahlfeld war bei allen
 * grün, auch bei der Reinigung. Gelesen wird die Liste aber viel öfter, als in
 * ihr geändert wird. Jetzt öffnet ein Tipp die Zeile zum Bearbeiten; offen ist
 * immer nur eine.
 */
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
    if (!d) { wrap.innerHTML = '<div class="empty">Noch keine Einträge</div>'; return; }
    const carry = resolveModel(s, map, d.prevEndModel);
    wrap.innerHTML = `<div class="ev-zeile carry"><div class="ev-kopf">
      <span class="t">00:00</span><span class="dot" style="background:${escapeHtml(carry.color)}"></span>
      <span class="n">${escapeHtml(carry.label)} <i>· läuft vom Vortag durch</i></span><span></span></div></div>`;
    return;
  }

  const schluessel = ev => `${ev.date}|${ev.time}|${ev.type}`;
  const preise = new Map((d ? d.orgasmen : []).map(o => [schluessel(o.event), o.price]));
  const optionen = s.models.filter(m => !m.archived || evs.some(e => e.type === m.id));
  wrap.innerHTML = '';
  for (const ev of evs) {
    const m = resolveModel(s, map, ev.type);
    const key = schluessel(ev);
    const auf = offenerEintrag === key;
    const auto = ev.auto_inactivity || ev.auto_regen_timeout;
    const vermerk = [ev.time_estimated ? 'geschätzt' : '', auto ? 'automatisch' : ''].filter(Boolean).join(', ');
    const preis = preise.get(key);
    const row = document.createElement('div');
    row.className = 'ev-zeile' + (auf ? ' offen' : '');
    row.innerHTML = `<button class="ev-kopf" type="button" aria-expanded="${auf}">
        <span class="t">${escapeHtml(ev.time)}</span>
        <span class="dot" style="background:${escapeHtml(m.color)}"></span>
        <span class="n">${escapeHtml(m.label)}${vermerk ? ` <i>· ${vermerk}</i>` : ''}</span>
        <span class="r">${preis ? `<b class="preis-klein">−${fmtInt(preis)}</b>` : ''}<span class="chev">${auf ? '▾' : '›'}</span></span>
      </button>`;
    if (auf) {
      const opts = optionen.map(o =>
        `<option value="${escapeHtml(o.id)}" ${o.id === ev.type ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')
        + (optionen.some(o => o.id === ev.type) ? '' : `<option value="${escapeHtml(ev.type)}" selected>${escapeHtml(ev.type)} (unbekannt)</option>`);
      const ed = document.createElement('div');
      ed.className = 'ev-edit';
      ed.innerHTML = `<input type="time" value="${escapeHtml(ev.time)}" aria-label="Uhrzeit">
        <select aria-label="Modell">${opts}</select>
        <button class="btn danger-outline klein" type="button">Löschen</button>`;
      ed.querySelector('select').addEventListener('change', e => {
        const neu = e.target.value;
        offenerEintrag = `${ev.date}|${ev.time}|${neu}`;
        mutate(data => {
          const ziel = data.events.find(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
          if (ziel) ziel.type = neu;
        });
      });
      ed.querySelector('input').addEventListener('change', e => {
        const neu = e.target.value;
        if (!/^\d{2}:\d{2}$/.test(neu)) return;
        offenerEintrag = `${ev.date}|${neu}|${ev.type}`;
        mutate(data => {
          const ziel = data.events.find(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
          if (!ziel) return;
          ziel.time = neu;
          delete ziel.time_estimated;
          data.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        });
      });
      ed.querySelector('.btn').addEventListener('click', () => {
        offenerEintrag = null;
        withUndo(() => {
          mutate(data => {
            const i = data.events.findIndex(x => x.date === ev.date && x.time === ev.time && x.type === ev.type);
            if (i >= 0) data.events.splice(i, 1);
          });
        }, showToast, `${m.label} ${ev.time} entfernt`);
      });
      row.appendChild(ed);
    }
    row.querySelector('.ev-kopf').addEventListener('click', () => {
      offenerEintrag = auf ? null : key;
      renderEvents();
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
  $('datum').addEventListener('change', e => tagWechseln(e.target.value));
  // Das Datumsfeld liegt unsichtbar über der Beschriftung. Am Telefon öffnet
  // ein Tipp darauf den Kalender von selbst; am Desktop nur das kleine Symbol
  // im Feld — dort hilft showPicker() nach.
  $('datum').addEventListener('click', e => {
    try { if (e.target.showPicker) e.target.showPicker(); } catch {}
  });
  $('tagPrev').addEventListener('click', () => tagWechseln(isoDateAdd(gewaehltesDatum, -1)));
  $('tagNext').addEventListener('click', () => tagWechseln(isoDateAdd(gewaehltesDatum, 1)));
  $('quickHeute').addEventListener('click', () => {
    gewaehltesDatum = heute();
    render();
  });
  $('dayResult').addEventListener('click', () => {
    aufschluesselungOffen = !aufschluesselungOffen;
    renderTagesergebnis();
  });
  $('statusZeile').addEventListener('click', () => {
    statusOffen = !statusOffen;
    renderStatus();
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
  // ginge das Aufleuchten nach einem Tipp im selben Moment wieder verloren.
  const s = getSettings();
  const kennung = JSON.stringify(s.models.map(m => [m.id, m.label, m.color, m.archived, !!m.regen]));
  if (kennung !== letzteRegistry) { letzteRegistry = kennung; renderQuickButtons(); }
  renderStatus();
  renderRegenButton();
  renderAktiv();
  renderQuickHinweis();
  renderEscalation();
  renderTagKopf();
  renderEvents();
  renderTagesergebnis();
}
