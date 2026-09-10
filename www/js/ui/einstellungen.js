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
 *
 * Die dritte ist auf Zeit gesetzt: eine laufende Sperre (siehe `isFrozen()` im
 * Kern) hält alles fest, was in die Punkte eingeht. Jeder Schreibweg hier fragt
 * sie ab — die Felder werden zusätzlich ausgegraut, aber ein ausgegrautes Feld
 * ist eine Bitte, keine Sicherung.
 */

import { STATE, calc, mutate, mutateSettings, settings as getSettings } from '../state.js';
import { showToast, confirmAction } from './toast.js';
import { fmtNum, escapeHtml, fmtDateShort as fmtDate, fmtDurationShort } from './format.js';
import {
  KIND_MODEL, KIND_ORGASM, idFromLabel, cleanId, idFolgtNamen, defaultSettings,
  PALETTE, orgasmPrice, stichtagOf, lockKind, applyLockKind,
  isFrozen, freezeUntilMs, freezeRestMs, FROZEN_MODEL_FIELDS,
} from '../core/settings.js';
import { refreezeLegacy } from '../core/legacy.js';
import { isoDateAdd, isoOf, hmOf } from '../core/time.js';

const $ = id => document.getElementById(id);
let offen = null;      // ID des gerade aufgeklappten Modells

function zaehleEvents(id) {
  return (STATE.data.events || []).filter(e => e.type === id).length;
}

// =========================== WÄCHTER ===========================
/**
 * Steht eine Sperre? Dann sagt der Wächter, was gerade nicht geht, und der
 * aufrufende Weg bricht ab.
 *
 * Er steht vor *jedem* Schreibweg, der Punkte verschiebt — auch dort, wo das
 * Eingabefeld schon ausgegraut ist. Ein `disabled` ist eine Anzeige, die sich
 * mit zwei Handgriffen in den Entwicklerwerkzeugen entfernen lässt; diese
 * Abfrage ist die eigentliche Sperre.
 */
function gesperrt(was) {
  const s = getSettings();
  if (!isFrozen(s)) return false;
  showToast(`${was} ist eingefroren — noch ${fmtDurationShort(freezeRestMs(s))}`, true);
  return true;
}
const istGesperrt = () => isFrozen(getSettings());
/** `disabled` für ein Feld, das die Sperre festhält. */
const sperrAttr = () => (istGesperrt() ? ' disabled' : '');

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
    if (gesperrt('Der Verschluss-Zustand')) return;
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
    if (gesperrt('Die Registry')) return;
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
    t: 'Zählt als verschlossene Zeit, verdient den Stundensatz und trägt die ungeöffnete Strecke.' },
  { v: 'pause', l: 'Unterbrechung',
    t: 'Reinigung und dergleichen: verdient nichts, kostet nichts — und beendet die verschlossene Phase nicht.' },
  { v: 'open', l: 'Offen',
    t: 'Zählt als offene Zeit und setzt die verschlossene Phase auf null zurück.' },
];

