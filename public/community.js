// The main site's community features: save hearts, the notification bell, profile with badges and referrals,
// share cards, group plans, phone install, the Weekend Drop countdown and the Party Smart kit.
// index.html shares its state and helpers as window.PFSite, then calls PFCommunity.start().
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const params = new URLSearchParams(location.search);
  // Remember a friend's referral code until sign-up.
  if (/^[A-Z0-9]{5,8}$/i.test(params.get('ref') || '')) store.set('pf_ref', params.get('ref').toUpperCase());
  let group = null, notes = { alerts: [], notes: [], unread: 0 }, installEvent = null;
  const S = () => window.PFSite;
  const esc = (s) => S().esc(s);
  const $ = (s) => document.querySelector(s);

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = `
  .bell-btn{position:relative;background:var(--night-2);border:1.5px solid var(--line);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;line-height:1}
  .bell-btn b{position:absolute;top:-4px;right:-4px;background:var(--pink);color:#fff;font:700 11px/18px var(--body);min-width:18px;height:18px;border-radius:9px;padding:0 4px}
  .avatar-btn{border:0;cursor:pointer}
  .foot-right{display:flex;gap:6px;align-items:center}
  .save-btn{background:transparent;border:1.5px solid var(--line);color:var(--ink);border-radius:999px;min-width:36px;height:32px;cursor:pointer;font-size:15px}
  .save-btn[aria-pressed="true"]{border-color:var(--pink);color:var(--pink);background:rgba(255,63,164,.12)}
  .pf-extras{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
  .pf-extras .btn{font-size:.85rem}
  .pf-group{background:var(--night);border:1px dashed var(--line);border-radius:12px;padding:8px 12px;font-size:.88rem;margin:6px 0}
  .pf-panel{position:fixed;right:12px;top:64px;z-index:60;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:var(--night-2);border:1px solid var(--line);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.55);padding:12px}
  .pf-note{padding:10px 12px;border-radius:12px;background:var(--night);margin-bottom:6px;font-size:.92rem}
  .pf-note.unread{border-left:4px solid var(--pink)}
  .pf-note small{display:block;color:var(--muted);font-size:.75rem;margin-top:2px}
  .pf-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0 14px}
  .pf-badge{background:var(--night);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}
  .pf-badge i{display:block;font-style:normal;font-size:28px}
  .pf-badge b{display:block;font-size:.88rem}.pf-badge span{font-size:.75rem;color:var(--muted)}
  .pf-progress{height:10px;border-radius:999px;background:var(--night-3);overflow:hidden;margin:6px 0}
  .pf-progress i{display:block;height:100%;background:linear-gradient(90deg,var(--pink),var(--gold))}
  .drop-box{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(255,63,164,.12);border:1px solid rgba(255,63,164,.45);border-radius:999px;padding:8px 14px;margin:0 0 14px;font-weight:700}
  .drop-box .count{font-family:var(--mono);color:var(--gold)}
  .kit{margin-top:16px;background:var(--night-2);border:1px solid var(--line);border-radius:var(--r,18px);padding:18px}
  .kit h3{margin:0 0 4px}
  /* Six tools: rows of 6, 3 or 2, so none is ever left alone on a row. */
  .kit-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:12px}
  @media (max-width:1180px){.kit-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media (max-width:600px){.kit-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .kit-grid a,.kit-grid button{display:flex;align-items:center;gap:10px;justify-content:flex-start;text-align:left;font:600 .95rem var(--body);padding:12px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--night);color:var(--ink);text-decoration:none;cursor:pointer;min-height:52px}
  .kit-grid .sos{border-color:#ff5d6c;color:#ffd0d5}
  `;
  document.head.appendChild(css);

  // ---------- helpers for index.html ----------
  function saveButton(id) {
    const st = S() && S().state;
    if (!st || !st.user) return '';
    const on = (st.saved || []).includes(id);
    return `<button class="save-btn" type="button" data-save="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Saved' : 'Save this party'}" title="${on ? 'Saved' : 'Save for alerts'}">${on ? '♥' : '♡'}</button>`;
  }
  function detailExtras(p) {
    const st = S().state;
    if (!st.user) return '';
    let html = `<div class="pf-extras">${saveButton(p.id).replace('class="save-btn"', 'class="save-btn" style="min-width:auto;padding:0 12px"').replace(/>(♥|♡)</, (m, h) => `>${h} ${h === '♥' ? 'Saved' : 'Save'}<`)}
      <button class="btn ghost small" type="button" data-share="${esc(p.id)}">📸 Share</button>
      <button class="btn ghost small" type="button" data-group="${esc(p.id)}">👯 Going with friends?</button></div>`;
    if (group && group.partyId === p.id) {
      html += `<div class="pf-group">👯 <b>${esc(group.owner)}'s group:</b> ${group.members.map((m) => esc(m.name) + (m.requested ? ' ✓' : '')).join(', ')}<br><span style="color:var(--muted)">Each person still requests their own invite. ✓ means they already did.</span></div>`;
    }
    return html;
  }

  // ---------- bell ----------
  async function loadNotes() {
    if (!S().state.user) return;
    try { notes = await S().api('/api/notifications'); } catch (e) { return; }
    paintBell();
  }
  function paintBell() {
    const b = $('#bellCount');
    if (!b) return;
    const n = notes.unread + notes.alerts.length, text = n > 9 ? '9+' : String(n);
    // Only touch the page when something changed.
    if (b.hidden !== !n) b.hidden = !n;
    if (b.textContent !== text) b.textContent = text;
  }
  function closePanels() { document.querySelectorAll('.pf-panel').forEach((p) => p.remove()); }
  function openBell() {
    closePanels();
    const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const panel = document.createElement('div');
    panel.className = 'pf-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
    const items = [
      ...notes.alerts.map((a) => `<div class="pf-note unread">${esc(a.text)}${a.party ? ` <button class="btn small" type="button" data-open-party="${esc(a.party)}">See it</button>` : ''}</div>`),
      ...notes.notes.map((n) => `<div class="pf-note${n.read ? '' : ' unread'}">${esc(n.text)}${n.link && n.link !== '/#parties' ? ` <button class="btn small" type="button" data-note-link="${esc(n.link)}">Open</button>` : ''}<small>${esc(when(n.created_at))}</small></div>`),
    ];
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Notifications</b><button class="btn ghost small" type="button" data-close-panel>Close</button></div>${items.join('') || '<p class="muted">Nothing new. Save parties with ♡ to get alerts when they fill up.</p>'}`;
    document.body.appendChild(panel);
    if (notes.unread) S().api('/api/notifications/read', {}).then(() => { notes.unread = 0; notes.notes.forEach((n) => { n.read = true; }); paintBell(); }).catch(() => {});
  }

  // ---------- profile ----------
  async function openProfile() {
    closePanels();
    let p;
    try { p = await S().api('/api/profile'); } catch (e) { S().toast(e.message); return; }
    const st = S().state, link = p.referral.code ? p.referral.link + p.referral.code : '';
    const saved = p.saved.map((id) => S().party(id)).filter(Boolean);
    const panel = document.createElement('div');
    panel.className = 'pf-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Your profile');
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:1.1rem">${esc(st.user.name)}</b><button class="btn ghost small" type="button" data-close-panel>Close</button></div>
      <p class="muted" style="margin:4px 0 10px">${p.streak >= 1 ? `🔥 ${p.streak}-weekend streak. Keep it going!` : 'Request an invite this weekend to start a streak.'}</p>
      <b>Badges</b><div class="pf-badges">${p.badges.length ? p.badges.map((b) => `<div class="pf-badge"><i>${b.icon}</i><b>${esc(b.name)}</b><span>${esc(b.about)}</span></div>`).join('') : '<p class="muted" style="grid-column:1/-1">No badges yet. They unlock as you go out, invite friends and play Door Rush.</p>'}</div>
      <b>Invite friends, get a free semester</b>
      <p class="muted" style="margin:4px 0">${p.referral.rewarded ? '🎁 You earned your free semester. Thank you!' : `When ${p.referral.needed} friends sign up with your link and confirm their email, you get Full Access free for the semester.`}</p>
      <div class="pf-progress"><i style="width:${Math.min(100, p.referral.joined / p.referral.needed * 100)}%"></i></div>
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">${Math.min(p.referral.joined, p.referral.needed)} of ${p.referral.needed} friends joined</p>
      ${link ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><input class="input" readonly value="${esc(link)}" aria-label="Your invite link" style="flex:1 1 180px"><button class="btn small" type="button" data-copy="${esc(link)}">Copy</button>${navigator.share ? `<button class="btn small" type="button" data-share-link="${esc(link)}">Share</button>` : ''}</div>` : ''}
      <b>Saved parties</b>
      <div style="margin:6px 0 14px">${saved.length ? saved.map((x) => `<div class="pf-note">${esc(x.title)} <small>${esc(S().whenText(x))}</small> <button class="btn small" type="button" data-open-party="${esc(x.id)}">Open</button></div>`).join('') : '<p class="muted" style="margin:0">Tap ♡ on a party to save it. You\'ll get an alert when it starts filling up.</p>'}</div>
      <b>Settings</b>
      <label style="display:flex;gap:10px;align-items:center;cursor:pointer"><input type="checkbox" id="pfEmailOpt" ${p.emailUpdates ? 'checked' : ''}> Email me when I'm on a list, win a prize, or the Weekend Drop goes live</label>
      <p style="margin:14px 0 0"><button class="btn ghost small" type="button" data-welcome>🎁 Free Full Access and Door Rush rules</button></p>
      ${installHint()}`;
    document.body.appendChild(panel);
    panel.querySelector('#pfEmailOpt').addEventListener('change', (e) => S().api('/api/profile/email', { on: e.target.checked }).then(() => S().toast(e.target.checked ? 'Email updates on.' : 'Email updates off.')).catch((err) => S().toast(err.message)));
  }

  // ---------- share cards ----------
  async function shareParty(id) {
    const p = S().party(id); if (!p) return;
    const c = S().byId[p.ch], color = getComputedStyle(document.documentElement).getPropertyValue((S().VIBES[p.vibe].c.match(/--[\w-]+/) || ['--pink'])[0]).trim() || '#ff3fa4';
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    try { await document.fonts.load('80px Bungee'); } catch (e) {}
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b1026'); bg.addColorStop(1, '#1b2556');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = color; g.globalAlpha = .18; g.beginPath(); g.arc(W * .85, H * .2, 420, 0, 7); g.fill(); g.globalAlpha = 1;
    for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * .6) + ')'; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    g.textAlign = 'left'; g.fillStyle = '#ffd23f'; g.font = '64px Bungee, Impact, sans-serif'; g.fillText('PHATFRATS', 80, 140);
    g.fillStyle = color; g.font = '220px Bungee, Impact, sans-serif'; g.fillText(c.gl, 70, 470);
    g.fillStyle = '#fff'; g.font = '84px Bungee, Impact, sans-serif';
    const words = p.title.toUpperCase().split(' '); let line = '', y = 640;
    for (const w of words) { if (g.measureText(line + w).width > W - 160) { g.fillText(line, 80, y); line = ''; y += 100; } line += w + ' '; }
    g.fillText(line, 80, y);
    g.fillStyle = '#a7add8'; g.font = '600 46px "Bricolage Grotesque", sans-serif';
    g.fillText(c.name, 80, y + 90); g.fillText(S().whenText(p), 80, y + 160);
    g.fillStyle = color; g.fillRect(80, H - 250, W - 160, 8);
    g.fillStyle = '#fff'; g.font = '600 44px "Bricolage Grotesque", sans-serif'; g.fillText('Request your invite on PhatFrats', 80, H - 160);
    g.fillStyle = '#35e0ff'; g.font = '500 40px "DM Mono", monospace'; g.fillText(location.host + '/?party=' + p.id, 80, H - 100);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const file = new File([blob], `phatfrats-${p.id}.png`, { type: 'image/png' });
    const link = `${location.origin}/?party=${p.id}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: p.title, text: `${p.title} at ${c.name}. Request your invite on PhatFrats: ${link}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    copy(link, 'Story image saved, and the link is copied.');
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => S().toast(msg || 'Copied!')).catch(() => S().toast(text));
  }

  // ---------- groups ----------
  async function makeGroup(id) {
    try {
      const g = await S().api('/api/groups', { partyId: id });
      const p = S().party(id);
      if (navigator.share) { try { await navigator.share({ title: 'Come with us', text: `Going to ${p.title}? Join my group on PhatFrats and request your invite:`, url: g.link }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      copy(g.link, 'Group link copied. Send it to your friends!');
    } catch (err) { S().toast(err.message); }
  }
  async function loadGroup() {
    const code = params.get('group');
    if (!code || !S().state.user) return;
    try { group = await S().api('/api/groups/' + encodeURIComponent(code)); } catch (err) { S().toast(err.message); return; }
    const p = S().party(group.partyId);
    if (!p) { S().toast("That party isn't on the schedule anymore."); return; }
    S().toast(`👯 ${group.owner} invited you to go to ${p.title} together!`, 6000);
    S().select({ type: 'party', id: p.id }, true);
    if (!S().requestFor(p.id)) setTimeout(() => S().openInvite(p.id), 600);
  }
  const groupFor = (pid) => (group && group.partyId === pid ? group.code : null);

  // ---------- install as an app ----------
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; paintInstall(); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  function installHint() {
    if (standalone()) return '';
    if (installEvent) return '<p style="margin:14px 0 0"><button class="btn small gold" type="button" data-install>📲 Add PhatFrats to your home screen</button></p>';
    if (ios()) return '<p class="muted" style="margin:14px 0 0;font-size:.85rem">📲 Get the app: tap Share, then "Add to Home Screen".</p>';
    return '';
  }
  function paintInstall() {
    if (standalone() || !installEvent || $('#pfInstall')) return;
    const row = $('#heroLogin') && $('#heroLogin').parentElement;
    if (row) row.insertAdjacentHTML('beforeend', '<button class="btn ghost" type="button" id="pfInstall" data-install>📲 Get the app</button>');
  }
  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) {}
    installEvent = null; const b = $('#pfInstall'); if (b) b.remove();
  }

  // ---------- the Weekend Drop countdown ----------
  // The lineup drops every Thursday at 6 PM in State College and stays "live" through Sunday.
  function etParts(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const o = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday), min: Number(o.hour) * 60 + Number(o.minute) };
  }
  function paintDrop() {
    let box = $('#dropBox');
    const row = $('#heroLogin') && $('#heroLogin').parentElement;
    if (!row) return;
    if (!box) { row.insertAdjacentHTML('beforebegin', '<div class="drop-box" id="dropBox" role="status"></div>'); box = $('#dropBox'); }
    const { day, min } = etParts();
    const dropAt = 3 * 1440 + 18 * 60, now = day * 1440 + min;
    if (now >= dropAt) box.innerHTML = '🔥 <span>The Weekend Drop is live. This weekend\'s lineup is up!</span>';
    else {
      const left = dropAt - now, d = Math.floor(left / 1440), h = Math.floor((left % 1440) / 60), m = left % 60;
      box.innerHTML = `⏳ <span>The Weekend Drop: new lineup in</span> <span class="count">${d ? d + 'd ' : ''}${h}h ${m}m</span><span style="font-weight:400;color:var(--muted)">· Thursdays 6 PM</span>`;
    }
  }

  // ---------- the Party Smart kit ----------
  function paintKit() {
    const sec = $('#safety'); if (!sec || $('#pfKit')) return;
    sec.insertAdjacentHTML('beforeend', `<div class="kit" id="pfKit"><h3>Your Party Smart kit</h3>
      <p class="muted" style="margin:0">Quick tools for a safe night. Nothing here is stored or shared unless you choose to send it.</p>
      <div class="kit-grid">
        <a class="sos" href="tel:911">🚨 Emergency: call 911</a>
        <a href="https://www.police.psu.edu/" target="_blank" rel="noopener">🚓 Penn State Police</a>
        <button type="button" data-kit="location">📍 Share my location with a friend</button>
        <button type="button" data-kit="home">🏠 Tell friends I'm home safe</button>
        <button type="button" data-kit="checkin">⏰ Remind me to check in</button>
        <button type="button" data-kit="report">🚩 Report something</button>
      </div></div>
      <dialog id="pfReport" aria-labelledby="pfReportTitle"><form class="dlg" id="pfReportForm" novalidate>
        <h3 id="pfReportTitle">Report something</h3>
        <p class="muted" style="font-size:.88rem">This goes privately to the PhatFrats team. If anyone is in danger, call 911 first.</p>
        <div class="field"><label for="pfRKind">What's it about?</label><select class="input" id="pfRKind"><option value="party">A party or house</option><option value="person">A person</option><option value="safety">Something unsafe</option><option value="other">Something else</option></select></div>
        <div class="field"><label for="pfRAbout">Which party, house or person? (optional)</label><input class="input" id="pfRAbout" maxlength="120"></div>
        <div class="field"><label for="pfRDetails">What happened?</label><textarea class="input" id="pfRDetails" rows="4" maxlength="1500"></textarea></div>
        <p class="err" id="pfRErr"></p>
        <div class="dlg-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn" type="submit">Send report</button></div>
      </form></dialog>`);
    const dlg = $('#pfReport');
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    $('#pfReportForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#pfRErr').textContent = '';
      try {
        await S().api('/api/report', { kind: $('#pfRKind').value, about: $('#pfRAbout').value, details: $('#pfRDetails').value });
        dlg.close(); S().toast('Thank you. Your report went privately to the PhatFrats team.', 5000);
        $('#pfRDetails').value = ''; $('#pfRAbout').value = '';
      } catch (err) { $('#pfRErr').textContent = err.message; }
    });
  }
  async function kit(action) {
    if (action === 'report') {
      if (!S().state.user) { S().toast('Log in to send a report, so we can follow up. In an emergency, call 911.', 5000); S().openLogin(); return; }
      $('#pfReport').showModal(); return;
    }
    if (action === 'home') {
      const text = "I'm home safe 🏠";
      if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} } else copy(text, 'Copied. Paste it in your group chat.');
      return;
    }
    if (action === 'checkin') {
      const mins = Number(prompt('Remind you to check in with your friends in how many minutes?', '60'));
      if (!mins || mins < 1) return;
      const fire = () => {
        S().toast('⏰ Time to check in with your friends!', 10000);
        try { if (Notification.permission === 'granted') new Notification('PhatFrats', { body: 'Time to check in with your friends!' }); } catch (e) {}
      };
      try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
      setTimeout(fire, mins * 60000);
      S().toast(`Okay. We'll remind you in ${mins} minutes while this page is open.`);
      return;
    }
    if (action === 'location') {
      if (!navigator.geolocation) { S().toast("Your browser can't share location."); return; }
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const url = `https://www.google.com/maps?q=${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        const text = `Here's where I am right now: ${url}`;
        if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} } else copy(text, 'Your location link is copied. Paste it to a friend.');
      }, () => S().toast("Location isn't available. Check your browser's permission."), { enableHighAccuracy: true, timeout: 10000 });
    }
  }

  // ---------- welcome pop-up ----------
  // Shown once, the first time someone is logged in on this browser. They can open it again from their profile.
  const WELCOME_KEY = 'pf_welcome_v1';
  async function openWelcome() {
    closePanels();
    let p = null;
    try { p = await S().api('/api/profile'); } catch (e) {}
    const link = p && p.referral.code ? p.referral.link + p.referral.code : '';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const P = S().PRICING, thisTerm = P.passEndLabel(P.passEnds(today)), nextTerm = P.passEndLabel(P.passEnds(P.passEnds(today)));
    let dlg = document.getElementById('pfWelcome');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'pfWelcome';
      dlg.setAttribute('aria-labelledby', 'pfWelcomeTitle');
      dlg.style.maxWidth = '560px';
      document.body.appendChild(dlg);
    }
    const first = esc(S().state.user.name.split(' ')[0]);
    dlg.innerHTML = `<div class="dlg" style="max-height:82vh;overflow:auto">
      <span class="eyebrow">Welcome to PhatFrats</span>
      <h3 id="pfWelcomeTitle">Hey ${first}! Two ways to get Full Access free 🎉</h3>

      <div class="pf-note" style="margin-top:12px"><b>🎁 Bring 3 friends, get a free semester</b>
        <p style="margin:6px 0 0;color:var(--muted)">Share your invite link. When 3 friends sign up with it <b>and confirm their Penn State email</b>, you get Full Access free through <b>${esc(thisTerm)}</b>. It happens automatically, and you'll get a notification. Track your progress in your profile (tap your initials).</p>
        ${link ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><input class="input" readonly value="${esc(link)}" aria-label="Your invite link" style="flex:1 1 180px"><button class="btn small" type="button" data-copy="${esc(link)}">Copy link</button>${navigator.share ? `<button class="btn small" type="button" data-share-link="${esc(link)}">Share</button>` : ''}</div>` : ''}
      </div>

      <div class="pf-note"><b>🏆 Win Door Rush, win a free semester</b>
        <p style="margin:6px 0 0;color:var(--muted)">Each week (Monday to Sunday), the top Door Rush score wins Full Access through <b>${esc(nextTerm)}</b>. The prize is given automatically every Monday, with a notification and a champion badge. Door Rush is free for everyone; play it from <a href="/game">Game</a> in the menu.</p>
      </div>

      <div class="pf-note"><b>👯 Add your friends</b>
        <p style="margin:6px 0 0;color:var(--muted)">Tap 👯 at the top to add friends and see which parties they're going to this weekend. Tap "I'm going" on a party to show them yours. Only friends you both accepted can see it, plans disappear after the party, and ghost mode hides you any time.</p>
      </div>

      <div class="pf-note"><b>🕹️ How Door Rush works</b>
        <ul style="margin:6px 0 0;padding-left:20px;color:var(--muted);line-height:1.5">
          <li>Guests walk up the street. Send each one to the right party before they reach the red line: <b>★ star → Neon</b>, <b>● circle → Chill</b>, <b>◆ diamond → Costume</b>.</li>
          <li>Hooded guests with a red <b>✕</b> are crashers: hit <b>Bounce</b>. Letting one in counts as a mistake.</li>
          <li><b>3 mistakes</b> (wrong door, a crasher gets in, too slow, or bouncing a real guest) and the doors close.</li>
          <li>From level 3 the <b>doors switch places</b>, so watch the labels.</li>
          <li>Streaks raise your multiplier up to <b>x5</b>. 👑 VIPs are worth <b>triple</b>. Fill the Hype meter for 6 seconds of <b>double points</b>.</li>
          <li>Every 40 correct guests wins back a lost wristband (up to 3).</li>
          <li>Keys: ← ↑ → to send, ↓ or Space to bounce. On a phone, use the big buttons.</li>
          <li>The leaderboard resets Monday at midnight. Scores have to come from real games; impossible scores aren't saved.</li>
        </ul>
      </div>

      <div class="dlg-actions"><button class="btn" type="button" data-welcome-done>Let's go</button></div>
    </div>`;
    dlg.querySelector('[data-welcome-done]').addEventListener('click', () => dlg.close());
    // Counted as seen as soon as it shows, so it never pops up twice.
    store.set(WELCOME_KEY, '1');
    if (!dlg.open) dlg.showModal();
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t.closest) return;
    if (t.closest('#bellBtn')) { e.preventDefault(); if (document.querySelector('.pf-panel[aria-label="Notifications"]')) closePanels(); else openBell(); return; }
    if (t.closest('#profileBtn')) { e.preventDefault(); openProfile(); return; }
    if (t.closest('[data-close-panel]')) { closePanels(); return; }
    const nl = t.closest('[data-note-link]');
    if (nl) {
      closePanels();
      const link = nl.dataset.noteLink;
      // Friends notes open the Friends screen right here; other links go to their page.
      if (link.startsWith('/?friends') && window.PFFriends) window.PFFriends.open(); else if (link.startsWith('/')) location.href = link;
      return;
    }
    const sv = t.closest('[data-save]');
    if (sv) {
      e.preventDefault(); e.stopPropagation();
      const on = sv.getAttribute('aria-pressed') !== 'true';
      try { const r = await S().api('/api/saved', { partyId: sv.dataset.save, on }); S().state.saved = r.saved; S().renderAll(); S().toast(on ? '♥ Saved. We\'ll alert you if it starts filling up.' : 'Removed from saved.'); }
      catch (err) { S().toast(err.message); }
      return;
    }
    const sh = t.closest('[data-share]'); if (sh) { e.preventDefault(); shareParty(sh.dataset.share); return; }
    const gr = t.closest('[data-group]'); if (gr) { e.preventDefault(); makeGroup(gr.dataset.group); return; }
    const op = t.closest('[data-open-party]'); if (op) { closePanels(); S().select({ type: 'party', id: op.dataset.openParty }, true); return; }
    const cp = t.closest('[data-copy]'); if (cp) { copy(cp.dataset.copy, 'Link copied!'); return; }
    const sl = t.closest('[data-share-link]'); if (sl) { try { await navigator.share({ text: 'Join me on PhatFrats, the Penn State party map:', url: sl.dataset.shareLink }); } catch (err) {} return; }
    if (t.closest('[data-install]')) { install(); return; }
    if (t.closest('[data-welcome]')) { openWelcome(); return; }
    const k = t.closest('[data-kit]'); if (k) { kit(k.dataset.kit); return; }
    if (!t.closest('.pf-panel')) closePanels();
  }, true);

  // ---------- start ----------
  function start() {
    paintDrop(); setInterval(paintDrop, 30000);
    paintKit(); paintInstall();
    // The account loads after the page, so wait for it before the bell, groups and party links.
    let tries = 0;
    const wait = setInterval(() => {
      const st = S().state;
      if (st.user || ++tries > 40) {
        clearInterval(wait);
        if (!st.user) {
          if (params.get('group') || params.get('party')) S().toast('Log in or sign up to see this party.', 5000);
          return;
        }
        loadGroup();
        const pid = params.get('party');
        if (pid && S().party(pid)) S().select({ type: 'party', id: pid }, true);
      }
    }, 250);
    // The bell is redrawn with the header, so its number is put back after each redraw.
    const auth = $('#authArea');
    // Logging in later (without a reload) also starts the bell.
    let started = false;
    const kick = () => {
      if (!started && $('#bellBtn')) {
        started = true; loadNotes(); setInterval(() => { if (!document.hidden) loadNotes(); }, 60000);
        // First time logged in on this browser (including right after signing up): the welcome pop-up.
        if (!store.get(WELCOME_KEY) && !params.get('group')) setTimeout(openWelcome, 900);
      }
      paintBell();
    };
    // Only the header being rebuilt counts, not the bell's own number changing.
    if (auth) new MutationObserver(kick).observe(auth, { childList: true });
    kick();
  }

  window.PFCommunity = {
    start, saveButton, detailExtras, groupFor,
    referral: () => store.get('pf_ref'),
  };
})();
