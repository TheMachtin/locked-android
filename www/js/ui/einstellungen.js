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

import { STATE, calc, mutate, mutateSettings, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtNum, escapeHtml, fmtDateShort as fmtDate } from './format.js';
import {
  KIND_MODEL, KIND_ORGASM, idFromLabel, cleanId, idFolgtNamen, defaultSettings,
  PALETTE, orgasmPrice, stichtagOf, lockKind, applyLockKind,
} from '../core/settings.js';
import { refreezeLegacy } from '../core/legacy.js';
import { isoDateAdd } from '../core/time.js';

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
  wrap.querySelectorAll('input[data-feld]').forEach(el => {
    el.addEventListener('change', () => feldGeaendert(el));
  });
  wrap.querySelectorAll('[data-lockkind] .seg-opt').forEach(el => el.addEventListener('click', () => {
    const id = el.parentElement.dataset.lockkind;
    mutateSettings(s2 => {
      const m = s2.models.find(x => x.id === id);
      if (m && !m.isOpen) applyLockKind(m, el.dataset.wert);
    });
    renderModelle();
    showToast('Gespeichert');
  }));
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
    m.kind === KIND_ORGASM ? '<span class="badge">Ereignis</span>'
      : m.locked ? '<span class="badge">verschlossen</span>'
      : m.pause ? '<span class="badge">Unterbrechung</span>' : '',
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

/** Die drei Verschluss-Zustände, in der Reihenfolge, in der sie zu erklären sind. */
const LOCK_WAHL = [
  { v: 'locked', l: 'Verschlossen',
    t: 'Zählt als verschlossene Zeit, verdient den Stundensatz und trägt den Durchgehend-Bonus.' },
  { v: 'pause', l: 'Unterbrechung',
    t: 'Reinigung und dergleichen: verdient nichts, kostet nichts — und beendet die verschlossene Phase nicht.' },
  { v: 'open', l: 'Offen',
    t: 'Zählt als offene Zeit und setzt die verschlossene Phase auf null zurück.' },
];

