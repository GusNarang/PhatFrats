// Full Access perks on the main site: ⭐ follow buttons on houses, the early-access card for free accounts,
// and the gold styling (ring, 💎 and early-access tags). index.html calls PFPremium.followButton and earlyCard.
(function () {
  const S = () => window.PFSite;
  const esc = (s) => S().esc(s);
  let follows = null, loading = false;

  const css = document.createElement('style');
  css.textContent = `
  .gold-ring{box-shadow:0 0 0 2px var(--night),0 0 0 4px var(--gold),0 0 14px rgba(255,210,63,.55)}
  .early-tag{position:absolute;top:-10px;right:12px;font:800 .72rem var(--body);background:var(--gold);color:#241a00;border-radius:999px;padding:3px 10px;box-shadow:0 4px 12px rgba(0,0,0,.4)}
  .party{position:relative}
  .follow-btn{align-self:flex-start;font:800 .85rem var(--body);border-radius:999px;padding:7px 14px;cursor:pointer;border:1.5px solid var(--line);background:transparent;color:var(--ink)}
  .follow-btn[aria-pressed="true"]{border-color:var(--gold);color:var(--gold);background:rgba(255,210,63,.1)}
  .early-card{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;
    background:linear-gradient(120deg,rgba(255,210,63,.16),rgba(255,63,164,.12));border:1.5px solid rgba(255,210,63,.55);border-radius:18px;padding:14px 18px}
  .early-card b{color:var(--gold)}
  `;
  document.head.appendChild(css);

  async function load() {
    if (loading || !S().state.user) return;
    loading = true;
    try { follows = (await S().api('/api/follows')).chapters; S().renderAll(); } catch (e) {} finally { loading = false; }
  }

  // The page draws once before it shares its helpers (window.PFSite), so both of these wait for them.
  function followButton(chId) {
    if (!S()) return '';
    const st = S().state;
    if (!st.user || !follows) return '';
    const on = follows.includes(chId);
    return `<button class="follow-btn" type="button" data-follow="${chId}" aria-pressed="${on}">${on ? '⭐ Following' : '☆ Follow this house'}</button>`;
  }

  // Free accounts: new parties waiting in Full Access early access.
  function earlyCard() {
    if (!S()) return '';
    const st = S().state;
    if (!st.user || st.user.plan === 'full' || !st.early || !st.early.count) return '';
    const left = Math.max(0, new Date(st.early.nextAt).getTime() - Date.now());
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
    const n = st.early.count;
    return `<div class="early-card" role="note"><span>💎 <b>${n} new part${n === 1 ? 'y' : 'ies'}</b> just dropped in Full Access early access. Members can see and request ${n === 1 ? 'it' : 'them'} now. ${n === 1 ? 'It opens' : 'The first opens'} to you in <b>${h ? h + 'h ' : ''}${m}m</b>.</span>
      <a class="btn gold small" href="#plans" data-plans>See it first with Full Access</a></div>`;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-follow]');
    if (!b) return;
    e.preventDefault();
    const id = Number(b.dataset.follow), on = b.getAttribute('aria-pressed') !== 'true';
    try {
      follows = (await S().api('/api/follows', { chapterId: id, on })).chapters;
      S().renderAll();
      const full = S().state.user.plan === 'full';
      S().toast(!on ? 'Unfollowed.' : full ? "⭐ Following. You'll get an alert the moment they post a party." : "⭐ Following. You'll hear when their parties open to you. Full Access gets alerted the instant they post.", 6000);
    } catch (err) { S().toast(err.message); }
  });

  function start() {
    // Load follows once someone is logged in (the account arrives after the page).
    const auth = document.getElementById('authArea');
    const kick = () => { if (S().state.user && !follows) load(); if (!S().state.user) follows = null; };
    if (auth) new MutationObserver(kick).observe(auth, { childList: true });
    kick();
  }

  window.PFPremium = { start, followButton, earlyCard };
})();
