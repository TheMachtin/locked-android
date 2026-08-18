/**
 * Locked — Drei-Wege-Merge für die Synchronisation.
 *
 * Bei einem Sync-Konflikt (zwei Geräte haben dieselbe Datei geändert) darf keine
 * Seite pauschal gewinnen. Mit dem zuletzt gemeinsam bekannten Stand ("base")
 * lässt sich unterscheiden, was jede Seite *geändert* hat — nur so ist eine
 * Löschung von "die andere Seite hat es neu angelegt" trennbar.
 *
 * Ohne base wird konservativ vereinigt: dann kann höchstens ein gelöschtes
 * Event zurückkehren, aber nichts geht verloren.
 *
 * Rein und ohne DOM — Tests in test/merge.test.js.
 */
'use strict';

/** Identität eines Events. Zeit/Typ stecken im Schlüssel: eine korrigierte
 *  Uhrzeit erscheint damit als Löschung + Neuanlage, was beim Merge korrekt
 *  zum geänderten Wert führt. */
function eventKey(e) { return `${e.date}|${e.time}|${e.type}`; }

function keySet(events) {
  const s = new Set();
  for (const e of (events || [])) s.add(eventKey(e));
  return s;
}

/** Events dreiwegig zusammenführen. */
function mergeEvents(base, local, remote) {
  const stats = { hinzu: 0, entfernt: 0 };
  const bKeys = keySet(base);
  const lKeys = keySet(local);
  const rKeys = keySet(remote);

  // Wo es keine gemeinsame Basis gibt, ist "gelöscht" nicht erkennbar → vereinigen.
  const haveBase = base !== null && base !== undefined;

  const byKey = new Map();
  for (const e of (local || []))  byKey.set(eventKey(e), e);
  for (const e of (remote || [])) if (!byKey.has(eventKey(e))) byKey.set(eventKey(e), e);
  for (const e of (base || []))   if (!byKey.has(eventKey(e))) byKey.set(eventKey(e), e);

  const out = [];
  for (const [k, e] of byKey) {
    const inB = bKeys.has(k), inL = lKeys.has(k), inR = rKeys.has(k);
    if (!haveBase) { out.push(e); continue; }
    if (inB) {
      // War bekannt: nur behalten, wenn keine Seite es gelöscht hat.
      if (inL && inR) out.push(e);
      else stats.entfernt++;
    } else {
      // Neu auf mindestens einer Seite.
      if (inL || inR) { out.push(e); if (!inL) stats.hinzu++; }
    }
  }
  out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { events: out, stats };
}

/** Ein Objekt der Form { key: wert } dreiwegig zusammenführen.
 *  Bei beidseitiger Änderung gewinnt local — das Gerät, an dem gerade gearbeitet
 *  wird, hat die frischere Absicht. Solche Fälle werden gezählt und gemeldet. */
function mergeMap(base, local, remote, onConflict) {
  const b = base || {}, l = local || {}, r = remote || {};
  const out = {};
  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
  const haveBase = base !== null && base !== undefined;
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  for (const k of keys) {
    const inB = k in b, inL = k in l, inR = k in r;
    const lChanged = haveBase ? (inL !== inB || !eq(l[k], b[k])) : inL;
    const rChanged = haveBase ? (inR !== inB || !eq(r[k], b[k])) : inR;

    if (lChanged && rChanged) {
      if (!eq(l[k], r[k]) && onConflict) onConflict(k);
      if (inL) out[k] = l[k];                    // local gewinnt
      else if (!eq(l[k], r[k])) { /* lokal gelöscht, remote geändert → bleibt gelöscht */ }
    } else if (lChanged) {
      if (inL) out[k] = l[k];
    } else if (rChanged) {
      if (inR) out[k] = r[k];
    } else if (inB) {
      out[k] = b[k];
    }
  }
  return out;
}

/**
 * Kompletten Datensatz zusammenführen.
 * @param {object|null} base   zuletzt gemeinsam bekannter Stand (null = unbekannt)
 * @param {object} local       lokaler Stand
 * @param {object} remote      Stand aus OneDrive
 * @returns {{data: object, stats: object}}
 */
function mergeData(base, local, remote) {
  const l = local || {}, r = remote || {};
  const b = base || null;
  const konflikte = [];
  const ev = mergeEvents(b && b.events, l.events, r.events);
  const days  = mergeMap(b && b.days,  l.days,  r.days,  k => konflikte.push('days:' + k));
  const notes = mergeMap(b && b.notes, l.notes, r.notes, k => konflikte.push('notes:' + k));

  return {
    data: {
      version: l.version || r.version || 2,
      events: ev.events,
      days,
      notes,
    },
    stats: {
      basisBekannt: !!b,
      eventsLokal: (l.events || []).length,
      eventsRemote: (r.events || []).length,
      eventsErgebnis: ev.events.length,
      uebernommen: ev.stats.hinzu,      // vom anderen Gerät dazugekommen
      entfernt: ev.stats.entfernt,      // auf einer Seite gelöscht
      konflikte,
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { eventKey, mergeEvents, mergeMap, mergeData };
}
