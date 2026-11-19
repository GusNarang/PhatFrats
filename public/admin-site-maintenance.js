// The control room's Maintenance page: run full maintenance or a check, see the results and past runs.
// The site lock card above it is admin-maintenance.js. See site-maintenance.js on the server.
(function () {
  const A = window.PFAdmin;
  const page = document.getElementById('pageMaintenance');
  if (!A || !page) return;
  const esc = A.esc;
  const css = document.createElement('style');
  css.textContent = `
  #smCard .sm-btns{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0 4px}
  #smCard .sm-sum{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  #smCard .sm-pill{font:500 13px var(--mono);border:1px solid var(--line);border-radius:999px;padding:4px 10px}
  #smCard .sm-group{margin-top:16px}
  #smCard .sm-group h3{font-size:15px;margin:0 0 8px}
  #smCard .sm-list{display:grid;gap:6px}
  #smCard .sm-step{display:grid;grid-template-columns:26px 1fr;gap:8px;border:1px solid var(--line);border-left:4px solid var(--sc);border-radius:10px;padding:8px 12px;background:var(--night)}
  #smCard .sm-step b{font-size:14px}
  #smCard .sm-step p{margin:2px 0 0;font-size:13px;color:var(--muted)}
  #smCard .sm-busy{display:inline-flex;gap:8px;align-items:center;color:var(--muted);font-size:14px}
  #smCard .sm-busy i{width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--cyan);border-radius:50%;animation:smSpin .8s linear infinite}
  @keyframes smSpin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){#smCard .sm-busy i{animation:none}}
  #smHist td,#smHist th{padding:8px 10px;text-align:left;font-size:14px;border-bottom:1px solid var(--line)}
  #smHist{width:100%;border-collapse:collapse}
  .sm-scroll{overflow-x:auto}`;
  document.head.appendChild(css);

  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'smCard';
  card.style.marginBottom = '16px';
  card.innerHTML = `
    <div class="chart-head"><h2 style="margin:0">🩺 Site maintenance</h2><span class="updated" id="smNext"></span></div>
    <p class="updated" style="margin-top:6px">Clears expired temporary data, then checks the database, the data, every page and file, and outside services.
      It never deletes accounts, parties, requests, payments or messages. The site stays open while it runs.</p>
    <div class="sm-btns">
      <button class="bigbtn go" type="button" id="smRun">Run full maintenance</button>
      <button class="bigbtn" type="button" id="smDry">Check only</button>
      <span id="smBusy"></span>
    </div>
    <details style="margin-top:8px"><summary class="updated" style="cursor:pointer">What clean-up clears</summary><ul id="smWhat" class="updated" style="margin:8px 0 0 18px;padding:0"></ul></details>
    <div id="smResult"></div>`;
  const hist = document.createElement('section');
  hist.className = 'card';
  hist.innerHTML = '<h2>📜 Past runs</h2><div class="sm-scroll"><table id="smHist"><thead><tr><th>When</th><th>Started by</th><th>Kind</th><th>Result</th><th></th></tr></thead><tbody></tbody></table></div>';
  page.appendChild(card);
  page.appendChild(hist);
  const $ = (s) => page.querySelector(s);

  const LOOK = { ok: ['✅', 'var(--lime)'], warn: ['⚠️', 'var(--gold)'], bad: ['❌', 'var(--red)'] };
  const fmt = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const secs = (r) => Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000));
  const sumText = (s) => [s.bad ? s.bad + ' problem' + (s.bad === 1 ? '' : 's') : '', s.warn ? s.warn + ' to look at' : '', s.ok + ' fine'].filter(Boolean).join(' · ');
  let running = false, loadedAt = 0, data = null;

  function renderRun(r) {
    if (!r) { $('#smResult').innerHTML = '<p class="updated">No runs yet. Press Run full maintenance, or Check only to see what it would do first.</p>'; return; }
    const s = r.summary;
    const head = r.dryRun ? 'Check only' : 'Full maintenance';
    const pills = [
      `<span class="sm-pill">${esc(head)} · ${esc(fmt(r.startedAt))} · ${secs(r)}s</span>`,
      s.bad ? `<span class="sm-pill" style="border-color:var(--red);color:#ffc0c6">❌ ${s.bad} problem${s.bad === 1 ? '' : 's'}</span>` : '',
      s.warn ? `<span class="sm-pill" style="border-color:var(--gold);color:#ffe9a3">⚠️ ${s.warn} to look at</span>` : '',
      `<span class="sm-pill" style="border-color:var(--lime);color:#d8ffb5">✅ ${s.ok} fine</span>`,
      r.dryRun ? `<span class="sm-pill">Would clear ${A.int(s.wouldClear || 0)} rows</span>` : `<span class="sm-pill">🧹 Cleared ${A.int(s.cleared || 0)} rows</span>`,
    ].join('');
    // Problems first within each group, so they're the first thing you see.
    const order = { bad: 0, warn: 1, ok: 2 };
    $('#smResult').innerHTML = `<div class="sm-sum">${pills}</div>` + (r.groups || []).map((g) => `
      <div class="sm-group"><h3>${esc(g.name)}</h3><div class="sm-list">${[...g.steps].sort((a, b) => (order[a.state] ?? 2) - (order[b.state] ?? 2)).map((st) => {
        const [icon, color] = LOOK[st.state] || LOOK.ok;
        return `<div class="sm-step" style="--sc:${color}"><span>${icon}</span><div><b>${esc(st.name)}</b><p>${esc(st.detail || '')}</p></div></div>`;
      }).join('')}</div></div>`).join('');
  }

  function renderHistory(runs) {
    $('#smHist tbody').innerHTML = runs.length ? runs.map((r) => `<tr>
      <td>${esc(fmt(r.startedAt))}</td>
      <td>${r.trigger === 'monthly' ? '🗓️ Automatic (monthly)' : esc(r.by || 'An admin')}</td>
      <td>${r.dryRun ? 'Check only' : 'Full'}</td>
      <td>${esc(sumText(r.summary))}${r.dryRun ? '' : ' · cleared ' + A.int(r.summary.cleared || 0)}</td>
      <td><button class="btn small" type="button" data-run="${r.id}">View</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="updated">No runs yet.</td></tr>';
  }

  function busy(on, text) {
    running = on;
    $('#smRun').disabled = on; $('#smDry').disabled = on;
    $('#smBusy').innerHTML = on ? `<span class="sm-busy"><i></i>${esc(text)}</span>` : '';
  }

  async function load() {
    try {
      data = await A.api('/api/admin/site-maintenance');
      loadedAt = Date.now();
      $('#smNext').textContent = 'Runs by itself next on ' + fmt(data.nextMonthly);
      $('#smWhat').innerHTML = data.cleanups.map((c) => '<li>' + esc(c) + '</li>').join('');
      if (!running) {
        renderRun(data.last);
        if (data.running) busy(true, 'Another run is going. Refresh in a moment.');
      }
      renderHistory(data.runs);
    } catch (err) { $('#smResult').innerHTML = '<p class="updated">' + esc(err.message) + '</p>'; }
  }

  async function run(dryRun) {
    if (running) return;
    if (!dryRun && !confirm('Run full maintenance now? It clears expired temporary data and checks the whole site. The site stays open while it runs.')) return;
    busy(true, dryRun ? 'Checking… usually under 20 seconds.' : 'Running… usually under 30 seconds.');
    try {
      const r = await A.api('/api/admin/site-maintenance/run', { dryRun });
      renderRun(r);
      const s = r.summary;
      A.toast(s.bad ? `❌ Finished with ${s.bad} problem${s.bad === 1 ? '' : 's'}. See the list.` : s.warn ? `⚠️ Finished. ${s.warn} thing${s.warn === 1 ? '' : 's'} to look at.` : '✅ All clear.');
    } catch (err) {
      A.toast(err.message);
    } finally {
      busy(false);
      load();
    }
  }

  $('#smRun').onclick = () => run(false);
  $('#smDry').onclick = () => run(true);
  hist.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-run]'); if (!b) return;
    try { renderRun(await A.api('/api/admin/site-maintenance/runs/' + b.dataset.run)); card.scrollIntoView({ behavior: 'smooth' }); }
    catch (err) { A.toast(err.message); }
  });

  window.PFSiteMaint = { onPage(p) { if (p === 'maintenance' && Date.now() - loadedAt > 30000) load(); } };
  if (A.state && A.state.page === 'maintenance') load();
})();
