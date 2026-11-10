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
  setInterval(ping, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
})();