function modelEditor(m, anzahl) {
  // Was in die Punkte eingeht, ist während einer Sperre ausgegraut; Name, Farbe
  // und ID bleiben frei — sie verschieben keine Zahl.
  const feld = (label, id, typ, wert, extra = '') => {
    const zu = FROZEN_MODEL_FIELDS.includes(id) && istGesperrt();
    return `<div><label>${label}${zu ? ' 🔒' : ''}</label>`
      + `<input type="${typ}" data-feld="${id}" data-id="${m.id}" value="${wert}" ${extra}${zu ? ' disabled' : ''}></div>`;
  };

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

  const loeschbar = !m.isOpen && anzahl === 0 && !istGesperrt();
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
  const zu = istGesperrt();
  return `<div class="full"><label>Verschluss-Zustand${zu ? ' 🔒' : ''}</label>
      <div class="seg${zu ? ' gesperrt' : ''}" data-lockkind="${escapeHtml(m.id)}">${opts}</div>
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
  if (FROZEN_MODEL_FIELDS.includes(feld) && gesperrt('Dieser Satz')) { renderModelle(); return; }
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
  // Ein neues Modell mit Satz 5 tut dasselbe wie ein erhöhter Punktesatz — ohne
  // diese Zeile wäre die Sperre mit einem Klick umgangen.
  if (gesperrt('Die Registry')) return;
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
  { key: 'bonusUngeoeffnet', name: 'Zuschlag je Tag am Stück im selben Käfig',
    desc: 'Ein Tag sind 24 Stunden ab dem Verschluss. Der Zuschlag steigt mit der Strecke — der fünfte ungeöffnete Tag bringt das Fünffache — und jeder Modellwechsel wie jede Unterbrechung setzt sie zurück. 0 schaltet die Belohnung ab.',
    step: 0.5 },
  { key: 'bonusUngeoeffnetCap', name: 'Höchster Zuschlag für die ungeöffnete Strecke',
    desc: 'Der Deckel des Anstiegs — bei Satz 1 also der Tag, ab dem es nicht mehr weiter steigt. Ohne ihn wüchse die Strecke über alles andere hinaus.',
    step: 1 },
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
  { key: 'inactivityReminderDays', name: 'Erinnerung nach … Tagen ohne Lebenszeichen', desc: 'Nur Android: die Benachrichtigung. Gezählt wird ab dem letzten Eintrag oder dem letzten Blick in die App — je nachdem, was später war.', step: 1 },
  { key: 'inactivityAutoDays', name: 'Vorschläge nach … Tagen ohne Lebenszeichen', desc: 'Ab hier schlägt die App fehlende Einträge vor — geschrieben wird erst nach deiner Bestätigung.', step: 1 },
  { key: 'seenAfterSeconds', name: 'Als Blick zählt die App ab … Sekunden', desc: 'So lange muss sie offen sein, damit die Frist neu beginnt. Ein Fehlgriff in der Hosentasche soll das nicht können. 0 lässt jedes Öffnen zählen.', step: 1 },
];

function renderZahlen() {
  const s = getSettings();
  // Nur die Punktesätze hält die Sperre fest. Die Inaktivitäts-Regeln bleiben
  // frei: sie steuern, wann die App nachfragt, nicht, was eine Stunde wert ist.
  const bau = (felder, quelle, gruppe) => {
    const zu = gruppe === 'points' && istGesperrt();
    return felder.map(f => `<div class="setting">
      <div><div class="name">${f.name}${zu ? ' 🔒' : ''}</div><div class="desc">${f.desc}</div></div>
      <input type="number" step="${f.step}" value="${quelle[f.key]}" data-punkt="${f.key}" data-gruppe="${gruppe}"${zu ? ' disabled' : ''}>
    </div>`).join('');
  };
  $('pointSettings').innerHTML = bau(PUNKT_FELDER, s.points, 'points');
  $('ruleSettings').innerHTML = bau(REGEL_FELDER, s.rules, 'rules');

  document.querySelectorAll('[data-punkt]').forEach(el => el.addEventListener('change', () => {
    if (el.dataset.gruppe === 'points' && gesperrt('Dieser Satz')) { renderZahlen(); return; }
    const wert = parseFloat(String(el.value).replace(',', '.'));
    if (!isFinite(wert)) { showToast('Keine gültige Zahl', true); renderZahlen(); return; }
    mutateSettings(s2 => { s2[el.dataset.gruppe][el.dataset.punkt] = wert; });
    renderZahlen();
    renderVorschau();
    showToast('Gespeichert');
  }));
}

// =========================== EINFRIEREN ===========================
/** Vorschläge für die Frist. Frei wählbar bleibt sie über das Datumsfeld. */
const FREEZE_PILLS = [7, 30, 90, 365];

const freezeZielIso = (tage) => isoDateAdd(isoOf(new Date()), tage);

/**
 * Was die Sperre umfasst — einmal formuliert, an zwei Stellen gezeigt.
 * Wer sie setzt, soll vorher lesen können, was ihm danach fehlt.
 */
const FREEZE_UMFANG = 'Gesperrt sind: die Punktesätze, die Stundensätze und '
  + 'Verschluss-Zustände der Modelle, die Orgasmus-Preise, neue oder gelöschte '
  + 'Modelle und das Zurücksetzen auf Standard. Frei bleiben: Einträge, Namen, '
  + 'Farben, IDs, Archivieren, der Stichtag und die Inaktivitäts-Regeln.';

function renderFreeze() {
  const s = getSettings();
  const box = $('freezeBox');
  const badge = $('freezeBadge');
  const rest = freezeRestMs(s);
  const bis = freezeUntilMs(s);
  const bisDatum = bis != null ? isoOf(new Date(bis)) : null;

  if (rest > 0) {
    badge.textContent = `🔒 bis ${fmtDate(bisDatum)}`;
    box.className = 'freeze on';
    box.innerHTML = `
      <div class="fz-kopf">
        <div class="fz-titel">🔒 Eingefroren bis ${fmtDate(bisDatum)}, ${hmOf(new Date(bis))}</div>
        <div class="fz-rest">noch ${fmtDurationShort(rest)}</div>
      </div>
      <div class="small" style="margin-top:8px">${FREEZE_UMFANG}</div>
      <div class="small">Verlängern geht jederzeit, aufheben nicht — sonst wäre die
        Sperre keine. Sie läuft von allein aus.</div>
      <div class="date-pills" style="margin-top:10px">
        ${FREEZE_PILLS.map(t => `<button class="pill" type="button" data-frost-plus="${t}">+${t} T</button>`).join('')}
      </div>
      <div class="setting" style="border-bottom:none">
        <div><div class="name">Verlängern bis</div></div>
        <input type="date" id="freezeBis" value="${bisDatum}" min="${freezeZielIso(1)}">
      </div>`;
  } else {
    badge.textContent = bis != null ? `Sperre lief am ${fmtDate(bisDatum)} aus` : '';
    box.className = 'freeze';
    box.innerHTML = `
      <div class="fz-titel">Punktesätze einfrieren</div>
      <div class="small" style="margin-top:6px">Ein Ziel ist keins, wenn man unterwegs
        die Sätze anheben kann. Die Sperre nimmt das für eine selbst gewählte Frist
        aus der Hand: verlängern geht, vorzeitig aufheben nicht.</div>
      <div class="small">${FREEZE_UMFANG}</div>
      <div class="date-pills" style="margin-top:10px">
        ${FREEZE_PILLS.map(t => `<button class="pill" type="button" data-frost="${t}">${t} Tage</button>`).join('')}
      </div>
      <div class="setting" style="border-bottom:none">
        <div><div class="name">Oder bis zum</div></div>
        <input type="date" id="freezeBis" min="${freezeZielIso(1)}">
      </div>
      <button class="btn danger-outline full" id="freezeStart" type="button">Einfrieren</button>`;
  }

  box.querySelectorAll('[data-frost]').forEach(el => el.addEventListener('click', () => {
    $('freezeBis').value = freezeZielIso(parseInt(el.dataset.frost, 10));
    box.querySelectorAll('[data-frost]').forEach(x => x.classList.toggle('active', x === el));
  }));
  box.querySelectorAll('[data-frost-plus]').forEach(el => el.addEventListener('click', () => {
    setzeFreeze(isoDateAdd(bisDatum, parseInt(el.dataset.frostPlus, 10)));
  }));
  const feld = $('freezeBis');
  if (feld && rest > 0) feld.addEventListener('change', e => setzeFreeze(e.target.value));
  const start = $('freezeStart');
  if (start) start.addEventListener('click', () => setzeFreeze($('freezeBis').value));
}

/**
 * Die Frist setzen oder verlängern.
 *
 * Sie endet um 23:59 des gewählten Tages — ein Datum ohne Uhrzeit hieße
 * Mitternacht und damit einen Tag weniger, als dasteht. Kürzer geht nie: eine
 * Sperre, die sich zurückdrehen lässt, hält nichts fest.
 */
function setzeFreeze(wert) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wert || '')) { showToast('Kein gültiges Datum', true); renderFreeze(); return; }
  const ziel = new Date(wert + 'T23:59:59');
  const jetzt = Date.now();
  if (ziel.getTime() <= jetzt) { showToast('Das liegt nicht in der Zukunft', true); renderFreeze(); return; }

  const s = getSettings();
  const bisher = freezeUntilMs(s);
  const laeuft = isFrozen(s);
  if (laeuft && ziel.getTime() <= bisher) {
    showToast('Eine laufende Sperre lässt sich nur verlängern', true);
    renderFreeze();
    return;
  }
  const dauer = fmtDurationShort(ziel.getTime() - jetzt);
  const frage = laeuft
    ? `Sperre bis ${fmtDate(wert)} verlängern?\n\nDanach sind es noch ${dauer}.`
    : `Punktesätze bis ${fmtDate(wert)} einfrieren?\n\nDas sind ${dauer}. `
      + `Vorzeitig aufheben geht nicht.\n\n${FREEZE_UMFANG}`;
  if (!confirmAction(frage)) { renderFreeze(); return; }

  mutateSettings(s2 => {
    s2.freeze = {
      until: ziel.toISOString(),
      since: (laeuft && s.freeze && s.freeze.since) ? s.freeze.since : new Date(jetzt).toISOString(),
    };
  });
  render();
  showToast(laeuft ? `Verlängert bis ${fmtDate(wert)}` : `Eingefroren bis ${fmtDate(wert)}`);
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
  const rechne = (verschlH, streak, uoTage = 0) => {
    const offenH = 24 - verschlH;
    const uoBonus = uoTage > 0 ? Math.min(P.bonusUngeoeffnet * uoTage, P.bonusUngeoeffnetCap) : 0;
    const mult = Math.min(1 + P.streakK * streak, P.streakCap);
    return (verschlH * satz.rate + uoBonus) * mult + offenH * Math.min(0, offenM ? offenM.rate : 0);
  };
  // Erster und siebter Tag stehen nebeneinander, weil dazwischen die ganze
  // Wirkung der Strecke liegt — sonst dreht man an einem Satz, dessen Folge
  // erst eine Woche später sichtbar wird.
  const zeilen = [
    ['24 h verschlossen, Tag des Wechsels', rechne(24, 30, 0)],
    ['24 h verschlossen, 1. Tag am Stück', rechne(24, 30, 1)],
    ['24 h verschlossen, 7. Tag am Stück', rechne(24, 30, 7)],
    ['24 h verschlossen, beide Deckel erreicht', rechne(24, 1e6, 1e6)],
    ['12 h offen, Streak 30', rechne(12, 30)],
  ];
  const grenzwert = rechne(24, 30, 7) / (1 - P.formDecay);
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
    // Der Weg mit den wenigsten Klicks an der Sperre vorbei: einmal
    // zurücksetzen, und alle Sätze stehen wieder frei da.
    if (gesperrt('Das Zurücksetzen')) return;
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

/**
 * Die Unterzeilen der eingeklappten Karten.
 *
 * Eine zugeklappte Karte, die nur ihren Namen zeigt, verlangt einen Klick, um
 * die Frage „steht da noch, was ich denke" zu beantworten. Diese Zeilen
 * beantworten sie vorher.
 */
function renderKopfzeilen() {
  const s = getSettings();
  const aktiv = s.models.filter(m => !m.archived).length;
  const archiviert = s.models.length - aktiv;
  $('modelleSub').textContent = `${aktiv} aktiv`
    + (archiviert ? ` · ${archiviert} archiviert` : '')
    // Die Sperre sitzt in der Karte darunter, wirkt aber auch hier — das gehört
    // dorthin, wo man auf ein ausgegrautes Feld stößt.
    + (istGesperrt() ? ' · 🔒 Sätze eingefroren' : '');

  const wirksam = stichtagOf(STATE.data, s);
  $('stichtagSub').textContent = wirksam ? `ab ${fmtDate(wirksam)}` : 'alles zählt';

  const r = s.rules;
  $('inaktivSub').textContent =
    `Erinnerung ${fmtNum(r.inactivityReminderDays, 0)} T · Vorschläge ${fmtNum(r.inactivityAutoDays, 0)} T`;
}

export function render() {
  renderModelle();
  renderFreeze();
  renderZahlen();
  renderVorschau();
  renderStichtag();
  renderKopfzeilen();
}
