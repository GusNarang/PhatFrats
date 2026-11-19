// The control room's Maintenance card (top of Live): lock the whole site now, or schedule a window.
// Everyone but admins sees a "back soon" screen while it's locked. See maintenance.js on the server.
(function () {
  const A = window.PFAdmin;
  if (!A) return;
  const esc = A.esc;
  const css = document.createElement('style');
  css.textContent = `
  #maintCard{margin-bottom:16px;border-left:5px solid var(--mc,var(--line))}
  #maintCard .m-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:12px}
  #maintCard .m-box{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--night)}
  #maintCard .m-box h3{margin:0 0 8px;font-size:15px}
  #maintCard .m-row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:10px}
  #maintCard .m-row>div{flex:1 1 150px}
  #maintStatus{font:500 15px var(--body)}
  #maintStrip{position:sticky;top:0;z-index:70;background:var(--red);color:#fff;text-align:center;font:700 14px var(--body);padding:8px 12px;cursor:pointer}`;
  document.head.appendChild(css);

  const page = document.getElementById('pageLive');
  if (!page) return;
  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'maintCard';
  card.innerHTML = `
    <div class="chart-head"><h2 style="margin:0">🔧 Maintenance</h2><span class="updated">You can always see the site while it's locked. Payments and the Monday prize keep running.</span></div>
    <p id="maintStatus">Checking…</p>
    <div id="maintOff"></div>
    <label class="cave-label" for="mMsg" style="margin-top:12px">Message people see</label>
    <textarea class="cave-input" id="mMsg" maxlength="240"></textarea>
    <div class="m-cols">
      <div class="m-box"><h3>🔒 Lock it now</h3>
        <div class="m-row"><div><label class="cave-label" for="mFor">Unlock by itself after</label>
          <select class="cave-input" id="mFor"><option value="">Never: I'll unlock it</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120" selected>2 hours</option><option value="240">4 hours</option><option value="720">12 hours</option></select></div>
          <button class="bigbtn danger" type="button" id="mNow">Lock site now</button></div>
      </div>
      <div class="m-box"><h3>📅 Schedule it</h3>
        <div class="m-row"><div><label class="cave-label" for="mStart">Starts (your time)</label><input class="cave-input" type="datetime-local" id="mStart"></div>
          <div><label class="cave-label" for="mLen">Lasts</label>
          <select class="cave-input" id="mLen"><option value="60">1 hour</option><option value="120" selected>2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option><option value="360">6 hours</option></select></div></div>
        <div class="m-row"><button class="btn small" type="button" id="mFirstSun">Next first Sunday, 3 AM</button>
          <button class="bigbtn go" type="button" id="mSched">Schedule</button></div>
        <p class="updated" style="margin:8px 0 0">People get a heads-up banner for the 24 hours before. It unlocks by itself at the end.</p>
      </div>
    </div>`;
  page.insertBefore(card, page.firstChild);
  const $ = (s) => card.querySelector(s);

  let st = null;
  const fmt = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function strip() {
    let el = document.getElementById('maintStrip');
    if (!st || !st.active) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'maintStrip';
      el.onclick = () => { A.showPage && A.showPage('live'); card.scrollIntoView({ behavior: 'smooth' }); };
      document.body.prepend(el);
    }
    el.textContent = '🔧 The site is LOCKED for maintenance' + (st.end ? ' until ' + fmt(st.end) : '') + '. Tap to manage.';
  }

  function render() {
    if (!$('#mMsg').value) $('#mMsg').placeholder = st.defaultMessage;
    let status, color, off = '';
    if (st.active) {
      color = 'var(--red)';
      status = '<b style="color:var(--red)">LOCKED.</b> Since ' + esc(fmt(st.start)) + (st.end ? ', unlocks by itself ' + esc(fmt(st.end)) : ', until you unlock it') + '.<br><span class="updated">They see: "' + esc(st.message) + '"</span>';
      off = '<button class="bigbtn go" type="button" data-off>Unlock the site</button>';
    } else if (st.upcoming) {
      color = 'var(--cyan)';
      status = '<b style="color:var(--cyan)">Scheduled:</b> ' + esc(fmt(st.start)) + ' to ' + esc(fmt(st.end)) + '.' + (st.warn ? ' The heads-up banner is showing now.' : ' The heads-up banner starts 24 hours before.');
      off = '<button class="bigbtn" type="button" data-off>Cancel it</button>';
    } else {
      color = 'var(--lime)';
      status = '<b style="color:var(--lime)">Open.</b> The site is running normally.';
    }
    card.style.setProperty('--mc', color);
    $('#maintStatus').innerHTML = status;
    $('#maintOff').innerHTML = off;
    strip();
  }

  async function load() {
    try { st = await A.api('/api/admin/maintenance'); render(); }
    catch (err) { $('#maintStatus').textContent = err.message; }
  }
  async function send(body, done) {
    const msg = $('#mMsg').value.trim();
    try { st = { ...st, ...(await A.api('/api/admin/maintenance', { ...body, message: msg || undefined })) }; A.toast(done); load(); }
    catch (err) { A.toast(err.message); }
  }

  $('#mFirstSun').onclick = () => {
    const now = new Date();
    const firstSun = (y, m) => { const d = new Date(y, m, 1, 3, 0); while (d.getDay() !== 0) d.setDate(d.getDate() + 1); return d; };
    let d = firstSun(now.getFullYear(), now.getMonth());
    if (d <= now) d = firstSun(now.getFullYear(), now.getMonth() + 1);
    $('#mStart').value = localInput(d);
  };
  $('#mNow').onclick = () => {
    const mins = $('#mFor').value;
    if (!confirm('Lock the whole site now? Everyone but admins will see the "back soon" screen' + (mins ? ' for ' + $('#mFor').selectedOptions[0].text + '.' : ' until you unlock it.'))) return;
    send({ action: 'now', minutes: mins ? Number(mins) : undefined }, '🔒 Site locked. It can take up to 15 seconds to reach everyone.');
  };
  $('#mSched').onclick = () => {
    if (!$('#mStart').value) { A.toast('Pick a start time first.'); return; }
    const start = new Date($('#mStart').value);
    const end = new Date(start.getTime() + Number($('#mLen').value) * 60000);
    if (st && (st.active || st.upcoming) && !confirm('This replaces the current maintenance setting. Go ahead?')) return;
    send({ action: 'schedule', start: start.toISOString(), end: end.toISOString() }, '📅 Maintenance scheduled for ' + fmt(start.toISOString()) + '.');
  };
  card.addEventListener('click', (e) => {
    if (!e.target.closest('[data-off]')) return;
    send({ action: 'off' }, st.active ? '🔓 Site unlocked.' : 'Scheduled maintenance cancelled.');
  });

  load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
})();
