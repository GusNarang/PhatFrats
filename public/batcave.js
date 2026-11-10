// The Batcave: the control room's Live, Money, Fame and Log pages, global search, Batcave mode and a secret.
// Loaded by admin.html after its own script, which shares its helpers as window.PFAdmin.
(function () {
  const A = window.PFAdmin;
  if (!A) return;
  const { api, toast, esc, int, money, ago, drawBars, segButtons, state } = A;
  const $ = (s, el = document) => el.querySelector(s);
  const ZONE = 'America/New_York';
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = `
  .cave-search{position:relative}
  .cave-search input{font:14px var(--body);background:var(--night);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:8px 14px;width:min(260px,60vw)}
  .cave-results{position:absolute;right:0;top:calc(100% + 6px);z-index:20;width:min(420px,92vw);max-height:60vh;overflow:auto;background:var(--night-2);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 40px rgba(0,0,0,.5);padding:6px}
  .cave-hit{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 10px;border-radius:10px}
  .cave-hit:hover{background:var(--night-3)}
  .cave-hit b{display:block;font-size:14px}.cave-hit span{font-size:12px;color:var(--muted)}
  .cave-type{font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--gold)}
  .radar{position:relative;background:radial-gradient(circle at 50% 50%,#13204d,#070b1c 75%);border-radius:14px;overflow:hidden;border:1px solid var(--line)}
  .radar svg{display:block;width:100%;height:auto}
  .radar .sweep{position:absolute;inset:-40%;background:conic-gradient(from 0deg,rgba(157,255,74,.0),rgba(157,255,74,.16) 8%,transparent 12%);animation:sweep 5s linear infinite;pointer-events:none}
  @keyframes sweep{to{transform:rotate(360deg)}}
  .pin-hot{animation:pulse 1.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
  @keyframes pulse{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(2.2)}}
  @media (prefers-reduced-motion:reduce){.radar .sweep,.pin-hot{animation:none}}
  .ticker{max-height:360px;overflow:auto;display:flex;flex-direction:column;gap:6px}
  .tick{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--night);font-size:14px}
  .tick small{color:var(--muted);font:12px var(--mono)}
  .tick.new{animation:flash 1.4s ease-out}
  @keyframes flash{from{background:rgba(255,210,63,.35)}to{background:var(--night)}}
  .switches{display:grid;gap:10px}
  .switch-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:var(--night);border:2px solid var(--line)}
  .switch-row.on{border-color:var(--red);background:rgba(255,93,108,.1)}
  .switch-row b{display:block}.switch-row span{font-size:13px;color:var(--muted)}
  .bigbtn{font:400 14px var(--display);letter-spacing:.04em;border-radius:12px;padding:12px 16px;border:2px solid var(--line);background:var(--night-3);color:var(--ink);cursor:pointer;min-width:120px}
  .bigbtn.danger{border-color:var(--red);color:#ffc0c6}.bigbtn.go{border-color:var(--lime);color:#d8ffb5}
  .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px}
  .form-grid label,.cave-label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em}
  .cave-input,select.cave-input,textarea.cave-input{width:100%;font:15px var(--body);background:var(--night);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
  textarea.cave-input{min-height:70px;resize:vertical}
  .beacon-preview{border-radius:12px;padding:12px 16px;font-weight:700;margin-top:10px}
  .tone-gold{background:#ffd23f;color:#0b1026}.tone-pink{background:#ff3fa4;color:#fff}.tone-cyan{background:#35e0ff;color:#0b1026}.tone-red{background:#ff5d6c;color:#fff}
  .goal{height:16px;border-radius:999px;background:var(--night-3);overflow:hidden;margin:8px 0}
  .goal i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--lime));border-radius:999px;transition:width .6s}
  .fame{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
  .fame .card{position:relative;overflow:hidden}
  .fame .medal{font-size:30px;line-height:1}
  .fame h3{font:400 13px var(--display);color:var(--gold);margin:8px 0 4px;letter-spacing:.04em}
  .fame p{margin:0;font-weight:700}.fame small{color:var(--muted)}
  .log-row{display:grid;grid-template-columns:150px 1fr auto;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}
  .log-row time{color:var(--muted);font:12px var(--mono)}
  @media(max-width:640px){.log-row{grid-template-columns:1fr}}
  .burst{position:fixed;pointer-events:none;font-size:28px;z-index:60;animation:rise 1.6s ease-out forwards}
  @keyframes rise{to{transform:translate(var(--dx),-260px) rotate(var(--rot));opacity:0}}
  .milestone{position:fixed;inset:0;display:grid;place-items:center;z-index:70;background:rgba(5,8,20,.75);text-align:center}
  .milestone div{font:400 clamp(28px,6vw,52px) var(--display);color:var(--gold);text-shadow:4px 4px 0 var(--pink)}
  .batsignal{position:fixed;inset:0;z-index:80;pointer-events:none;background:radial-gradient(ellipse at 50% 120%,rgba(255,230,120,.18),rgba(0,0,0,.88) 60%);display:grid;place-items:center}
  .batsignal .beam{width:min(70vw,520px);aspect-ratio:1.6;border-radius:50%;background:radial-gradient(#fff6c4,#ffd23f 60%,rgba(255,210,63,.2));display:grid;place-items:center;box-shadow:0 0 120px 40px rgba(255,210,63,.45);animation:sig 4s ease-in-out}
  .batsignal svg{width:70%}
  .batsignal p{position:absolute;bottom:12%;font:400 clamp(20px,4vw,34px) var(--display);color:var(--gold);letter-spacing:.06em}
  @keyframes sig{0%{transform:scale(.2) translateY(60vh);opacity:0}20%{opacity:1;transform:scale(1)}85%{opacity:1}100%{opacity:0}}
  body.batcave{--night:#050507;--night-2:#0e0e12;--night-3:#18181f;--ink:#f3f1e8;--muted:#a19e8f;--line:rgba(255,212,0,.16);--gold:#ffd400;--pink:#ffd400;--cyan:#ffe766;background:#050507 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90' viewBox='0 0 64 36'%3E%3Cpath fill='%23ffd400' fill-opacity='.035' d='M32 6c2 3 3 5 3 5l3-5 2 6c4-3 10-4 16-2-5 2-8 6-9 12-3-3-6-4-9-3l-6 9-6-9c-3-1-6 0-9 3-1-6-4-10-9-12 6-2 12-1 16 2l2-6 3 5s1-2 3-5z'/%3E%3C/svg%3E")}
  body.batcave h1{text-shadow:3px 3px 0 #000;color:#ffd400}
  `;
  document.head.appendChild(css);

  // ---------- page markup ----------
  const app = $('#app');
  app.insertAdjacentHTML('beforeend', `
  <div id="pageLive" role="tabpanel" aria-labelledby="tab-live" hidden>
    <section class="tiles" id="liveTiles" aria-label="Right now"></section>
    <div class="grid">
      <section class="card"><div class="chart-head"><h2 style="margin:0">Live radar</h2><span class="updated">Houses people are looking at in the last 3 minutes</span></div>
        <div class="radar" id="radar"><div class="sweep"></div></div></section>
      <section class="card"><h2>Live ticker</h2><div class="ticker" id="ticker"></div></section>
    </div>
    <div class="grid even">
      <section class="card"><h2>📡 The beacon</h2>
        <p class="updated" style="margin-top:0">A banner across the top of the main site, the frat portal and Door Rush.</p>
        <form id="beaconForm">
          <label class="cave-label" for="bText">Message</label>
          <textarea class="cave-input" id="bText" maxlength="200" placeholder="🔥 Three new parties just dropped for Friday"></textarea>
          <div class="form-grid" style="margin-top:10px">
            <div><label for="bTone">Color</label><select class="cave-input" id="bTone"><option value="gold">Gold</option><option value="pink">Pink</option><option value="cyan">Cyan</option><option value="red">Red alert</option></select></div>
            <div><label for="bAud">Who sees it</label><select class="cave-input" id="bAud"><option value="all">Everyone</option><option value="free">Free accounts</option><option value="full">Full Access</option><option value="leaders">Chapter leaders</option></select></div>
            <div><label for="bHours">How long</label><select class="cave-input" id="bHours"><option value="0">Until I turn it off</option><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">1 week</option></select></div>
          </div>
          <div class="actions" style="justify-content:flex-start"><button class="bigbtn go" type="submit">Light it</button><button class="bigbtn" type="button" id="bOff">Turn off</button></div>
        </form>
        <div id="beaconNow"></div>
      </section>
      <section class="card"><h2>🚨 Lockdown</h2>
        <p class="updated" style="margin-top:0">Pause part of the site instantly if something goes wrong. People see a friendly "paused" message.</p>
        <div class="switches" id="switches"></div>
      </section>
    </div>
    <section class="card" style="margin-bottom:16px"><h2>🔦 Spotlight</h2>
      <p class="updated" style="margin-top:0">Pin one party to the top of the party list with a glowing badge.</p>
      <div class="form-grid"><div style="grid-column:span 2"><label for="spotPick">Party</label><select class="cave-input" id="spotPick"></select></div></div>
      <div class="actions" style="justify-content:flex-start"><button class="bigbtn go" type="button" id="spotOn">Spotlight it</button><button class="bigbtn" type="button" id="spotOff">Clear</button></div>
      <p id="spotNow" style="margin:10px 0 0"></p>
    </section>
  </div>

  <div id="pageMoney" role="tabpanel" aria-labelledby="tab-money" hidden>
    <section class="tiles" id="moneyTiles" aria-label="Money"></section>
    <div class="grid">
      <section class="card"><div class="chart-head"><h2 style="margin:0">💸 Revenue, last 30 days</h2></div><div class="chart-total" id="revTotal"></div><div class="chart" id="revChart"></div></section>
      <section class="card"><h2>🎯 Semester goal</h2><div id="goalBox"></div>
        <form id="goalForm" class="actions" style="justify-content:flex-start;margin-top:10px"><input class="cave-input" id="goalIn" type="number" min="0" step="1" style="max-width:140px" aria-label="Goal in dollars" placeholder="Goal in $"><button class="btn small" type="submit">Set goal</button></form></section>
    </div>
    <div class="grid even">
      <section class="card"><h2>🏷️ Promo codes</h2>
        <form id="promoForm"><div class="form-grid">
          <div><label for="pCode">Code</label><input class="cave-input" id="pCode" maxlength="24" placeholder="PSUWEEKEND"></div>
          <div><label for="pPct">% off</label><input class="cave-input" id="pPct" type="number" min="1" max="100" value="50"></div>
          <div><label for="pMax">Max uses</label><input class="cave-input" id="pMax" type="number" min="1" placeholder="No limit"></div>
          <div><label for="pEnds">Last day</label><input class="cave-input" id="pEnds" type="date"></div>
        </div><button class="btn small gold" type="submit">Create code</button></form>
        <div id="promoList" style="margin-top:12px"></div>
      </section>
      <section class="card"><h2>🎁 Gift Full Access</h2>
        <form id="giftForm"><div class="form-grid">
          <div><label for="gWho">Who</label><select class="cave-input" id="gWho"><option value="leaders">Every chapter leader</option><option value="brothers">Every brother</option><option value="emails">These emails</option></select></div>
          <div><label for="gUntil">Through</label><input class="cave-input" id="gUntil" type="date"></div>
        </div>
        <textarea class="cave-input" id="gEmails" hidden placeholder="abc1234@psu.edu, xyz5678@psu.edu"></textarea>
        <p class="updated">Leave "Through" empty for Full Access that never ends. Nobody's pass gets shorter.</p>
        <button class="btn small gold" type="submit">Send gifts</button></form>
      </section>
    </div>
    <section class="card" style="margin-bottom:16px"><h2>Recent sales</h2><div id="salesList"></div></section>
  </div>

  <div id="pageFame" role="tabpanel" aria-labelledby="tab-fame" hidden>
    <section class="fame" id="fameCards" aria-label="Hall of Fame"></section>
    <section class="card" style="margin-bottom:16px"><h2>🔮 Night Forecast</h2><p class="updated" style="margin-top:0">Which upcoming chapter parties will fill first, based on the last 24 hours of requests.</p>
      <div class="table-scroll"><table><thead><tr><th>Party</th><th>When</th><th>Chapter</th><th>Fill</th><th class="num">Requests in 24h</th><th>Forecast</th></tr></thead><tbody id="forecast"></tbody></table></div></section>
    <div class="grid even">
      <section class="card"><h2>📈 Growth</h2><div id="growth"></div></section>
      <section class="card"><h2>🕹️ Door Rush god mode</h2><div id="godMode"></div></section>
    </div>
  </div>

  <div id="pageLog" role="tabpanel" aria-labelledby="tab-log" hidden>
    <section class="card"><h2>Activity log</h2><p class="updated" style="margin-top:0">Every change made from the control room, newest first.</p><div id="logList"></div></section>
  </div>`);

  // ---------- sounds and celebrations ----------
  let audio = null;
  function tone(freq, len = .12, type = 'triangle', vol = .05) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + len);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + len);
    } catch (e) {}
  }
  const chaChing = () => [988, 1319, 1568].forEach((f, i) => setTimeout(() => tone(f, .16, 'square', .035), i * 90));
  function burst(emoji, n = 14) {
    if (calm) n = 3;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'burst'; s.textContent = emoji;
      s.style.left = (40 + Math.random() * 20) + 'vw'; s.style.top = (70 + Math.random() * 10) + 'vh';
      s.style.setProperty('--dx', (Math.random() * 300 - 150) + 'px'); s.style.setProperty('--rot', (Math.random() * 90 - 45) + 'deg');
      document.body.appendChild(s); setTimeout(() => s.remove(), 1700);
    }
  }
  function celebrate(text) {
    const m = document.createElement('div');
    m.className = 'milestone'; m.innerHTML = `<div>${esc(text)}</div>`;
    m.onclick = () => m.remove();
    document.body.appendChild(m); burst('🎉', 24); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f), i * 110));
    setTimeout(() => m.remove(), 3500);
  }
  const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  function checkMilestone(accounts) {
    let seen = 0;
    try { seen = Number(localStorage.getItem('pf_cave_milestone')) || 0; } catch (e) {}
    const hit = MILESTONES.filter((m) => accounts >= m).pop();
    if (hit && hit > seen) {
      try { localStorage.setItem('pf_cave_milestone', hit); } catch (e) {}
      if (seen) celebrate(`🎉 ${int(hit)} accounts!`);
    }
  }

  // ---------- Live ----------
  const KIND = { signup: '🆕', verify: '✅', request: '🎟️', guest: '👋', party: '🎉', brother: '🤝', invite: '💌', sale: '💸' };
  let mapData = null, lastFeedId = null, live = null;
  function loadMap() {
    if (mapData) return Promise.resolve(mapData);
    return new Promise((res) => {
      const s = document.createElement('script'); s.src = '/map-data.js';
      s.onload = () => { mapData = window.PF_MAP; res(mapData); }; s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }
  async function drawRadar(houses) {
    const m = await loadMap();
    const el = $('#radar');
    if (!m) { el.insertAdjacentHTML('beforeend', '<p class="empty" style="padding:20px">The map couldn\'t load.</p>'); return; }
    let svg = `<svg viewBox="100 120 820 420" role="img" aria-label="Radar of houses people are viewing">`;
    svg += `<path d="${m.paths.major}" fill="none" stroke="rgba(157,255,74,.28)" stroke-width="2.4"/>`;
    if (m.paths.foot) svg += `<path d="${m.paths.foot}" fill="none" stroke="rgba(157,255,74,.1)" stroke-width="1"/>`;
    for (const p of m.pins) {
      const n = houses[p.id] || 0;
      if (n) {
        const r = 6 + Math.min(18, n * 3);
        svg += `<circle class="pin-hot" cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="#ffd23f" stroke-width="2"/>`;
        svg += `<circle cx="${p.x}" cy="${p.y}" r="${4 + Math.min(8, n)}" fill="#ffd23f"/>`;
        svg += `<text x="${p.x + 10}" y="${p.y - 8}" fill="#ffd23f" font-family="DM Mono" font-size="12">${n} · ${esc((A.state.chapters.find((c) => c.id === p.id) || {}).gl || '')}</text>`;
      } else svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="rgba(157,255,74,.6)"/>`;
    }
    svg += '</svg>';
    el.querySelectorAll('svg,p').forEach((x) => x.remove());
    el.insertAdjacentHTML('beforeend', svg);
  }
  function renderTicker(feed) {
    const fresh = lastFeedId == null ? new Set() : new Set(feed.filter((f) => f.id > lastFeedId).map((f) => f.id));
    $('#ticker').innerHTML = feed.length ? feed.map((f) =>
      `<div class="tick${fresh.has(f.id) ? ' new' : ''}"><span>${KIND[f.kind] || '•'}</span><span>${esc(f.text)}</span><small>${esc(ago(f.created_at))}</small></div>`).join('')
      : '<p class="empty">Nothing yet. Activity shows up here the moment it happens.</p>';
    if (lastFeedId != null && feed.some((f) => fresh.has(f.id) && f.kind === 'sale')) { chaChing(); burst('💸'); toast('💸 New sale!'); }
    if (feed.length) lastFeedId = Math.max(lastFeedId || 0, ...feed.map((f) => f.id));
  }
  function renderSwitches(lock) {
    const rows = [
      ['signups', 'New sign-ups', 'Stops new accounts from being created.'],
      ['requests', 'Invite requests', 'Stops new invite requests and outside guests.'],
      ['checkout', 'Checkout', 'Hides the Full Access button and stops payments.'],
    ];
    $('#switches').innerHTML = rows.map(([k, label, help]) =>
      `<div class="switch-row${lock[k] ? ' on' : ''}"><div><b>${label}: ${lock[k] ? 'PAUSED' : 'open'}</b><span>${help}</span></div>
       <button class="bigbtn ${lock[k] ? 'go' : 'danger'}" type="button" data-lock="${k}" data-to="${!lock[k]}">${lock[k] ? 'Reopen' : 'Pause'}</button></div>`).join('');
  }
  async function loadLive(quiet) {
    try { live = await api('/api/admin/live'); } catch (e) { if (!quiet) toast(e.message); return; }
    const o = live.online;
    if (!$('#pageLive').hidden || !quiet) {
      $('#liveTiles').innerHTML = [
        ['Online now', o.n, 'browsers open in the last 2 min'],
        ['Looking at houses', Object.values(live.houses).reduce((s, n) => s + n, 0), 'on the party map'],
        ['Playing Door Rush', o.gaming, 'right now'],
        ['In the frat portal', o.frats, 'right now'],
      ].map((t) => `<div class="card tile"><div class="label">${esc(t[0])}</div><div class="value">${int(t[1])}</div><div class="sub">${esc(t[2])}</div></div>`).join('');
      drawRadar(live.houses);
      renderSwitches(live.lockdown);
      const b = live.beacon;
      $('#beaconNow').innerHTML = b ? `<div class="beacon-preview tone-${esc(b.tone)}">${esc(b.text)}</div><p class="updated">Showing to ${esc({ all: 'everyone', free: 'Free accounts', full: 'Full Access', leaders: 'chapter leaders' }[b.audience])}${b.ends_at ? ' until ' + new Date(b.ends_at).toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ', until you turn it off'}.</p>` : '<p class="updated">The beacon is off.</p>';
      const sel = $('#spotPick'), keep = sel.value;
      sel.innerHTML = live.parties.map((p) => `<option value="${esc(p.id)}">${esc(p.title + ' · ' + fmtDay(p.day) + (p.hosted ? '' : ' (demo)'))}</option>`).join('');
      sel.value = live.spotlight?.id || keep || sel.value;
      $('#spotNow').innerHTML = live.spotlight ? `⭐ Spotlighting <b>${esc(live.spotlight.title)}</b>` : '<span class="updated">No party is in the spotlight.</span>';
    }
    renderTicker(live.feed);
  }
  $('#beaconForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#bText').value.trim();
    if (!text) return toast('Write a message first.');
    try {
      await api('/api/admin/announcement', { text, tone: $('#bTone').value, audience: $('#bAud').value, hours: Number($('#bHours').value) });
      toast('📡 Beacon lit.'); burst('📡', 8); loadLive();
    } catch (err) { toast(err.message); }
  });
  $('#bOff').addEventListener('click', async () => { try { await api('/api/admin/announcement', { text: '' }); toast('Beacon off.'); loadLive(); } catch (err) { toast(err.message); } });
  $('#switches').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lock]'); if (!b) return;
    const pausing = b.dataset.to === 'true';
    if (pausing && !confirm(`Pause ${b.dataset.lock} for everyone? You can reopen it any time.`)) return;
    try { await api('/api/admin/lockdown', { [b.dataset.lock]: pausing }); toast(pausing ? '🚨 Paused.' : 'Reopened.'); loadLive(); } catch (err) { toast(err.message); }
  });
  $('#spotOn').addEventListener('click', async () => { try { await api('/api/admin/spotlight', { partyId: $('#spotPick').value }); toast('🔦 Spotlight on.'); loadLive(); } catch (err) { toast(err.message); } });
  $('#spotOff').addEventListener('click', async () => { try { await api('/api/admin/spotlight', { partyId: null }); toast('Spotlight cleared.'); loadLive(); } catch (err) { toast(err.message); } });

  // ---------- Money ----------
  async function loadMoney() {
    let m;
    try { m = await api('/api/admin/money'); } catch (e) { return toast(e.message); }
    const t = m.totals;
    $('#moneyTiles').innerHTML = [
      ['This semester', money(t.term_cents / 100), `${int(t.term_sales)} sales since ${fmtDay(m.termStart)}`],
      ['All time', money(t.all_cents / 100), 'real payments only'],
      ['Semester ends', fmtDay(m.termEnd), 'passes bought now run until then'],
      ['Test payments', int(t.test_sales), 'never counted as money'],
    ].map((x) => `<div class="card tile"><div class="label">${esc(x[0])}</div><div class="value">${esc(x[1])}</div><div class="sub">${esc(x[2])}</div></div>`).join('');
    drawBars($('#revChart'), $('#revTotal'), m.days.map((d) => ({ day: d.day, dollars: Math.round(d.cents) / 100 })), { key: 'dollars', label: 'Revenue', color: 'var(--gold)', unit: 'dollars of revenue' });
    const goal = m.goalCents / 100, now = t.term_cents / 100, pct = goal ? Math.min(100, now / goal * 100) : 0;
    $('#goalBox').innerHTML = goal
      ? `<div style="font:800 26px var(--body)">${money(now)} <span class="updated">of ${money(goal)}</span></div><div class="goal"><i style="width:${pct}%"></i></div><p class="updated">${pct >= 100 ? '🏆 Goal smashed!' : money(goal - now) + ' to go this semester'}</p>`
      : '<p class="updated">Set a goal for this semester and watch the bar fill.</p>';
    $('#promoList').innerHTML = m.promos.length ? '<div class="table-scroll"><table style="min-width:420px"><thead><tr><th>Code</th><th class="num">Off</th><th class="num">Used</th><th>Ends</th><th></th></tr></thead><tbody>' + m.promos.map((p) => {
      const dead = !p.active || (p.ends_at && new Date(p.ends_at) < new Date()) || (p.max_uses != null && p.uses >= p.max_uses);
      return `<tr><td><b>${esc(p.code)}</b></td><td class="num">${p.percent_off}%</td><td class="num">${int(p.uses)}${p.max_uses != null ? ' / ' + int(p.max_uses) : ''}</td><td>${p.ends_at ? esc(new Date(new Date(p.ends_at).getTime() - 1000).toLocaleDateString('en-US', { timeZone: ZONE })) : 'Never'}</td>
        <td>${dead ? '<span class="tag">Off</span>' : `<button class="btn small danger" data-promo-off="${esc(p.code)}">Turn off</button>`}</td></tr>`;
    }).join('') + '</tbody></table></div>' : '<p class="updated">No promo codes yet.</p>';
    $('#salesList').innerHTML = m.recent.length ? m.recent.map((r) => `<div class="row"><span>${esc(r.who)} · ${esc(new Date(r.when).toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${r.promo ? ' · ' + esc(r.promo) : ''}${r.live ? '' : ' · test'}</span><span>${money(r.cents / 100)}</span></div>`).join('') : '<p class="empty">No sales yet.</p>';
  }
  $('#goalForm').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/admin/goal', { dollars: Number($('#goalIn').value) }); toast('🎯 Goal set.'); loadMoney(); } catch (err) { toast(err.message); } });
  $('#promoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/promo', { code: $('#pCode').value, percentOff: Number($('#pPct').value), maxUses: $('#pMax').value ? Number($('#pMax').value) : '', endsOn: $('#pEnds').value || null });
      toast('🏷️ Code created.'); $('#pCode').value = ''; loadMoney();
    } catch (err) { toast(err.message); }
  });
  $('#promoList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-promo-off]'); if (!b) return;
    try { await api('/api/admin/promo/' + encodeURIComponent(b.dataset.promoOff) + '/off', {}); toast('Code turned off.'); loadMoney(); } catch (err) { toast(err.message); }
  });
  $('#gWho').addEventListener('change', () => { $('#gEmails').hidden = $('#gWho').value !== 'emails'; });
  $('#giftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const who = $('#gWho').selectedOptions[0].textContent.toLowerCase(), until = $('#gUntil').value;
    if (!confirm(`Give Full Access to ${who}${until ? ' through ' + until : ' with no end date'}?`)) return;
    try {
      const r = await api('/api/admin/gift', { audience: $('#gWho').value, emails: $('#gEmails').value, until: until || null });
      toast(`🎁 Gifted to ${int(r.gifted)} account${r.gifted === 1 ? '' : 's'}.`); if (r.gifted) burst('🎁', 10); A.load();
    } catch (err) { toast(err.message); }
  });

  // ---------- Fame ----------
  const span = (s) => s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : s < 172800 ? Math.round(s / 3600) + ' hours' : Math.round(s / 86400) + ' days';
  async function loadFame() {
    let f;
    try { f = await api('/api/admin/fame'); } catch (e) { return toast(e.message); }
    const fm = f.fame;
    const cards = [
      ['🏆', 'Party of the week', fm.topParty && fm.topParty.title, fm.topParty && `${int(fm.topParty.requests)} requests this week`],
      ['🔥', 'Hottest chapter', fm.hotChapter && fm.hotChapter.name, fm.hotChapter && `${int(fm.hotChapter.requests)} requests this week`],
      ['💌', 'Top inviter', fm.topBrother && fm.topBrother.name, fm.topBrother && `${int(fm.topBrother.invites)} invites · ${fm.topBrother.chapter}`],
      ['⚡', 'Fastest fill ever', fm.fastest && fm.fastest.title, fm.fastest && `${fm.fastest.chapter} · full in ${span(fm.fastest.seconds)}`],
      ['🕹️', 'Door Rush champ', fm.gamers[0] && fm.gamers[0].name, fm.gamers[0] && `${int(fm.gamers[0].score)} points this week`],
    ];
    $('#fameCards').innerHTML = cards.map(([m, h, v, s]) => `<div class="card"><div class="medal">${m}</div><h3>${h}</h3><p>${v ? esc(v) : '<span class="updated">Nobody yet</span>'}</p>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('');
    $('#forecast').innerHTML = f.forecast.length ? f.forecast.map((p) => {
      const pct = Math.round(p.going / p.cap * 100);
      const label = p.hoursToFull === 0 ? '🎉 Full' : p.hoursToFull == null ? 'No pace yet' : p.hoursToFull < 24 ? `🔥 Fills in ~${Math.max(1, Math.round(p.hoursToFull))} h` : `Fills in ~${Math.round(p.hoursToFull / 24)} days`;
      return `<tr><td><b>${esc(p.title)}</b></td><td>${esc(fmtDay(p.day))}</td><td>${esc(p.chapter)}</td><td><span class="fill"><i style="width:${pct}%"></i></span>${pct}%</td><td class="num">${int(p.lastDay)}</td><td>${label}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No chapter parties coming up.</td></tr>';
    const g = f.growth, next = MILESTONES.find((m) => m > g.accounts) || g.accounts;
    $('#growth').innerHTML = `<div class="rows">
      <div class="row"><span>Accounts</span><span>${int(g.accounts)}</span></div>
      <div class="row"><span>Bought Full Access</span><span>${int(g.buyers)} of ${int(g.verified)} confirmed (${g.verified ? Math.round(g.buyers / g.verified * 100) : 0}%)</span></div>
      <div class="row"><span>Next milestone</span><span>${int(next)} accounts</span></div></div>
      <div class="goal"><i style="width:${Math.min(100, g.accounts / next * 100)}%"></i></div>
      <h3 style="font:400 13px var(--display);margin:14px 0 8px">Where visitors come from (30 days)</h3>
      <div class="bars">${g.referrers.length ? g.referrers.map((r) => `<div class="bar-row"><span>${esc(r.referrer)}</span><span>${int(r.n)}</span><div class="track"><i style="width:${r.n / g.referrers[0].n * 100}%;background:var(--cyan)"></i></div></div>`).join('') : '<p class="empty">No outside links yet. Visitors are coming in directly.</p>'}</div>`;
    checkMilestone(g.accounts);
    const ev = f.game.eventUntil;
    $('#godMode').innerHTML = `<p style="margin-top:0">${ev ? `⚡ <b>Double-points event</b> until ${esc(new Date(ev).toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric' }))}` : 'No event running.'}</p>
      <div class="actions" style="justify-content:flex-start;margin-bottom:12px">
        ${ev ? '<button class="btn small" data-game="endEvent">End event</button>' : '<select class="cave-input" id="evDays" style="max-width:130px" aria-label="Event length"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>1 week</option></select><button class="btn small gold" data-game="event">Start double points</button>'}
        <button class="btn small danger" data-game="reset">Reset this week's board</button></div>
      <div class="bars">${fm.gamers.length ? fm.gamers.map((x) => `<div class="row"><span>${x.place}. ${esc(x.name)}</span><span>${int(x.score)} <button class="btn small danger" data-remove="${x.userId}" data-name="${esc(x.name)}">Remove</button></span></div>`).join('') : '<p class="empty">Nobody has played this week.</p>'}</div>`;
  }
  $('#godMode').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-game],[data-remove]'); if (!b) return;
    try {
      if (b.dataset.remove) { if (!confirm(`Remove ${b.dataset.name}'s scores from this week's board?`)) return; await api('/api/admin/game/remove/' + b.dataset.remove, {}); toast('Scores removed.'); }
      else if (b.dataset.game === 'reset') { if (!confirm("Wipe this week's Door Rush board and start fresh?")) return; await api('/api/admin/game/reset', {}); toast('🧹 Board reset.'); }
      else if (b.dataset.game === 'event') { await api('/api/admin/game/event', { days: Number($('#evDays').value) }); toast('⚡ Double points on!'); burst('⚡', 10); }
      else if (b.dataset.game === 'endEvent') { await api('/api/admin/game/event', { days: 0 }); toast('Event ended.'); }
      loadFame();
    } catch (err) { toast(err.message); }
  });

  // ---------- Log ----------
  async function loadLog() {
    let l;
    try { l = await api('/api/admin/log'); } catch (e) { return toast(e.message); }
    $('#logList').innerHTML = l.log.length ? l.log.map((r) => `<div class="log-row"><time>${esc(new Date(r.when).toLocaleString('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</time><span>${esc(r.action)}</span><span class="updated">${esc(r.by)}</span></div>`).join('') : '<p class="empty">Nothing yet. Changes you make show up here.</p>';
  }

  // ---------- Search everything ----------
  let searchTimer;
  $('#caveSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#caveResults').hidden = true; return; }
    searchTimer = setTimeout(async () => {
      let r; try { r = await api('/api/admin/search?q=' + encodeURIComponent(q)); } catch (err) { return; }
      const box = $('#caveResults');
      box.hidden = false;
      box.innerHTML = r.results.length ? r.results.map((x) => {
        let act = '';
        if (x.type === 'account') act = `<button class="btn small" data-find="${esc(x.email)}">Show</button>`;
        if (x.type === 'chapter') act = `<a class="btn small gold" href="/frats?chapter=${x.id}" target="_blank" rel="noopener">Open</a>`;
        if (x.type === 'party') act = `<button class="btn small" data-spot="${esc(x.id)}">Spotlight</button>`;
        return `<div class="cave-hit"><div><span class="cave-type">${x.type}</span><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></div>${act}</div>`;
      }).join('') : '<p class="empty" style="padding:8px">Nothing matches.</p>';
    }, 250);
  });
  $('#caveResults').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-find]'), s = e.target.closest('[data-spot]');
    if (f) { $('#caveResults').hidden = true; A.findUser(f.dataset.find); }
    if (s) { try { await api('/api/admin/spotlight', { partyId: s.dataset.spot }); toast('🔦 Spotlight on.'); $('#caveResults').hidden = true; } catch (err) { toast(err.message); } }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.cave-search')) $('#caveResults').hidden = true; });

  // ---------- Batcave mode and the secret ----------
  function setCave(on) {
    document.body.classList.toggle('batcave', on);
    $('#caveMode').setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('pf_batcave', on ? '1' : '0'); } catch (e) {}
  }
  try { setCave(localStorage.getItem('pf_batcave') === '1'); } catch (e) {}
  $('#caveMode').addEventListener('click', () => { const on = !document.body.classList.contains('batcave'); setCave(on); if (on) { tone(110, .5, 'sawtooth', .04); toast('🦇 Welcome to the Batcave.'); } });
  // Type "batman" anywhere outside a text box.
  let typed = '';
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    typed = (typed + (e.key.length === 1 ? e.key.toLowerCase() : '')).slice(-6);
    if (typed !== 'batman') return;
    typed = '';
    const s = document.createElement('div');
    s.className = 'batsignal';
    s.innerHTML = `<div class="beam"><svg viewBox="0 0 64 36" aria-hidden="true"><path fill="#0b0b0b" d="M32 6c2 3 3 5 3 5l3-5 2 6c4-3 10-4 16-2-5 2-8 6-9 12-3-3-6-4-9-3l-6 9-6-9c-3-1-6 0-9 3-1-6-4-10-9-12 6-2 12-1 16 2l2-6 3 5s1-2 3-5z"/></svg></div><p>PHATFRATS NEEDS YOU</p>`;
    document.body.appendChild(s);
    [196, 247, 294, 392].forEach((f, i) => setTimeout(() => tone(f, .35, 'sawtooth', .04), i * 200));
    setTimeout(() => s.remove(), 4000);
  });

  // ---------- page switching and live polling ----------
  const loaders = { live: loadLive, money: loadMoney, fame: loadFame, log: loadLog };
  window.PFCave = { onPage: (page) => { if (loaders[page]) loaders[page](); } };
  // The ticker keeps listening on every page, so a sale cha-chings wherever you are.
  setInterval(() => { if (!document.hidden && !$('#app').hidden) loadLive(true); }, 15000);
  const watchAccounts = setInterval(() => { if (A.state.overview) { checkMilestone(A.state.overview.accounts.total); clearInterval(watchAccounts); } }, 1000);
  A.showPage(A.state.startPage || 'overview');
})();
