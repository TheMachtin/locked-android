/**
 * Einstellungen: Modelle und Punktesätze.
 *
 * Der eigentliche Kern von 2.0 — hier steht, was die App rechnet. Nichts davon
 * ist im Programm festverdrahtet: ein neuer Käfig, ein anderer Stundensatz, ein
 * flacher Orgasmus-Preis sind Einträge in der Datei und wandern über OneDrive
 * auf das andere Gerät mit.
 *
 * Zwei Sicherungen, die die Oberfläche nicht umgehen kann: der offene Zustand
 * lässt sich nicht löschen oder archivieren (er ist der Startzustand jeder
 * Historie), und ein Modell mit Einträgen lässt sich nur archivieren, nicht
 * entfernen — sonst zeigten alte Tage auf einen Typ, den es nicht mehr gibt.
 */

import { STATE, calc, mutateSettings, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtNum, escapeHtml, fmtDateShort as fmtDate } from './format.js';
import {
  KIND_MODEL, KIND_ORGASM, idFromLabel, defaultSettings, PALETTE, orgasmPrice,
  stichtagOf, fruehesterStichtag,
} from '../core/settings.js';

const $ = id => document.getElementById(id);
let offen = null;      // ID des gerade aufgeklappten Modells

function zaehleEvents(id) {
  return (STATE.data.events || []).filter(e => e.type === id).length;
}

// =========================== MODELLE ===========================
function renderModelle() {
  const s = getSettings();
  const wrap = $('modelList');
  wrap.innerHTML = s.models.map(m => modelRow(m)).join('');

  wrap.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
    offen = offen === el.dataset.open ? null : el.dataset.open;
    renderModelle();
  }));
  wrap.querySelectorAll('[data-feld]').forEach(el => {
    const ereignis = (el.type === 'checkbox' || el.type === 'color') ? 'change' : 'change';
    el.addEventListener(ereignis, () => feldGeaendert(el));
  });
  wrap.querySelectorAll('[data-archivieren]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.archivieren;
    mutateSettings(s2 => {
      const m = s2.models.find(x => x.id === id);
      if (m) m.archived = !m.archived;
    });
    renderModelle();
  }));
  wrap.querySelectorAll('[data-loeschen]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.loeschen;
    if (zaehleEvents(id) > 0) { showToast('Hat Einträge — nur archivieren möglich', true); return; }
    if (!confirmAction(`Modell „${id}" wirklich löschen?`)) return;
    mutateSettings(s2 => { s2.models = s2.models.filter(x => x.id !== id); });
    offen = null;
    renderModelle();
    showToast('Modell gelöscht');
  }));
}

function modelRow(m) {
  const anzahl = zaehleEvents(m.id);
  const badges = [
    m.isOpen ? '<span class="badge">offen-Zustand</span>' : '',
    m.regen ? '<span class="badge">Regeneration</span>' : '',
    m.kind === KIND_ORGASM ? '<span class="badge">Ereignis</span>' : (m.locked ? '<span class="badge">verschlossen</span>' : ''),
    m.archived ? '<span class="badge">archiviert</span>' : '',
  ].join('');
  const sub = m.kind === KIND_ORGASM
    ? `Preis ${fmtNum(m.priceMin, 0)}–${fmtNum(m.priceMax, 0)} · Halbwertszeit ${fmtNum(m.halflifeDays, 0)} T`
    : `${m.rate >= 0 ? '+' : ''}${fmtNum(m.rate, 2)} Punkte/Stunde`;

  return `<div class="model-row ${m.archived ? 'archived' : ''}">
      <span class="swatch" style="background:${m.color}"></span>
      <div>
        <div class="name">${escapeHtml(m.label)} ${badges}</div>
        <div class="sub">${sub} · ${anzahl} Eintrag${anzahl === 1 ? '' : 'e'}</div>
      </div>
      <span class="sub">${escapeHtml(m.id)}</span>
      <button class="btn ghost" type="button" data-open="${m.id}" style="padding:6px 10px">${offen === m.id ? 'Fertig' : 'Ändern'}</button>
    </div>`
    + (offen === m.id ? modelEditor(m, anzahl) : '');
}

