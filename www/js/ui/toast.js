/**
 * Kurzmeldungen am oberen Rand, optional mit einer Rückgängig-Taste.
 *
 * Drei Arten, und sie müssen sich auf einen Blick unterscheiden lassen:
 *   - `false`  grün   — es ist etwas passiert, wie gewollt
 *   - `true`   rot    — es ist etwas passiert, das kostet, oder etwas ging schief
 *   - `'info'` grau   — es ist *nichts* passiert
 * Die dritte gibt es, weil „nichts gespeichert" einmal im selben Grün kam wie
 * „gespeichert". Wer nur aus dem Augenwinkel hinsah, sah beide Male Erfolg.
 */

let el = null;
let timer = null;

function node() {
  if (!el) el = document.getElementById('toast');
  return el;
}

export function showToast(msg, art = false, action = null) {
  const t = node();
  if (!t) return;
  t.innerHTML = '<span class="toast-text"></span>';
  t.querySelector('.toast-text').textContent = msg;
  t.classList.toggle('bad', art === true);
  t.classList.toggle('info', art === 'info');
  t.classList.toggle('has-action', !!action);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'undo';
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      t.classList.remove('show', 'has-action');
      clearTimeout(timer);
      action.run();
    });
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show', 'has-action'), action ? 6000 : 1800);
}

/** Eine Ja/Nein-Rückfrage. Absichtlich über confirm(): eine eigene Modal-Ebene
 *  wäre für die drei Stellen, an denen wirklich etwas verloren gehen kann,
 *  mehr Oberfläche als Nutzen. */
export function confirmAction(text) {
  return window.confirm(text);
}