function modelEditor(m, anzahl) {
  const feld = (label, id, typ, wert, extra = '') =>
    `<div><label>${label}</label><input type="${typ}" data-feld="${id}" data-id="${m.id}" value="${wert}" ${extra}></div>`;

  let felder = feld('Bezeichnung', 'label', 'text', escapeHtml(m.label))
    + feld('Farbe', 'color', 'color', m.color)
    + idFeld(m, anzahl);

  if (m.kind === KIND_MODEL) {
    felder += feld('Punkte je Stunde', 'rate', 'number', m.rate, 'step="0.05"');
    felder += m.isOpen
      ? `<div class="full"><label>Verschluss-Zustand</label>
          <div class="sub">offen — das ist der offene Zustand und bleibt es</div></div>`
      : lockWahl(m);
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

/**
 * Die ID — das, was man tippt, statt das, was die App sich denkt.
 *
 * Sie steht in `locked://log?m=…`, also im Kurzbefehl, in der Automation und im
 * Lesezeichen; und ist sie ein oder zwei Zeichen lang und passt zum Namen, steht
 * sie auch auf dem Knopf der Uhr. Abgeleitet wird sie aus den ersten sechs
 * Zeichen des Namens — was bei „Steelworxx mit" und „Steelworxx ohne" zu
 * `STEELW` und `STEELW2` führt, zwei Adressen, die niemand auseinanderhält.
 * Deshalb darf man sie selbst setzen.
 *
 * Nur solange kein Eintrag auf sie zeigt: danach zeigten alte Tage ins Leere.
 * Das ist dieselbe Grenze, die auch das Löschen zieht.
 */
function idFeld(m, anzahl) {
  if (anzahl > 0) {
    return `<div><label>ID</label>
        <div class="sub" style="padding-top:6px"><code>${escapeHtml(m.id)}</code>
        — hat Einträge, bleibt</div></div>`;
  }
  return `<div><label>ID</label>
      <input type="text" data-feld="id" data-id="${escapeHtml(m.id)}" value="${escapeHtml(m.id)}"
             maxlength="8" autocapitalize="characters" spellcheck="false">
      <div class="sub" style="margin-top:4px">steht in <code>locked://log?m=${escapeHtml(m.id)}</code></div>
    </div>`;
}

/**
 * Die Auswahl aus drei Verschluss-Zuständen.
 *
 * Vorher stand hier ein Ja/Nein-Schalter für „zählt als verschlossen". Der ließ
 * die Unterbrechung gar nicht erst zu: eine Reinigung musste als offen gebucht
 * werden und riss damit die Phase auf. Die erklärende Zeile darunter steht
 * bewusst am gewählten Wert — was die Wahl bedeutet, gehört neben die Wahl.
 */
function lockWahl(m) {
  const wert = lockKind(m);
  const opts = LOCK_WAHL.map(o =>
    `<div class="seg-opt ${o.v === wert ? 'active' : ''}" data-wert="${o.v}">${o.l}</div>`).join('');
  const erklaerung = (LOCK_WAHL.find(o => o.v === wert) || LOCK_WAHL[2]).t;
  return `<div class="full"><label>Verschluss-Zustand</label>
      <div class="seg" data-lockkind="${escapeHtml(m.id)}">${opts}</div>
      <div class="sub" style="margin-top:6px">${erklaerung}</div>
    </div>`;
}

/** Zeigt die Preiskurve an ein paar Stützstellen — abstrakte Parameter sagen sonst nichts. */
function preisVorschau(m) {
  return 'Preis nach Wartezeit: ' + [0, 3, 7, 14, 30]
    .map(t => `${t} T → <b>${fmtNum(orgasmPrice(m, t, 1), 0)}</b>`).join(' · ');
}

function feldGeaendert(el) {
  const id = el.dataset.id;
  const feld = el.dataset.feld;
  if (feld === 'id') { setzeId(id, el.value); return; }
  const wert = el.type === 'number' ? parseFloat(String(el.value).replace(',', '.')) : el.value;
  if (el.type === 'number' && !isFinite(wert)) { showToast('Keine gültige Zahl', true); renderModelle(); return; }

  let neueId = id;
  mutateSettings(s => {
    const m = s.models.find(x => x.id === id);
    if (!m) return;
    const altesLabel = m.label;
    m[feld] = wert;
    // Solange noch kein Eintrag darauf zeigt, darf die ID dem Namen folgen —
    // „COBRAV" liest sich in CSV und Excel besser als „NEUESM". Sobald Einträge
    // existieren, bleibt sie fest, sonst zeigten alte Tage ins Leere.
    if (feld === 'label' && zaehleEvents(id) === 0) {
      const frei = s.models.filter(x => x !== m).map(x => x.id);
      // Aber nur, wenn sie ihm bisher gefolgt ist. Eine von Hand gesetzte ID
      // steht in Adressen, die anderswo eingerichtet sind — die wandert nicht
      // mit, bloß weil hier ein Name präziser wird.
      if (idFolgtNamen({ id }, altesLabel, frei)) {
        const kandidat = idFromLabel(wert, frei);
        if (kandidat !== id) { m.id = kandidat; neueId = kandidat; }
      }
    }
  });
  if (offen === id) offen = neueId;
  renderModelle();
  showToast('Gespeichert');
}

/**
 * Die ID von Hand setzen.
 *
 * Jede Ablehnung sagt, woran es lag, und zeichnet neu — das Feld steht danach
 * wieder auf dem Wert, der wirklich gilt. Eine ID, die stillschweigend anders
 * gespeichert wird als getippt, wäre hier das Schlimmste: sie steht in Adressen,
 * die man einmal einrichtet und dann jahrelang benutzt.
 */
function setzeId(alt, roh) {
  const neu = cleanId(roh);
  const fehler =
      !neu ? 'Eine ID braucht mindestens einen Buchstaben oder eine Ziffer'
    : zaehleEvents(alt) > 0 ? 'Hat Einträge — die ID bleibt'
    : (neu !== alt && getSettings().models.some(x => x.id === neu)) ? `„${neu}" ist schon vergeben`
    : null;
  if (fehler) { showToast(fehler, true); renderModelle(); return; }
  if (neu === alt) { renderModelle(); return; }

  mutateSettings(s => {
    const m = s.models.find(x => x.id === alt);
    if (m) m.id = neu;
  });
  if (offen === alt) offen = neu;
  renderModelle();
  showToast(`ID ist jetzt ${neu}`);
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
    desc: 'In Stunden, und gemeint ist wirklich offene Zeit. Für Reinigungspausen gibt es den Verschluss-Zustand „Unterbrechung" — die zählt hier gar nicht erst mit.',
    step: 0.5 },
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
 * Ohne Eintrag abgeleitet: gibt es kein Archiv, zählt alles (auch nachgetragene
 * Tage); gibt es eines, beginnt die neue Ära dort, wo die eingefrorene endet.
 *
 * Wird der Stichtag von Hand verschoben und existiert ein Archiv, muss dieses
 * mitgehen: sonst zählten die dazwischen liegenden Tage doppelt — einmal nach
 * alter, einmal nach neuer Formel — oder fielen zwischen beiden Ären heraus.
 * Der Stichtag bestimmt also, wo das Archiv endet, nicht umgekehrt.
 */
function renderStichtag() {
  const s = getSettings();
  const gesetzt = !!s.startedAt;
  const wirksam = stichtagOf(STATE.data, s);
  const legacy = STATE.data.legacy;
  const herkunft = gesetzt ? 'von Hand gesetzt'
    : (legacy ? 'abgeleitet: der Tag nach dem Archiv' : 'abgeleitet: alles zählt');

  $('stichtagBox').innerHTML = `
    <div class="setting">
      <div>
        <div class="name">Konto zählt ab</div>
        <div class="desc">${herkunft}. Leeres Feld = wieder ableiten.
          ${legacy ? `Das Archiv (bis ${fmtDate(legacy.bis)}) wird beim Verschieben neu berechnet, damit kein Tag doppelt zählt.` : ''}</div>
      </div>
      <input type="date" id="stichtagInput" value="${wirksam || ''}">
    </div>
    ${gesetzt ? '<button class="btn ghost full" id="stichtagReset" type="button">Wieder ableiten</button>' : ''}`;

  $('stichtagInput').addEventListener('change', e => setzeStichtag(e.target.value));
  const reset = $('stichtagReset');
  if (reset) reset.addEventListener('click', () => setzeStichtag(''));
}

function setzeStichtag(wert) {
  const legacy = STATE.data.legacy;
  // Ohne Wert fällt der Stichtag auf die Ableitung zurück — bei vorhandenem
  // Archiv also auf den Tag nach dessen Ende. Da bleibt das Archiv, wie es ist.
  const ziel = wert || (legacy ? isoDateAdd(legacy.bis, 1) : null);
  const verschiebt = legacy && ziel && ziel !== isoDateAdd(legacy.bis, 1);

  if (verschiebt) {
    const neu = refreezeLegacy(STATE.data, ziel);
    const vorher = Math.round(legacy.punkte).toLocaleString('de-DE');
    const nachher = neu ? Math.round(neu.punkte).toLocaleString('de-DE') : '—';
    const text = neu
      ? `Das Archiv endet dann am ${fmtDate(neu.bis)} statt am ${fmtDate(legacy.bis)}.\n\n`
        + `Seine Punktzahl ändert sich von ${vorher} auf ${nachher}.\n\n`
        + `Die Tage dazwischen wechseln die Ära — gerechnet wird nichts doppelt.`
      : `Vor dem ${fmtDate(ziel)} liegt dann nichts mehr. Das Archiv (${vorher} Punkte) entfällt und alles zählt ins neue Konto.`;
    if (!confirmAction(text)) { renderStichtag(); return; }

    mutate(data => {
      if (neu) data.legacy = neu; else delete data.legacy;
      data.settings = { ...data.settings };
      if (wert) data.settings.startedAt = wert; else delete data.settings.startedAt;
      data.settings.updatedAt = new Date().toISOString();
    });
  } else {
    mutateSettings(s2 => {
      if (wert) s2.startedAt = wert; else delete s2.startedAt;
    });
  }
  render();
  showToast(wert ? `Konto zählt ab ${fmtDate(wert)}` : 'Stichtag wieder abgeleitet');
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
