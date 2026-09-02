/**
 * Ziehen zum Aktualisieren.
 *
 * Von Hand statt über die Overscroll-Mechanik des Browsers: die Android-WebView
 * kennt die Geste gar nicht, und im installierten PWA *lädt* sie die Seite neu,
 * statt abzugleichen — für eine App, die ihren Stand lokal hält, genau das
 * Falsche. Deshalb steht in der CSS `overscroll-behavior-y: contain`, das die
 * eingebaute Variante abschaltet, und hier die eigene.
 *
 * Die Geste greift nur ganz oben (`scrollY <= 0`) und nur, wenn der Zug
 * eindeutig senkrecht ist — sonst ginge jedes seitliche Wischen als Abgleich
 * durch. Beginnt der Zug auf einer Schnelltaste, bekommt die ein
 * `pointercancel`: was als Ziehen weitergeht, war kein Halten und darf keinen
 * Eintrag auslösen.
 */

const START_PX    = 8;    // ab hier ist es ein Ziehen und kein Wackeln
const AUSLOESE_PX = 64;   // ab hier löst das Loslassen aus
const MAX_PX      = 96;
const WIDERSTAND  = 0.5;  // halbe Strecke: das Gummiband-Gefühl
const RUHE_PX     = 56;   // wie weit der Indikator über dem Rand parkt

/**
 * @param {object} opts
 * @param {function(): Promise} opts.onRefresh   was beim Auslösen läuft
 * @param {function(): boolean} [opts.kannZiehen] false = Geste bleibt aus
 */
export function initPullToRefresh({ onRefresh, kannZiehen = () => true }) {
  const el = document.getElementById('pull');
  if (!el || !('ontouchstart' in window)) return;

  let verfolgt = false;   // Finger unten und Ausgangslage passt
  let aktiv = false;      // Zug übernommen, Seite scrollt nicht mehr
  let bereit = false;     // weit genug für das Auslösen
  let laeuft = false;
  let startY = 0, startX = 0, ziel = null;

  function zeige(zug) {
    el.style.transform = `translateY(${zug - RUHE_PX}px)`;
    el.style.opacity = String(Math.min(1, zug / 36));
  }
  function zurueck() {
    aktiv = false; bereit = false; verfolgt = false;
    el.classList.remove('zieht', 'bereit', 'laedt');
    el.style.transform = '';
    el.style.opacity = '';
  }

  document.addEventListener('touchstart', (e) => {
    verfolgt = false;
    if (laeuft || e.touches.length !== 1) return;
    if (window.scrollY > 0) return;
    if (!kannZiehen()) return;
    verfolgt = true;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    ziel = e.target;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!verfolgt || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;

    if (!aktiv) {
      // Nach oben oder quer: das ist Scrollen oder Wischen, nicht unsere Geste.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { verfolgt = false; return; }
      if (dy < START_PX) return;
      aktiv = true;
      el.classList.add('zieht');
      if (ziel && ziel.dispatchEvent) {
        ziel.dispatchEvent(new Event('pointercancel', { bubbles: true }));
      }
    }

    // Ab hier gehört die Bewegung uns — sonst scrollte die Seite mit.
    e.preventDefault();
    const zug = Math.min(MAX_PX, (dy - START_PX) * WIDERSTAND);
    bereit = zug >= AUSLOESE_PX;
    el.classList.toggle('bereit', bereit);
    zeige(zug);
  }, { passive: false });

  const losgelassen = async () => {
    if (!aktiv) { verfolgt = false; return; }
    if (!bereit) { zurueck(); return; }
    laeuft = true;
    el.classList.remove('zieht', 'bereit');
    el.classList.add('laedt');
    zeige(AUSLOESE_PX);
    try { await onRefresh(); }
    finally { laeuft = false; zurueck(); }
  };
  document.addEventListener('touchend', losgelassen, { passive: true });
  document.addEventListener('touchcancel', () => { if (!laeuft) zurueck(); }, { passive: true });
}
