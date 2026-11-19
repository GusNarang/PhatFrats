// The control room's Maintenance page: the Errors card (crashes and browser errors, grouped) and the
// Uptime monitor card (the /api/health address and how to point a free monitor at it). See error-tracker.js.
(function () {
  const A = window.PFAdmin;
  const page = document.getElementById('pageMaintenance');
  if (!A || !page) return;
  const esc = A.esc;
  const css = document.createElement('style');
  css.textContent = `
  #errCard .er-item{border:1px solid var(--line);border-left:4px solid var(--red);border-radius:10px;padding:10px 12px;background:var(--night);margin-top:8px}
  #errCard .er-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
  #errCard .er-msg{font-weight:700;word-break:break-word}
  #errCard .er-meta{font-size:13px;color:var(--muted);margin-top:4px}
  #errCard pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 var(--mono);background:var(--night-2);padding:8px 10px;border-radius:8px;max-height:220px;overflow:auto;margin:8px 0 0}
  #upCard ol{margin:8px 0 0 18px;padding:0;color:var(--muted)}#upCard li{margin:4px 0}
  #upCard code{font:13px var(--mono);background:var(--night);border:1px solid var(--line);border-radius:6px;padding:2px 6px;word-break:break-all}`;
  document.head.appendChild(css);

  const err = document.createElement('section');
  err.className = 'card';
  err.id = 'errCard';
  err.style.marginBottom = '16px';
  err.innerHTML = `<div class="chart-head"><h2 style="margin:0">🐞 Errors</h2><span class="updated" id="erCounts"></span></div>
    <p class="updated" style="margin-top:6px">Crashes on the server and script errors in students' browsers, grouped so a repeat adds to the count.
      You get a bell note and an email the first time each new error shows up. Mark one fixed once it's dealt with; if it happens again, it comes back.</p>
    <div class="actions" style="justify-content:flex-start;margin-top:8px"><button class="btn small" type="button" id="erRefresh">↻ Refresh</button><button class="btn small" type="button" id="erAll" hidden>Mark all fixed</button></div>
    <div id="erList"></div>`;
  const up = document.createElement('section');
  up.className = 'card';
  up.id = 'upCard';
  up.style.marginBottom = '16px';
  const healthUrl = location.origin + '/api/health';
  up.innerHTML = `<div class="chart-head"><h2 style="margin:0">📟 Uptime monitor</h2><span class="updated">Hear within minutes if the site goes down, day or night.</span></div>
    <p style="margin:10px 0 6px">Health check address: <code>${esc(healthUrl)}</code> <button class="btn small" type="button" id="upCopy">Copy</button> <button class="btn small" type="button" id="upTest">Test it now</button></p>
    <p class="updated" id="upResult" style="margin:0"></p>
    <p style="margin:12px 0 0"><b>Set it up once (free, about 3 minutes):</b></p>
    <ol>
      <li>Sign up at <b>uptimerobot.com</b> (free plan).</li>
      <li>Click <b>New monitor</b>, choose <b>HTTP(s)</b>, and paste the address above.</li>
      <li>Set the interval to <b>5 minutes</b> and tick your email as the alert contact. Add the UptimeRobot phone app for push alerts.</li>
      <li>Save. It shows "Up" within a few minutes. If PhatFrats or its database stops answering, you get an alert.</li>
    </ol>
    <p class="updated" style="margin-top:8px">It answers "up" while the site lock is on, so planned maintenance doesn't set off alerts.</p>`;
  const sm = document.getElementById('smCard');
  page.insertBefore(err, sm || null);
  if (sm && sm.nextSibling) page.insertBefore(up, sm.nextSibling); else page.appendChild(up);
  const $ = (s) => page.querySelector(s);
  let loadedAt = 0, list = [];

  function render(d) {
    list = d.errors;
    const c = d.counts;
    $('#erCounts').textContent = c.open ? `${c.open} open · ${A.int(c.today)} in the last day · ${c.fixed} fixed this month` : `No open errors · ${c.fixed} fixed this month`;
    $('#erAll').hidden = !c.open;
    $('#erList').innerHTML = list.length ? list.map((e) => `<div class="er-item" style="${e.source === 'browser' ? 'border-left-color:var(--gold)' : ''}">
      <div class="er-top"><div><div class="er-msg">${e.source === 'browser' ? '🌐' : '🖥️'} ${esc(e.message)}</div>
        <div class="er-meta">${e.source === 'browser' ? 'In a browser' : 'On the server'}${e.path ? ' · ' + esc((e.method ? e.method + ' ' : '') + e.path) : ''} · ${A.int(e.count)} time${e.count === 1 ? '' : 's'} · first ${esc(A.ago(e.first_at))}, last ${esc(A.ago(e.last_at))}</div></div>
        <div class="actions">${e.stack ? `<button class="btn small" type="button" data-er-stack="${e.id}">Details</button>` : ''}<button class="btn small gold" type="button" data-er-fix="${e.id}">Mark fixed</button></div></div>
      <pre hidden id="erStack${e.id}">${esc(e.stack || '')}</pre></div>`).join('')
      : '<p class="updated" style="margin-top:10px">✅ No errors to look at.</p>';
  }
  async function load() {
    try { render(await A.api('/api/admin/errors')); loadedAt = Date.now(); }
    catch (e) { $('#erList').innerHTML = '<p class="updated">' + esc(e.message) + '</p>'; }
  }
  err.addEventListener('click', async (e) => {
    let b;
    if ((b = e.target.closest('[data-er-stack]'))) { const pre = $('#erStack' + b.dataset.erStack); pre.hidden = !pre.hidden; return; }
    if ((b = e.target.closest('[data-er-fix]'))) {
      b.disabled = true;
      try { await A.api('/api/admin/errors/' + b.dataset.erFix + '/resolve', {}); A.toast('Marked fixed.'); } catch (x) { A.toast(x.message); }
      load(); return;
    }
    if (e.target.closest('#erAll')) {
      if (!confirm('Mark every open error as fixed? Any that happen again come back on the list.')) return;
      try { const r = await A.api('/api/admin/errors/resolve-all', {}); A.toast(r.resolved + ' marked fixed.'); } catch (x) { A.toast(x.message); }
      load(); return;
    }
    if (e.target.closest('#erRefresh')) load();
  });
  $('#upCopy').onclick = () => {
    (navigator.clipboard ? navigator.clipboard.writeText(healthUrl) : Promise.reject()).then(() => A.toast('Copied.'), () => A.toast('Copy it from the box.'));
  };
  $('#upTest').onclick = async () => {
    $('#upResult').textContent = 'Checking…';
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      $('#upResult').textContent = r.ok ? `✅ Up. The site and database answered in ${d.ms} ms${d.locked ? ' (the site lock is on)' : ''}.` : `❌ Down: ${d.error || 'status ' + r.status}.`;
    } catch (x) { $('#upResult').textContent = '❌ No answer: ' + x.message; }
  };

  const prev = window.PFSiteMaint && window.PFSiteMaint.onPage;
  window.PFSiteMaint = { onPage(p) { if (prev) prev(p); if (p === 'maintenance' && Date.now() - loadedAt > 30000) load(); } };
  if (A.state && A.state.page === 'maintenance') load();
})();