function modelEditor(m, anzahl) {
  const feld = (label, id, typ, wert, extra = '') =>
    `<div><label>${label}</label><input type="${typ}" data-feld="${id}" data-id="${m.id}" value="${wert}" ${extra}></div>`;
  const schalter = (label, id, an) =>
    `<div><label>${label}</label><button class="toggle ${an ? 'on' : ''}" type="button" data-feld="${id}" data-id="${m.id}" data-wert="${an ? '1' : '0'}">${an ? 'ja' : 'nein'}</button></div>`;

  let felder = feld('Bezeichnung', 'label', 'text', escapeHtml(m.label))
    + feld('Farbe', 'color', 'color', m.color);

  if (m.kind === KIND_MODEL) {
    felder += feld('Punkte je Stunde', 'rate', 'number', m.rate, 'step="0.05"');
    felder += m.isOpen
      ? '<div><label>Zählt als verschlossen</label><div class="sub" style="padding-top:8px">nein — das ist der offene Zustand</div></div>'
      : schalter('Zählt als verschlossen', 'locked', m.locked);
    if (m.regen) {
      felder += feld('Fenster (Stunden)', 'windowH', 'number', m.windowH, 'step="0.5" min="0.5"');
      felder += feld('Sperrfrist (Tage)', 'cooldownD', 'number', m.cooldownD, 'step="1" min="0"');
    }
  } else {
    felder += feld('Preis Minimum', 'priceMin', 'number', m.priceMin, 'step="1" min="0"');
    felder += feld('Preis Maximum', 'priceMax', 'number', m.priceMax, 'step="1" min="0"');
    felder += feld('Halbwertszeit (Tage)', 'halflifeDays', 'number', m.halflifeDays, 'step="0.5" min="0.5"');
    felder += feld('Aufschlag je weiterem am Tag', 'repeatFactor', 'number', m.repeatFactor, 'step="0.1" min="1"');
    felder += `<div class="full sub">${preisVorschau(m)}</div>`;
  }

  const loeschbar = !m.isOpen && anzahl === 0;
  felder += `<div class="full row2" style="margin-top:4px">
      ${m.isOpen ? '' : `<button class="btn ghost" type="button" data-archivieren="${m.id}">${m.archived ? 'Wieder aktivieren' : 'Archivieren'}</button>`}
      ${loeschbar ? `<button class="btn danger-outline" type="button" data-loeschen="${m.id}">Löschen</button>`
        : `<span class="sub" style="align-self:center">${m.isOpen ? 'Der offene Zustand bleibt immer bestehen.' : 'Hat Einträge — nur archivierbar.'}</span>`}
    </div>`;

  return `<div class="model-edit">${felder}</div>`;
}

/** Zeigt die Preiskurve an ein paar Stützstellen — abstrakte Parameter sagen sonst nichts. */
function preisVorschau(m) {
  return 'Preis nach Wartezeit: ' + [0, 3, 7, 14, 30]
    .map(t => `${t} T → <b>${fmtNum(orgasmPrice(m, t, 1), 0)}</b>`).join(' · ');
}

function feldGeaendert(el) {
  const id = el.dataset.id;
  const feld = el.dataset.feld;
  const istSchalter = el.classList.contains('toggle');
  const wert = istSchalter ? el.dataset.wert !== '1'
    : (el.type === 'number' ? parseFloat(String(el.value).replace(',', '.')) : el.value);
  if (el.type === 'number' && !isFinite(wert)) { showToast('Keine gültige Zahl', true); renderModelle(); return; }

  let neueId = id;
  mutateSettings(s => {
    const m = s.models.find(x => x.id === id);
    if (!m) return;
    m[feld] = wert;
    // Ein Modell mit positivem Satz, das nicht als verschlossen zählt, wäre
    // widersprüchlich gemeint — aber erlaubt (etwa eine belohnte Auszeit).
    // Nur der offene Zustand bleibt zwingend offen.
    if (m.isOpen) m.locked = false;
    // Solange noch kein Eintrag darauf zeigt, darf die ID dem Namen folgen —
    // „COBRAV" liest sich in CSV und Excel besser als „NEUESM". Sobald Einträge
    // existieren, bleibt sie fest, sonst zeigten alte Tage ins Leere.
    if (feld === 'label' && zaehleEvents(id) === 0) {
      const frei = s.models.filter(x => x !== m).map(x => x.id);
      const kandidat = idFromLabel(wert, frei);
      if (kandidat !== id) { m.id = kandidat; neueId = kandidat; }
    }
  });
  if (offen === id) offen = neueId;
  renderModelle();
  showToast('Gespeichert');
}

