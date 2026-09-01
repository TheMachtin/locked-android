/** Kurzmeldungen am unteren Rand, optional mit einer Rückgängig-Taste. */

let el = null;
let timer = null;

function node() {
  if (!el) el = document.getElementById('toast');
  return el;
}

export function showToast(msg, bad = false, action = null) {
  const t = node();
  if (!t) return;
  t.innerHTML = '<span class="toast-text"></span>';
  t.querySelector('.toast-text').textContent = msg;
  t.classList.toggle('bad', !!bad);
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
