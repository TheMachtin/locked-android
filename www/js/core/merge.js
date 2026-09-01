/**
 * Drei-Wege-Merge für die Synchronisation.
 *
 * Bei einem Sync-Konflikt (zwei Geräte haben dieselbe Datei geändert) darf keine
 * Seite pauschal gewinnen. Mit dem zuletzt gemeinsam bekannten Stand ("base")
 * lässt sich unterscheiden, was jede Seite *geändert* hat — nur so ist eine
 * Löschung von "die andere Seite hat es neu angelegt" trennbar.
 *
 * Ohne base wird konservativ vereinigt: dann kann höchstens ein gelöschtes
 * Event zurückkehren, aber nichts geht verloren.
 */

/** Identität eines Events. Zeit/Typ stecken im Schlüssel: eine korrigierte
 *  Uhrzeit erscheint damit als Löschung + Neuanlage, was beim Merge korrekt
 *  zum geänderten Wert führt. */
export function eventKey(e) { return `${e.date}|${e.time}|${e.type}`; }

function keySet(events, keyOf) {
  const s = new Set();
  for (const e of (events || [])) s.add(keyOf(e));
  return s;
}

/** Eine Liste identifizierbarer Objekte dreiwegig zusammenführen. */
export function mergeList(base, local, remote, keyOf) {
  const stats = { hinzu: 0, entfernt: 0 };
  const bKeys = keySet(base, keyOf);
  const lKeys = keySet(local, keyOf);
  const rKeys = keySet(remote, keyOf);
  const haveBase = base !== null && base !== undefined;

  const byKey = new Map();
  for (const e of (local || []))  byKey.set(keyOf(e), e);
  for (const e of (remote || [])) if (!byKey.has(keyOf(e))) byKey.set(keyOf(e), e);
  for (const e of (base || []))   if (!byKey.has(keyOf(e))) byKey.set(keyOf(e), e);

  const out = [];
  for (const [k, e] of byKey) {
    const inB = bKeys.has(k), inL = lKeys.has(k), inR = rKeys.has(k);
    if (!haveBase) { out.push(e); continue; }
    if (inB) {
      // War bekannt: nur behalten, wenn keine Seite es gelöscht hat.
      if (inL && inR) out.push(e);
      else stats.entfernt++;
    } else if (inL || inR) {
      out.push(e);
      if (!inL) stats.hinzu++;
    }
  }
  return { items: out, stats };
}

export function mergeEvents(base, local, remote) {
  const r = mergeList(base, local, remote, eventKey);
  r.items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { events: r.items, stats: r.stats };
}

/** Ein Objekt der Form { key: wert } dreiwegig zusammenführen.
 *  Bei beidseitiger Änderung gewinnt local — das Gerät, an dem gerade gearbeitet
 *  wird, hat die frischere Absicht. Solche Fälle werden gezählt und gemeldet. */
export function mergeMap(base, local, remote, onConflict) {
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
 * Einstellungen: die zuletzt bearbeitete Fassung gewinnt als Ganzes.
 *
 * Feldweises Mischen wäre hier gefährlich statt hilfreich — ein halb vom Handy
 * und halb vom PC zusammengesetzter Satz Modelle könnte Regeln verletzen, die
 * beide Seiten für sich eingehalten haben (etwa genau ein „offen"-Zustand).
 * Einstellungen ändert man selten und bewusst; der jüngere Stand ist gemeint.
 */
export function mergeSettings(local, remote) {
  if (!local) return remote || undefined;
  if (!remote) return local;
  const lt = Date.parse(local.updatedAt || '') || 0;
  const rt = Date.parse(remote.updatedAt || '') || 0;
  return rt > lt ? remote : local;
}

/**
 * Kompletten Datensatz zusammenführen.
 * @param {object|null} base   zuletzt gemeinsam bekannter Stand (null = unbekannt)
 * @param {object} local       lokaler Stand
 * @param {object} remote      Stand aus der Cloud
 */
export function mergeData(base, local, remote) {
  const l = local || {}, r = remote || {};
  const b = base || null;
  const konflikte = [];
  const ev = mergeEvents(b && b.events, l.events, r.events);
  const days  = mergeMap(b && b.days,  l.days,  r.days,  k => konflikte.push('days:' + k));
  const notes = mergeMap(b && b.notes, l.notes, r.notes, k => konflikte.push('notes:' + k));
  const bk = mergeList(b && b.bookings, l.bookings, r.bookings, x => String(x.id));

  // meta: der spätere Zeitstempel gewinnt — ein Vorschlag, den ein Gerät später
  // verworfen hat, soll nicht durch den älteren Stand des anderen zurückkommen.
  const meta = { ...(r.meta || {}), ...(l.meta || {}) };
  const dl = Date.parse((l.meta || {}).escalationDismissedAt || '') || 0;
  const dr = Date.parse((r.meta || {}).escalationDismissedAt || '') || 0;
  if (dr > dl && (r.meta || {}).escalationDismissedAt) {
    meta.escalationDismissedAt = r.meta.escalationDismissedAt;
  }

  const data = {
    version: Math.max(l.version || 0, r.version || 0) || 3,
    events: ev.events,
    days, notes,
    meta,
  };
  // Das Archiv ist unveränderlich: einmal eingefroren, nie wieder überschrieben.
  const legacy = l.legacy || r.legacy;
  if (legacy) data.legacy = legacy;
  // Der Stichtag steckt in den Einstellungen (falls von Hand gesetzt) und folgt
  // damit derselben Regel: die zuletzt bearbeitete Fassung gewinnt.
  const settings = mergeSettings(l.settings, r.settings);
  if (settings) data.settings = settings;
  if (bk.items.length) data.bookings = bk.items;

  return {
    data,
    stats: {
      basisBekannt: !!b,
      eventsLokal: (l.events || []).length,
      eventsRemote: (r.events || []).length,
      eventsErgebnis: ev.events.length,
      uebernommen: ev.stats.hinzu,
      entfernt: ev.stats.entfernt,
      einstellungenVonRemote: !!(settings && r.settings && settings === r.settings && l.settings !== r.settings),
      konflikte,
    },
  };
}