function neuesModell(kind) {
  const s = getSettings();
  const taken = s.models.map(m => m.id);
  const label = kind === KIND_ORGASM ? 'Neues Ereignis' : 'Neues Modell';
  const id = idFromLabel(label + ' ' + (taken.length + 1), taken);
  mutateSettings(s2 => {
    const basis = { id, kind, label, color: PALETTE[s2.models.length % PALETTE.length], archived: false };
    s2.models.push(kind === KIND_ORGASM
      ? { ...basis, priceMin: 15, priceMax: 60, halflifeDays: 7, repeatFactor: 1 }
      : { ...basis, rate: 0.5, locked: true });
  });
  offen = id;
  renderModelle();
  showToast('Angelegt — jetzt benennen');
}

// =========================== PUNKTE UND REGELN ===========================
const PUNKT_FELDER = [
  { key: 'bonusDurchgehend', name: 'Bonus für einen ganz verschlossenen Tag',
    desc: 'Einmal pro Tag, zusätzlich zu den Stunden. Wird ebenfalls mit dem Streak-Multiplikator verrechnet.',
    step: 1 },
  { key: 'bonusMaxOffenH', name: 'Bis zu wie viel offener Zeit der Bonus noch gilt',
    desc: 'In Stunden. Duschen soll den Tag nicht kosten; ein halber Tag offen schon.', step: 0.5 },
  { key: 'streakK', name: 'Multiplikator-Zuwachs je orgasmusfreiem Tag',
    desc: '0,02 heißt: nach 25 Tagen zählt jede Stunde anderthalbfach.', step: 0.005 },
  { key: 'streakCap', name: 'Höchster Multiplikator',
    desc: 'Die Obergrenze. Ohne sie wüchse der Streak-Effekt unbegrenzt — genau daran ist die alte Formel gescheitert.',
    step: 0.1 },
  { key: 'formDecay', name: 'Abklingfaktor des Form-Werts',
    desc: '0,97 entspricht rund 23 Tagen Halbwertszeit. Kleiner = die Form reagiert schneller und vergisst schneller.',
    step: 0.005 },
];
const REGEL_FELDER = [
  { key: 'inactivityReminderDays', name: 'Erinnerung nach … Tagen ohne Eintrag', desc: 'Nur Android: die tägliche Benachrichtigung.', step: 1 },
  { key: 'inactivityAutoDays', name: 'Vorschläge nach … Tagen ohne Eintrag', desc: 'Ab hier schlägt die App fehlende Einträge vor — geschrieben wird erst nach deiner Bestätigung.', step: 1 },
];

function renderZahlen() {
  const s = getSettings();
  const bau = (felder, quelle, gruppe) => felder.map(f => `<div class="setting">
      <div><div class="name">${f.name}</div><div class="desc">${f.desc}</div></div>
      <input type="number" step="${f.step}" value="${quelle[f.key]}" data-punkt="${f.key}" data-gruppe="${gruppe}">
    </div>`).join('');
  $('pointSettings').innerHTML = bau(PUNKT_FELDER, s.points, 'points');
  $('ruleSettings').innerHTML = bau(REGEL_FELDER, s.rules, 'rules');

  document.querySelectorAll('[data-punkt]').forEach(el => el.addEventListener('change', () => {
    const wert = parseFloat(String(el.value).replace(',', '.'));
    if (!isFinite(wert)) { showToast('Keine gültige Zahl', true); renderZahlen(); return; }
    mutateSettings(s2 => { s2[el.dataset.gruppe][el.dataset.punkt] = wert; });
    renderZahlen();
    renderVorschau();
    showToast('Gespeichert');
  }));
}

/**
 * Was die aktuellen Sätze für einen typischen Tag bedeuten.
 * Ohne diese Zeile sind fünf Zahlenfelder blind — man dreht an 0,02 und sieht
 * erst Tage später, was das anrichtet.
 */
