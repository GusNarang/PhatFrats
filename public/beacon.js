// Shared by the main site, the frat portal and Door Rush:
// - shows the admin's beacon banner (people can close it, and it stays closed in that browser);
// - tells the control room's live radar that this page is open. The id is the random one the site already uses.
(function () {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  function visitor() {
    let v = store.get('pf_v');
    if (!v) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
      store.set('pf_v', v);
    }
    return v;
  }

  // ---------- beacon ----------
  const TONES = { gold: ['#ffd23f', '#0b1026'], pink: ['#ff3fa4', '#ffffff'], cyan: ['#35e0ff', '#0b1026'], red: ['#ff5d6c', '#ffffff'] };
  fetch('/api/beacon', { cache: 'no-store' }).then((r) => r.json()).then(({ beacon }) => {
    if (!beacon || store.get('pf_beacon_closed') === String(beacon.id)) return;
    const [bg, fg] = TONES[beacon.tone] || TONES.gold;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = `position:sticky;top:0;z-index:50;background:${bg};color:${fg};font:700 15px/1.4 "Bricolage Grotesque",system-ui,sans-serif;padding:10px 48px 10px 16px;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.3)`;
    bar.textContent = beacon.text;
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close announcement');
    close.textContent = '✕';
    close.style.cssText = `position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:0;color:${fg};font:700 18px sans-serif;cursor:pointer;padding:6px 10px;min-height:40px`;
    close.onclick = () => { store.set('pf_beacon_closed', String(beacon.id)); bar.remove(); };
    bar.appendChild(close);
    document.body.prepend(bar);
  }).catch(() => {});

  // ---------- maintenance ----------
  // While the control room has the site locked, cover the page with a "back soon" screen and check every
  // 30 seconds; reload once it's over. Admins see a thin red bar instead, so they can still check the site.
  // In the 24 hours before scheduled maintenance, a heads-up bar says when it starts.
  const when = (iso, withDay) => new Date(iso).toLocaleString([], withDay
    ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  function bar(id, text, bg, fg) {
    if (document.getElementById(id)) return;
    const el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.style.cssText = `position:sticky;top:0;z-index:60;background:${bg};color:${fg};font:700 14px/1.4 "Bricolage Grotesque",system-ui,sans-serif;padding:8px 16px;text-align:center`;
    el.textContent = text;
    document.body.prepend(el);
    return el;
  }
  function cover(m) {
    if (document.getElementById('pfMaint')) return;
    const box = document.createElement('div');
    box.id = 'pfMaint';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'pfMaintTitle');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 30%,#1b2556,#0b1026 70%);color:#f5f2ff;text-align:center;font-family:"Bricolage Grotesque",system-ui,sans-serif';
    box.innerHTML = '<div style="max-width:460px"><div style="font-size:64px;line-height:1">🔧</div>'
      + '<h1 id="pfMaintTitle" style="font:400 clamp(26px,7vw,40px)/1.1 Bungee,Impact,\'Arial Black\',sans-serif;margin:16px 0 10px;color:#ffd23f">Back soon</h1>'
      + '<p id="pfMaintMsg" style="font-size:18px;margin:0 0 12px"></p><p id="pfMaintUntil" style="color:#a7add8;margin:0"></p>'
      + '<p style="color:#a7add8;font-size:14px;margin-top:22px">This page refreshes by itself when we\'re back.</p></div>';
    box.querySelector('#pfMaintMsg').textContent = m.message;
    box.querySelector('#pfMaintUntil').textContent = m.end ? 'Expected back around ' + when(m.end, !sameDay(m.end, Date.now())) + '.' : '';
    document.body.appendChild(box);
    document.documentElement.style.overflow = 'hidden';
    // Pop-up dialogs draw above everything else on the page, so close any that are open and hide new ones.
    const hide = document.createElement('style');
    hide.textContent = 'dialog,dialog::backdrop{display:none!important}';
    document.head.appendChild(hide);
    document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch (e) {} });
    const check = setInterval(() => {
      fetch('/api/maintenance', { cache: 'no-store' }).then((r) => r.json()).then((n) => {
        if (!n.active) { clearInterval(check); location.reload(); }
      }).catch(() => {});
    }, 30000);
  }
  // Checked on load and every 2 minutes, so a page left open still gets the screen when maintenance starts.
  function checkMaintenance() {
    if (document.getElementById('pfMaint')) return;
    fetch('/api/maintenance', { cache: 'no-store' }).then((r) => r.json()).then((m) => {
    if (m.active && m.bypass) bar('pfMaintBar', '🔧 Maintenance is on. Everyone else sees the "back soon" screen; you can see the site because you\'re an admin.', '#ff5d6c', '#fff');
    else if (m.active) cover(m);
    else if (m.warn) bar('pfMaintWarn', '🔧 Heads up: PhatFrats will be down for maintenance ' + when(m.start, true) + (m.end ? ' to ' + when(m.end, !sameDay(m.start, m.end)) : '') + '.', '#35e0ff', '#0b1026');
    }).catch(() => {});
  }
  checkMaintenance();
  setInterval(() => { if (!document.hidden) checkMaintenance(); }, 120000);

  // ---------- live radar presence ----------
  // The main page sets window.PF_LOOKING to report which party or house is open.
  function ping() {
    if (document.hidden) return;
    const looking = typeof window.PF_LOOKING === 'function' ? window.PF_LOOKING() : null;
    fetch('/api/hit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ v: visitor(), ping: true, path: location.pathname, looking }),
    }).catch(() => {});
  }
  window.PF_PING = ping;
  setTimeout(ping, 1500);
  // Every minute and a half is enough for the radar, and the server ignores it unless the radar is open.
  setInterval(ping, 90000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
})();
