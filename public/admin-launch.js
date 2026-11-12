// The control room's Launch check card (top of Overview): green, amber or red for every outside service,
// with buttons that send you a real test text and email. See launch-check.js on the server.
(function () {
  const A = window.PFAdmin;
  if (!A) return;
  const esc = A.esc;
  const css = document.createElement('style');
  css.textContent = `
  #launchCard{margin-bottom:16px}
  #launchCard summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  #launchCard summary::-webkit-details-marker{display:none}
  .lc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin-top:14px}
  .lc-item{border:1px solid var(--line);border-left:5px solid var(--lc);border-radius:12px;padding:12px 14px;background:var(--night)}
  .lc-item b{display:flex;gap:8px;align-items:center}
  .lc-item p{margin:6px 0 0;font-size:14px;color:var(--muted)}
  .lc-sum{font:500 13px var(--mono)}
  .lc-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}`;
  document.head.appendChild(css);
  const LOOK = { ok: ['✅', 'var(--lime, #9dff4a)', 'Ready'], warn: ['⚠️', 'var(--gold, #ffd23f)', 'Needs attention'], off: ['⭕', 'var(--muted)', 'Not set up'], bad: ['❌', 'var(--red, #ff5d6c)', 'Broken'], manual: ['👀', 'var(--cyan, #35e0ff)', 'Check yourself'] };

  const card = document.createElement('details');
  card.className = 'card';
  card.id = 'launchCard';
  const page = document.getElementById('pageOverview');
  page.insertBefore(card, page.firstChild);

  async function load() {
    card.innerHTML = '<summary><h2 style="margin:0">🚀 Launch check</h2><span class="updated">Checking…</span></summary>';
    let d;
    try { d = await A.api('/api/admin/launch-check'); }
    catch (err) { card.innerHTML = '<summary><h2 style="margin:0">🚀 Launch check</h2><span class="updated">' + esc(err.message) + '</span></summary>'; return; }
    const count = (k) => d.items.filter((i) => i.state === k).length;
    const allGood = !count('bad') && !count('off') && !count('warn');
    card.open = !allGood && card.dataset.touched !== '1';
    card.innerHTML = '<summary><h2 style="margin:0">🚀 Launch check</h2><span class="lc-sum">'
      + (allGood ? '✅ Everything is set up' : [count('ok') + ' ready', count('warn') + ' need attention', count('off') + ' not set up', count('bad') ? count('bad') + ' broken' : ''].filter(Boolean).join(' · '))
      + ' · checked ' + esc(A.ago(d.checkedAt)) + '</span></summary>'
      + '<div class="lc-list">' + d.items.map((i) => {
        const [icon, color, label] = LOOK[i.state] || LOOK.manual;
        return '<div class="lc-item" style="--lc:' + color + '"><b>' + icon + ' ' + esc(i.name) + ' <span class="updated">' + label + '</span></b><p>' + esc(i.detail) + '</p>' + (i.extra ? '<p>' + esc(i.extra) + '</p>' : '') + '</div>';
      }).join('') + '</div>'
      + '<div class="lc-btns"><button class="btn small" type="button" data-lc="text">📱 Send me a test text</button>'
      + '<button class="btn small" type="button" data-lc="email">✉️ Send me a test email</button>'
      + '<button class="btn small" type="button" data-lc="again">↻ Check again</button>'
      + '<span class="updated">Test text goes to ' + (d.me.phoneVerified ? esc(d.me.phone) : 'your phone, once you confirm it in your profile on the main site') + '. Test email goes to ' + esc(d.me.email) + '.</span></div>';
  }
  card.addEventListener('toggle', () => { card.dataset.touched = '1'; });
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lc]'); if (!b) return;
    if (b.dataset.lc === 'again') { load(); return; }
    b.disabled = true;
    try {
      const r = await A.api('/api/admin/launch-check/' + b.dataset.lc, {});
      A.toast(b.dataset.lc === 'text' ? 'Test text sent to ' + r.to + '. Check your phone.' : 'Test email sent to ' + r.to + '. Check your inbox (and spam).');
    } catch (err) { A.toast(err.message); }
    finally { b.disabled = false; }
  });
  load();
})();