function renderVorschau() {
  const { settings: s } = calc();
  const P = s.points;
  const satz = s.models.find(m => m.kind === KIND_MODEL && m.locked && !m.archived);
  const offenM = s.models.find(m => m.isOpen);
  if (!satz) { $('settingsPreview').innerHTML = ''; return; }
  const rechne = (verschlH, streak) => {
    const offenH = 24 - verschlH;
    const bonus = offenH <= P.bonusMaxOffenH ? P.bonusDurchgehend : 0;
    const mult = Math.min(1 + P.streakK * streak, P.streakCap);
    return (verschlH * satz.rate + bonus) * mult + offenH * Math.min(0, offenM ? offenM.rate : 0);
  };
  const zeilen = [
    ['24 h verschlossen, Streak 0', rechne(24, 0)],
    ['24 h verschlossen, Streak 30', rechne(24, 30)],
    ['24 h verschlossen, Deckel erreicht', rechne(24, 1e6)],
    ['12 h offen, Streak 30', rechne(12, 30)],
  ];
  const grenzwert = rechne(24, 30) / (1 - P.formDecay);
  $('settingsPreview').innerHTML = `<div class="breakdown" style="border-top:none;padding-top:0">
    ${zeilen.map(([l, v]) => `<div class="row ${v >= 0 ? 'plus' : 'minus'}"><span>${l}</span><b>${v >= 0 ? '+' : ''}${fmtNum(v, 1)}</b></div>`).join('')}
    <div class="row"><span>Form pendelt sich ein bei etwa</span><b>${fmtNum(grenzwert, 0)}</b></div>
  </div>`;
}

// =========================== STICHTAG ===========================
/**
 * Ab wann das Konto zählt.
 *
 * Normalerweise abgeleitet: ohne Archiv zählt alles (auch nachgetragene Tage),
 * mit Archiv beginnt die neue Ära dort, wo die eingefrorene endet. Das Feld ist
 * für den Fall da, dass man es anders will — leer heißt „wieder ableiten".
 *
 * Vor das Archiv zurück geht es nicht: dieselben Tage stünden sonst zweimal in
 * der Wertung, einmal nach alter und einmal nach neuer Formel.
 */
function renderStichtag() {
  const s = getSettings();
  const gesetzt = !!s.startedAt;
  const wirksam = stichtagOf(STATE.data, s);
  const min = fruehesterStichtag(STATE.data);
  const herkunft = gesetzt ? 'von Hand gesetzt'
    : (wirksam ? 'abgeleitet: der Tag nach dem Archiv' : 'abgeleitet: alles zählt');

  $('stichtagBox').innerHTML = `
    <div class="setting">
      <div>
        <div class="name">Konto zählt ab</div>
        <div class="desc">${herkunft}. Leeres Feld = wieder ableiten.
          ${min ? `Nicht vor ${fmtDate(min)} — davor liegt das Archiv.` : ''}</div>
      </div>
      <input type="date" id="stichtagInput" value="${wirksam || ''}" ${min ? `min="${min}"` : ''}>
    </div>
    ${gesetzt ? '<button class="btn ghost full" id="stichtagReset" type="button">Wieder ableiten</button>' : ''}`;

  $('stichtagInput').addEventListener('change', e => {
    const wert = e.target.value;
    if (wert && min && wert < min) {
      showToast(`Nicht vor ${fmtDate(min)} — davor liegt das Archiv`, true);
      renderStichtag();
      return;
    }
    mutateSettings(s2 => {
      if (wert) s2.startedAt = wert; else delete s2.startedAt;
    });
    render();
    showToast(wert ? `Konto zählt ab ${fmtDate(wert)}` : 'Stichtag wieder abgeleitet');
  });
  const reset = $('stichtagReset');
  if (reset) reset.addEventListener('click', () => {
    mutateSettings(s2 => { delete s2.startedAt; });
    render();
    showToast('Stichtag wieder abgeleitet');
  });
}

// =========================== AUFBAU ===========================
export function initEinstellungen() {
  $('btnNeuesModell').addEventListener('click', () => neuesModell(KIND_MODEL));
  $('btnNeuesEreignis').addEventListener('click', () => neuesModell(KIND_ORGASM));
  $('btnResetSettings').addEventListener('click', () => {
    if (!confirmAction('Alle Modelle und Punktesätze auf die Standardwerte zurücksetzen?\n\nDeine Einträge bleiben erhalten.')) return;
    mutateSettings(s => {
      const std = defaultSettings();
      s.models = std.models;
      s.points = std.points;
      s.rules = std.rules;
    });
    offen = null;
    render();
    showToast('Auf Standard zurückgesetzt');
  });
}

export function render() {
  renderModelle();
  renderZahlen();
  renderVorschau();
  renderStichtag();
}
