/**
 * Einklappbare Karten.
 *
 * Eine Karte mit `data-collapse="schlüssel"` bekommt ihre Überschrift als
 * Schalter; alles in `.collapse-body` verschwindet beim Zuklappen. Der Zustand
 * bleibt je Schlüssel im localStorage stehen — wer die Punktesätze aufgeklappt
 * lässt, findet sie beim nächsten Start wieder offen, und wer sie zuklappt,
 * muss das nicht bei jedem Blick in die App wiederholen.
 *
 * Der Startzustand steht am Element (`data-collapse-default="zu"`), nicht hier:
 * ob eine Karte zugeklappt beginnt, ist eine Aussage über ihren Inhalt und
 * gehört neben ihn.
 */

const PRAEFIX = 'locked_collapse_';

function gespeichert(key) {
  try { return localStorage.getItem(PRAEFIX + key); } catch { return null; }
}
function merken(key, wert) {
  try { localStorage.setItem(PRAEFIX + key, wert); } catch {}
}

function setzen(card, zu) {
  card.classList.toggle('zu', zu);
  const kopf = card.querySelector(':scope > h2');
  if (kopf) kopf.setAttribute('aria-expanded', zu ? 'false' : 'true');
}

/**
 * Alle einklappbaren Karten unterhalb von `root` verdrahten.
 * Mehrfach aufrufbar: bereits verdrahtete Karten werden übersprungen.
 */
export function initCollapse(root) {
  const wurzel = root || document;
  for (const card of wurzel.querySelectorAll('[data-collapse]')) {
    if (card.dataset.collapseBereit) continue;
    card.dataset.collapseBereit = '1';
    const key = card.dataset.collapse;
    const gespeicherterWert = gespeichert(key);
    const zu = gespeicherterWert != null
      ? gespeicherterWert === 'zu'
      : card.dataset.collapseDefault === 'zu';
    setzen(card, zu);

    const kopf = card.querySelector(':scope > h2');
    if (!kopf) continue;
    kopf.setAttribute('role', 'button');
    kopf.setAttribute('tabindex', '0');
    const um = () => {
      const neu = !card.classList.contains('zu');
      setzen(card, neu);
      merken(key, neu ? 'zu' : 'auf');
    };
    kopf.addEventListener('click', um);
    kopf.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); um(); }
    });
  }
}

/** Eine Karte von außen aufklappen — etwa, wenn ihr Inhalt gerade wichtig ist. */
export function openCollapse(key) {
  const card = document.querySelector(`[data-collapse="${key}"]`);
  if (!card) return;
  setzen(card, false);
  merken(key, 'auf');
}
