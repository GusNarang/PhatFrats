// Friends mode on the main site, free for everyone: the 👯 button in the header opens the Friends screen
// (this weekend, friends, add friends, leaderboard, privacy). Party details show which friends are going,
// an "I'm going" switch and "Invite friends". Friend links look like /?friend=CODE.
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const params = new URLSearchParams(location.search);
  // A friend link also counts as a referral if you're new.
  const linkCode = (params.get('friend') || '').toUpperCase();
  if (/^[A-Z0-9]{5,8}$/.test(linkCode)) { store.set('pf_friend', linkCode); if (!store.get('pf_ref')) store.set('pf_ref', linkCode); }

  const S = () => window.PFSite;
  const esc = (s) => S().esc(s);
  const $ = (s) => document.querySelector(s);
  const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const firstName = (n) => String(n).split(/\s+/)[0];
  let data = null, tab = 'weekend', viewing = null, lastSig = '', timer = null;

  const css = document.createElement('style');
  css.textContent = `
  .fr-btn{position:relative;background:var(--night-2);border:1.5px solid var(--line);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;line-height:1}
  .fr-btn b{position:absolute;top:-4px;right:-4px;background:var(--gold);color:#241a00;font:700 11px/18px var(--body);min-width:18px;height:18px;border-radius:9px;padding:0 4px}
  #pfFriends{width:min(640px,calc(100vw - 24px))}
  #pfFriends .dlg{max-height:86vh;overflow:auto;gap:12px}
  .fr-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .fr-tabs{display:flex;gap:4px;background:var(--night-3);padding:4px;border-radius:12px;overflow-x:auto}
  .fr-tab{font:inherit;font-weight:800;font-size:.85rem;border:0;border-radius:9px;padding:.55em .8em;background:transparent;color:var(--muted);cursor:pointer;white-space:nowrap;flex:1 0 auto}
  .fr-tab[aria-selected="true"]{background:var(--ink);color:var(--night)}
  .fr-card{background:var(--night);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
  .fr-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .fr-row .grow{flex:1 1 140px;min-width:0}
  .fr-av{width:36px;height:36px;border-radius:50%;display:inline-grid;place-items:center;font:800 .8rem var(--body);background:linear-gradient(135deg,var(--pink),var(--violet,#8f6bff));color:#fff;flex:0 0 auto;border:2px solid var(--night-2)}
  .fr-stack{display:flex}.fr-stack .fr-av{margin-left:-8px;width:30px;height:30px;font-size:.7rem}.fr-stack .fr-av:first-child{margin-left:0}
  .fr-muted{color:var(--muted);font-size:.85rem}
  .fr-chip{display:inline-flex;align-items:center;gap:4px;font:700 .78rem var(--body);background:rgba(255,210,63,.14);color:var(--gold);border-radius:999px;padding:3px 9px;white-space:nowrap}
  .fr-going{display:flex;flex-direction:column;gap:8px;background:var(--night);border:1px solid var(--line);border-radius:14px;padding:12px;margin:10px 0}
  .fr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
  .fr-stat{background:var(--night-3);border-radius:12px;padding:10px;text-align:center}
  .fr-stat b{display:block;font-family:var(--display);font-weight:400;font-size:1.3rem;color:var(--gold)}
  .fr-stat span{font-size:.75rem;color:var(--muted)}
  .fr-opt{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;font-size:.9rem;cursor:pointer}
  .fr-opt:has(input:checked){border-color:var(--pink)}
  .fr-rank{font-family:var(--mono);color:var(--muted);width:28px;text-align:center}
  .fr-pick{display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto}
  .fr-empty{text-align:center;padding:18px 8px;color:var(--muted)}
  .fr-empty i{display:block;font-style:normal;font-size:34px;margin-bottom:6px}
  `;
  document.head.appendChild(css);

  // ---------- data ----------
  async function load(rerender = true) {
    if (!S().state.user) return null;
    try { data = await S().api('/api/friends'); } catch (e) { return null; }
    paintButton();
    // Only redraw the map and cards when what friends are doing changed.
    const sig = JSON.stringify([data.board, data.mine]);
    if (rerender && sig !== lastSig) { lastSig = sig; S().renderAll(); }
    if (dialog().open) paint();
    return data;
  }
  const friendById = (id) => (data ? data.friends.find((f) => f.id === id) : null);
  const goingTo = (pid) => (data ? (data.board.find((b) => b.partyId === pid) || { friends: [] }).friends.map(friendById).filter(Boolean) : []);
  const amGoing = (pid) => !!(data && data.mine.some((m) => m.partyId === pid));
  // Full Access members get a gold ring and a 💎.
  const av = (p, style = '') => `<span class="fr-av${p.full ? ' gold-ring' : ''}"${style ? ` style="${style}"` : ''} title="${esc(p.name)}${p.full ? ' · Full Access' : ''}">${esc(initials(p.name))}</span>`;
  const gem = (p) => (p.full ? ' <span title="Full Access">💎</span>' : '');
  const stack = (people, max = 4) => `<span class="fr-stack">${people.slice(0, max).map((p) => av(p)).join('')}</span>`;
  const names = (people) => {
    const n = people.map((p) => esc(firstName(p.name)));
    return n.length <= 2 ? n.join(' and ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
  };

  function paintButton() {
    const b = $('#friendsCount');
    if (!b || !data) return;
    const n = data.incoming.length, text = n > 9 ? '9+' : String(n);
    if (b.hidden !== !n) b.hidden = !n;
    if (b.textContent !== text) b.textContent = text;
  }

  // ---------- on the map: party cards and details ----------
  function chip(pid) {
    const who = goingTo(pid);
    return who.length ? `<span class="fr-chip" title="${names(who)} going">👯 ${who.length}</span>` : '';
  }
  function detail(p) {
    if (!S().state.user || !data) return '';
    const who = goingTo(p.id), me = amGoing(p.id);
    const priv = data.mine.find((m) => m.partyId === p.id && m.private);
    return `<div class="fr-going">
      ${who.length ? `<div class="fr-row">${stack(who)}<span class="grow"><b>${names(who)}</b> ${who.length === 1 ? 'is' : 'are'} going</span></div>` : `<span class="fr-muted">${data.friends.length ? 'None of your friends have said they\'re going yet.' : 'Add friends to see who\'s going.'}</span>`}
      <div class="fr-row">
        <button class="btn ${me ? 'ghost ' : ''}small" type="button" data-fr-going="${esc(p.id)}" aria-pressed="${me}">${me ? '✓ You\'re going · Hide' : '👀 I\'m going. Show my friends'}</button>
        ${data.friends.length ? `<button class="btn ghost small" type="button" data-fr-bring="${esc(p.id)}">📨 Invite friends</button>` : '<button class="btn ghost small" type="button" data-fr-open="add">👯 Add friends</button>'}
      </div>
      ${priv ? '<span class="fr-muted">This house keeps its crowd private, so your friends won\'t see you here.</span>' : ''}
      ${data.ghost.on && me ? '<span class="fr-muted">👻 Ghost mode is on, so friends can\'t see this right now.</span>' : ''}
    </div>`;
  }

  // ---------- the Friends screen ----------
  function dialog() {
    let d = document.getElementById('pfFriends');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'pfFriends';
      d.setAttribute('aria-labelledby', 'pfFriendsTitle');
      d.innerHTML = '<div class="dlg"></div>';
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      document.body.appendChild(d);
    }
    return d;
  }
  async function open(which) {
    if (!S().state.user) { S().toast('Log in to add friends.'); S().openLogin(); return; }
    if (which) tab = which;
    viewing = null;
    const d = dialog();
    if (!data) d.querySelector('.dlg').innerHTML = '<p class="fr-muted">Loading your friends…</p>';
    if (!d.open) d.showModal();
    await load(false);
    paint();
  }
  const TABS = [['weekend', '🔥 This weekend'], ['friends', '👯 Friends'], ['add', '➕ Add'], ['board', '🕹️ Leaderboard'], ['privacy', '🔒 Privacy']];
  function paint() {
    const d = dialog(), box = d.querySelector('.dlg');
    if (!data) { box.innerHTML = '<p class="fr-muted">Couldn\'t load your friends. Try again in a moment.</p><div class="dlg-actions"><button class="btn ghost" type="button" data-fr-close>Close</button></div>'; return; }
    if (viewing) { paintProfile(box); return; }
    const reqs = data.incoming.length;
    box.innerHTML = `<div class="fr-head"><h3 id="pfFriendsTitle">Friends</h3><button class="btn ghost small" type="button" data-fr-close>Close</button></div>
      <div class="fr-tabs" role="tablist">${TABS.map(([k, label]) => `<button class="fr-tab" type="button" role="tab" data-fr-tab="${k}" aria-selected="${tab === k}">${label}${k === 'friends' && reqs ? ` (${reqs})` : ''}</button>`).join('')}</div>
      <div role="tabpanel">${({ weekend: weekendTab, friends: friendsTab, add: addTab, board: boardTab, privacy: privacyTab })[tab]()}</div>`;
    const form = box.querySelector('#frAddForm');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); sendRequest({ email: box.querySelector('#frEmail').value }); });
  }
  const partyLine = (pid) => {
    const p = S().party(pid);
    return p ? `<b>${esc(p.title)}</b><br><span class="fr-muted">${esc((S().byId[p.ch] || {}).name || '')} · ${esc(S().whenText(p))}</span>` : '<span class="fr-muted">A party</span>';
  };

  function weekendTab() {
    const board = data.board.filter((b) => S().party(b.partyId));
    const mine = data.mine.filter((m) => S().party(m.partyId));
    let html = '';
    if (data.ghost.on) html += `<div class="fr-card"><span>👻 <b>Ghost mode is on.</b> Friends can't see your plans${data.ghost.always ? '' : ' until Monday'}.</span><button class="btn ghost small" type="button" data-fr-ghost="off" style="align-self:flex-start">Turn it off</button></div>`;
    html += `<b>Where your friends are going</b>`;
    if (!data.friends.length) html += `<div class="fr-empty"><i>👯</i>No friends yet. Add a few and you'll see where they're headed this weekend.<br><button class="btn small" type="button" data-fr-tab="add" style="margin-top:10px">Add friends</button></div>`;
    else if (!board.length) html += `<div class="fr-empty"><i>🌙</i>None of your friends have shared plans yet. Be the first: open a party and tap "I'm going".</div>`;
    else html += board.map((b) => {
      const who = b.friends.map(friendById).filter(Boolean);
      const me = amGoing(b.partyId);
      return `<div class="fr-card"><div class="fr-row"><span class="grow">${partyLine(b.partyId)}</span>${stack(who)}</div>
        <span class="fr-muted">${names(who)} ${who.length === 1 ? 'is' : 'are'} going${me ? ', and so are you 🎉' : ''}</span>
        <div class="fr-row"><button class="btn small" type="button" data-fr-party="${esc(b.partyId)}">Open party</button>${me ? '' : `<button class="btn ghost small" type="button" data-fr-going="${esc(b.partyId)}">👀 I'm going too</button>`}</div></div>`;
    }).join('');
    html += `<b style="margin-top:8px">Your plans</b>`;
    html += mine.length ? mine.map((m) => `<div class="fr-card"><div class="fr-row"><span class="grow">${partyLine(m.partyId)}${m.private ? '<br><span class="fr-muted">This house keeps its crowd private, so friends won\'t see you here.</span>' : ''}</span>
        <button class="btn ghost small" type="button" data-fr-going="${esc(m.partyId)}" aria-pressed="true">Hide</button></div></div>`).join('')
      : '<p class="fr-muted" style="margin:0">You haven\'t shared any plans. Open a party and tap "👀 I\'m going" to show your friends. Plans disappear after the party.</p>';
    return `<div style="display:flex;flex-direction:column;gap:8px">${html}</div>`;
  }

  function friendsTab() {
    let html = '';
    if (data.incoming.length) {
      html += '<b>Friend requests</b>' + data.incoming.map((u) => `<div class="fr-card"><div class="fr-row"><span class="fr-av">${esc(initials(u.name))}</span><span class="grow"><b>${esc(u.name)}</b><br><span class="fr-muted">wants to be friends</span></span>
        <button class="btn small" type="button" data-fr-accept="${esc(u.id)}">Accept</button><button class="btn ghost small" type="button" data-fr-decline="${esc(u.id)}">Decline</button><button class="btn ghost small" type="button" data-fr-block="${esc(u.id)}" data-name="${esc(u.name)}" title="Block">🚫</button></div></div>`).join('');
    }
    html += `<b>Your friends (${data.friends.length})</b>`;
    if (!data.friends.length) html += `<div class="fr-empty"><i>🫂</i>No friends yet.<br><button class="btn small" type="button" data-fr-tab="add" style="margin-top:10px">Add friends</button></div>`;
    else html += data.friends.map((f) => {
      const plans = f.going.map((pid) => S().party(pid)).filter(Boolean);
      return `<div class="fr-card"><div class="fr-row">${av(f)}
        <span class="grow"><b>${esc(f.name)}</b>${gem(f)}<br><span class="fr-muted">${plans.length ? '🔥 Going to ' + plans.map((p) => esc(p.title)).join(', ') : 'No plans shared this weekend'}</span></span>
        <button class="btn ghost small" type="button" data-fr-profile="${esc(f.id)}">Profile</button></div></div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:8px">${html}</div>`;
  }

  function addTab() {
    let html = `<div class="fr-card"><b>Your friend link</b><span class="fr-muted">Anyone who opens it can send you a request. New people who sign up with it also count toward your free semester.</span>
      ${data.link ? `<div class="fr-row"><input class="input grow" readonly value="${esc(data.link)}" aria-label="Your friend link"><button class="btn small" type="button" data-copy="${esc(data.link)}">Copy</button>${navigator.share ? `<button class="btn small" type="button" data-fr-share="${esc(data.link)}">Share</button>` : ''}</div>` : ''}</div>
      <form class="fr-card" id="frAddForm" novalidate><b>Add by email</b>
        <div class="fr-row"><input class="input grow" id="frEmail" type="email" placeholder="friend@psu.edu" autocomplete="off" aria-label="Your friend's Penn State email"><button class="btn small" type="submit">Send request</button></div>
        <span class="fr-muted">They'll see it in their 🔔 and accept it. Nothing happens until they do.</span></form>`;
    if (data.suggestions.length) html += '<b>People you may know</b>' + data.suggestions.map((s) => `<div class="fr-card"><div class="fr-row"><span class="fr-av">${esc(initials(s.name))}</span><span class="grow"><b>${esc(s.name)}</b><br><span class="fr-muted">${esc(s.why)}</span></span><button class="btn small" type="button" data-fr-add="${esc(s.code)}">Add</button></div></div>`).join('');
    if (data.outgoing.length) html += '<b>Requests you sent</b>' + data.outgoing.map((u) => `<div class="fr-card"><div class="fr-row"><span class="fr-av">${esc(initials(u.name))}</span><span class="grow">${esc(u.name)}<br><span class="fr-muted">Waiting for them to accept</span></span><button class="btn ghost small" type="button" data-fr-remove="${esc(u.id)}" data-quiet="1">Cancel</button></div></div>`).join('');
    return `<div style="display:flex;flex-direction:column;gap:8px">${html}</div>`;
  }

  function boardTab() {
    const rows = data.leaderboard;
    return `<div style="display:flex;flex-direction:column;gap:8px"><span class="fr-muted">This week's best Door Rush scores among you and your friends. Resets Monday at midnight.</span>
      ${rows.length ? rows.map((r) => `<div class="fr-card"><div class="fr-row"><span class="fr-rank">${r.place === 1 ? '👑' : '#' + r.place}</span>${av(r)}<span class="grow"><b>${esc(r.you ? 'You' : r.name)}</b>${gem(r)}</span><b style="font-family:var(--mono);color:var(--gold)">${r.score.toLocaleString('en-US')}</b></div></div>`).join('')
        : '<div class="fr-empty"><i>🕹️</i>No scores from your crew this week yet.</div>'}
      <a class="btn small" href="/game" style="align-self:flex-start">Play Door Rush</a></div>`;
  }

  function privacyTab() {
    const mode = data.ghost.always ? 'always' : data.ghost.on ? 'weekend' : 'off';
    const opt = (v, title, about) => `<label class="fr-opt"><input type="radio" name="frGhost" value="${v}" ${mode === v ? 'checked' : ''} data-fr-ghost-radio><span><b>${title}</b><br><span class="fr-muted">${about}</span></span></label>`;
    return `<div style="display:flex;flex-direction:column;gap:8px">
      <b>👻 Ghost mode</b>
      ${opt('off', 'Off', 'Friends see the parties you mark "I\'m going".')}
      ${opt('weekend', 'On for this weekend', 'Hidden from friends until Monday, then it switches off by itself.')}
      ${opt('always', 'On until I switch it off', 'Friends never see your plans.')}
      <div class="fr-card"><b>How friends mode keeps you safe</b>
        <ul style="margin:0;padding-left:18px;line-height:1.5" class="fr-muted">
          <li>Only people you both accepted are friends. Nobody can follow you one way.</li>
          <li>Friends only see parties you mark "I'm going". Never your live location.</li>
          <li>Plans disappear after the party. There's no history of where you've been.</li>
          <li>Some houses keep their crowd private, and those never show on friends boards.</li>
          <li>Removing or blocking someone is quiet. They aren't told.</li>
        </ul></div>
      <b>Blocked</b>
      ${data.blocked.length ? data.blocked.map((u) => `<div class="fr-card"><div class="fr-row"><span class="grow">${esc(u.name)}</span><button class="btn ghost small" type="button" data-fr-unblock="${esc(u.id)}">Unblock</button></div></div>`).join('') : '<p class="fr-muted" style="margin:0">Nobody. Blocked people can\'t send you requests or see anything about you.</p>'}
    </div>`;
  }

  // ---------- a friend's profile ----------
  function paintProfile(box) {
    const p = viewing;
    if (p.loading) { box.innerHTML = '<p class="fr-muted">Loading…</p>'; return; }
    const date = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const plans = p.going.map((pid) => S().party(pid)).filter(Boolean);
    box.innerHTML = `<div class="fr-head"><button class="btn ghost small" type="button" data-fr-back>← Friends</button><button class="btn ghost small" type="button" data-fr-close>Close</button></div>
      <div class="fr-row">${av(p, 'width:56px;height:56px;font-size:1.1rem')}
        <span class="grow"><h3 id="pfFriendsTitle" style="margin:0">${esc(p.name)}${gem(p)}</h3><span class="fr-muted">On PhatFrats since ${esc(date(p.joined))}${p.friendsSince ? ` · Friends since ${esc(date(p.friendsSince))}` : ''}</span></span></div>
      ${plans.length ? `<div class="fr-card"><b>🔥 This weekend</b>${plans.map((x) => `<div class="fr-row"><span class="grow">${partyLine(x.id)}</span><button class="btn small" type="button" data-fr-party="${esc(x.id)}">Open</button></div>`).join('')}</div>` : ''}
      <div class="fr-stats">
        <div class="fr-stat"><b>${p.streak}</b><span>weekend streak</span></div>
        <div class="fr-stat"><b>${p.parties}</b><span>parties</span></div>
        <div class="fr-stat"><b>${p.together}</b><span>parties with you</span></div>
        <div class="fr-stat"><b>${p.mutual.count}</b><span>friends in common</span></div>
      </div>
      ${p.favorite ? `<div class="fr-card"><span>🏠 Favorite house: <b>${esc(p.favorite.name)}</b> <span class="fr-muted">(${p.favorite.times} time${p.favorite.times === 1 ? '' : 's'})</span></span></div>` : ''}
      <b>🕹️ Door Rush</b>
      <div class="fr-stats">
        <div class="fr-stat"><b>${p.doorRush.week.toLocaleString('en-US')}</b><span>best this week</span></div>
        <div class="fr-stat"><b>${p.doorRush.best.toLocaleString('en-US')}</b><span>best ever</span></div>
        <div class="fr-stat"><b>${p.doorRush.games}</b><span>games</span></div>
        <div class="fr-stat"><b>${p.doorRush.wins}</b><span>weekly wins</span></div>
      </div>
      <b>Badges</b>
      <div class="pf-badges">${p.badges.length ? p.badges.map((b) => `<div class="pf-badge"><i>${b.icon}</i><b>${esc(b.name)}</b><span>${esc(b.about)}</span></div>`).join('') : '<p class="fr-muted" style="grid-column:1/-1;margin:0">No badges yet.</p>'}</div>
      ${p.mutual.count ? `<p class="fr-muted" style="margin:0">Friends in common: ${p.mutual.names.map(esc).join(', ')}${p.mutual.count > p.mutual.names.length ? ` and ${p.mutual.count - p.mutual.names.length} more` : ''}</p>` : ''}
      <div class="fr-row" style="margin-top:6px"><button class="btn ghost small" type="button" data-fr-remove="${esc(p.id)}" data-name="${esc(p.name)}">Remove friend</button><button class="btn ghost small" type="button" data-fr-block="${esc(p.id)}" data-name="${esc(p.name)}">🚫 Block</button></div>`;
  }
  async function openProfile(id) {
    viewing = { loading: true };
    paint();
    try { viewing = await S().api('/api/friends/' + encodeURIComponent(id) + '/profile'); }
    catch (e) { viewing = null; S().toast(e.message); }
    paint();
  }

  // ---------- invite friends to a party ----------
  function openBring(pid) {
    const p = S().party(pid);
    if (!p || !data) return;
    const already = new Set(goingTo(pid).map((f) => f.id));
    const d = dialog(), box = d.querySelector('.dlg');
    viewing = null;
    box.innerHTML = `<div class="fr-head"><h3 id="pfFriendsTitle">Invite friends</h3><button class="btn ghost small" type="button" data-fr-close>Close</button></div>
      <p class="fr-muted" style="margin:0">Pick friends to bring to <b>${esc(p.title)}</b>. They get your group link in their 🔔. Each person still requests their own invite.</p>
      <div class="fr-pick">${data.friends.map((f) => `<label class="fr-opt"><input type="checkbox" value="${esc(f.id)}" ${already.has(f.id) ? 'disabled' : ''}><span class="fr-av">${esc(initials(f.name))}</span><span><b>${esc(f.name)}</b>${already.has(f.id) ? '<br><span class="fr-muted">Already going</span>' : ''}</span></label>`).join('')}</div>
      <div class="dlg-actions"><button class="btn ghost" type="button" data-fr-close>Cancel</button><button class="btn" type="button" data-fr-send="${esc(pid)}">Send invites</button></div>`;
    if (!d.open) d.showModal();
  }

  // ---------- actions ----------
  async function sendRequest(body) {
    try {
      const r = await S().api('/api/friends/request', body);
      S().toast(r.status === 'friends' ? `🤝 You and ${r.name || 'them'} are friends now!` : '👯 Friend request sent!');
      const f = $('#frEmail'); if (f) f.value = '';
      await load();
    } catch (e) { S().toast(e.message, 5000); }
  }
  async function act(path, body, msg) {
    try { await S().api(path, body); if (msg) S().toast(msg); await load(); } catch (e) { S().toast(e.message); }
  }
  async function toggleGoing(pid) {
    const on = !amGoing(pid);
    try {
      await S().api('/api/friends/going', { partyId: pid, on });
      S().toast(on ? (data.friends.length ? '👀 Your friends can see you\'re going.' : '👀 Saved. Add friends so they can see it.') : 'Hidden from your friends.');
      await load();
      if (!dialog().open) S().renderAll();
    } catch (e) { S().toast(e.message); }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t.closest) return;
    const q = (sel) => t.closest(sel);
    let el;
    if (q('#friendsBtn')) { e.preventDefault(); open(); return; }
    if (q('[data-fr-close]')) { dialog().close(); return; }
    if ((el = q('[data-fr-tab]'))) { tab = el.dataset.frTab; viewing = null; paint(); return; }
    if ((el = q('[data-fr-open]'))) { open(el.dataset.frOpen); return; }
    if (q('[data-fr-back]')) { viewing = null; tab = 'friends'; paint(); return; }
    if ((el = q('[data-fr-going]'))) { e.preventDefault(); toggleGoing(el.dataset.frGoing); return; }
    if ((el = q('[data-fr-bring]'))) { e.preventDefault(); openBring(el.dataset.frBring); return; }
    if ((el = q('[data-fr-party]'))) { dialog().close(); S().select({ type: 'party', id: el.dataset.frParty }, true); return; }
    if ((el = q('[data-fr-profile]'))) { openProfile(el.dataset.frProfile); return; }
    if ((el = q('[data-fr-add]'))) { el.disabled = true; sendRequest({ code: el.dataset.frAdd }); return; }
    if ((el = q('[data-fr-accept]'))) { act('/api/friends/respond', { id: el.dataset.frAccept, accept: true }, '🤝 You\'re friends now!'); return; }
    if ((el = q('[data-fr-decline]'))) { act('/api/friends/respond', { id: el.dataset.frDecline, accept: false }, 'Request declined.'); return; }
    if ((el = q('[data-fr-remove]'))) {
      if (!el.dataset.quiet && !confirm(`Remove ${el.dataset.name} from your friends? They won't be told.`)) return;
      viewing = null; act('/api/friends/remove', { id: el.dataset.frRemove }, el.dataset.quiet ? 'Request cancelled.' : 'Removed.'); return;
    }
    if ((el = q('[data-fr-block]'))) {
      if (!confirm(`Block ${el.dataset.name}? They won't be told, and they can't send you requests or see your plans.`)) return;
      viewing = null; act('/api/friends/block', { id: el.dataset.frBlock }, 'Blocked.'); return;
    }
    if ((el = q('[data-fr-unblock]'))) { act('/api/friends/unblock', { id: el.dataset.frUnblock }, 'Unblocked.'); return; }
    if ((el = q('[data-fr-ghost]'))) { act('/api/friends/ghost', { mode: el.dataset.frGhost }, '👻 Ghost mode off.'); return; }
    if ((el = q('[data-fr-share]'))) { try { await navigator.share({ text: 'Add me on PhatFrats so we can see where each other is going this weekend:', url: el.dataset.frShare }); } catch (err) {} return; }
    if ((el = q('[data-fr-send]'))) {
      const ids = [...dialog().querySelectorAll('.fr-pick input:checked')].map((i) => i.value);
      if (!ids.length) { S().toast('Pick at least one friend.'); return; }
      el.disabled = true;
      try { const r = await S().api('/api/friends/bring', { partyId: el.dataset.frSend, ids }); dialog().close(); S().toast(`📨 Sent to ${r.sent} friend${r.sent === 1 ? '' : 's'}!`); }
      catch (err) { el.disabled = false; S().toast(err.message); }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('[data-fr-ghost-radio]')) {
      const mode = e.target.value;
      act('/api/friends/ghost', { mode }, mode === 'off' ? '👻 Ghost mode off. Friends can see your plans.' : mode === 'weekend' ? '👻 Hidden from friends until Monday.' : '👻 Hidden from friends until you switch it off.');
    }
  });

  // ---------- start ----------
  function start() {
    let started = false;
    const kick = () => {
      if (!S().state.user) { started = false; data = null; return; }
      paintButton();
      if (started) return;
      started = true;
      load().then(() => {
        // A friend link: ask before sending the request.
        const code = store.get('pf_friend');
        if (code) {
          store.del('pf_friend');
          if (code !== data?.code && confirm('Send a friend request to the person who shared this link?')) sendRequest({ code });
        }
        if (params.get('friends')) open(data && data.incoming.length ? 'friends' : 'weekend');
      });
      if (!timer) timer = setInterval(() => { if (!document.hidden && S().state.user) load(); }, 90000);
    };
    const auth = $('#authArea');
    if (auth) new MutationObserver(kick).observe(auth, { childList: true });
    kick();
  }

  window.PFFriends = { start, chip, detail, open, refresh: () => load() };
})();
