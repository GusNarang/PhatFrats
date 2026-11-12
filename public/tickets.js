// Ticketed events on the main site: the Get ticket button, the buyer's terms before paying,
// the ticket code after, and coming back from Stripe. index.html shares its state as window.PFSite.
(function () {
  const S = () => window.PFSite;
  const esc = (s) => S().esc(s);
  const money = (c) => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  let mine = new Map();

  const css = document.createElement('style');
  css.textContent = `
  .tk-box{border:1px solid rgba(157,255,74,.45);border-radius:14px;padding:12px 14px;background:rgba(157,255,74,.06)}
  .tk-box .tk-code{font:700 1.6rem var(--mono);letter-spacing:.18em;color:var(--lime,#9dff4a);margin:6px 0}
  .tk-fine{font-size:.78rem;color:var(--muted);line-height:1.45;margin:8px 0 0}
  .tk-list{margin:8px 0 0;padding-left:20px;color:var(--muted);line-height:1.5;font-size:.92rem}
  .tk-agree{display:flex;gap:10px;align-items:flex-start;margin:14px 0 4px;font-weight:700;line-height:1.4}
  .tk-agree input{width:20px;height:20px;margin-top:2px;flex:none}`;
  document.head.appendChild(css);

  async function loadMine() {
    if (!S() || !S().state.user) { mine = new Map(); return; }
    try {
      const r = await S().api('/api/tickets/mine');
      mine = new Map(r.tickets.filter((t) => t.status !== 'refunded').map((t) => [t.partyId, t]));
    } catch (e) { /* keep what we had */ }
  }

  const chapterOf = (p) => (S().byId[p.ch] || {}).name || 'the chapter';

  function button(p, cls) {
    const t = mine.get(p.id);
    if (t) return '<span class="status-pill st-approved">🎟️ You have a ticket</span>';
    if (p.ticketsLeft <= 0) return '<span class="status-pill st-waitlist">Sold out</span>';
    return '<button class="btn ' + (cls || '') + '" type="button" data-ticket="' + esc(p.id) + '">Get ticket · ' + money(p.price) + '</button>';
  }

  function detail(p) {
    if (!p.ticketed) return '';
    const t = mine.get(p.id);
    const what = p.ticketKind === 'philanthropy' ? 'Philanthropy event' + (p.cause ? ' benefiting <b>' + esc(p.cause) + '</b>' : '') : 'Alcohol-free event';
    return '<div class="tk-box"><b>🎟️ Ticketed: ' + money(p.price) + '</b> · ' + what + '. Sold by ' + esc(chapterOf(p)) + '.' +
      (t ? '<div>Your ticket code</div><div class="tk-code">' + esc(t.code) + '</div><div class="muted" style="font-size:.9rem">' + (t.status === 'used' ? 'Checked in. Have fun!' : 'Show this code and your Penn State ID at the door. It works once.') + '</div>'
         : '<div class="muted" style="font-size:.9rem;margin-top:4px">' + (p.ticketsLeft > 0 ? p.ticketsLeft + ' left. Your ticket is your spot on the list, no request needed.' : 'Sold out.') + '</div>') +
      '<p class="tk-fine">' + esc(chapterOf(p)) + ' runs this event and is responsible for it. PhatFrats is only the ticketing platform. <a href="/about#ticket-terms" target="_blank" rel="noopener">Ticket terms</a></p></div>';
  }

  function openBuy(p) {
    let dlg = document.getElementById('tkBuy');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'tkBuy'; dlg.style.maxWidth = '540px'; document.body.appendChild(dlg); }
    const seller = chapterOf(p);
    dlg.innerHTML = `<div class="dlg" style="max-height:84vh;overflow:auto">
      <span class="eyebrow">Ticket</span>
      <h3>${esc(p.title)} · ${money(p.price)}</h3>
      <p class="muted" style="margin:4px 0 0">${p.ticketKind === 'philanthropy' ? 'Philanthropy event' + (p.cause ? ' benefiting ' + esc(p.cause) : '') : 'Alcohol-free event'}. Sold by ${esc(seller)}.</p>
      <ul class="tk-list">
        <li><b>${esc(seller)} is the seller and runs the event.</b> It's responsible for the event, its safety and anything that happens there. PhatFrats is only the ticketing platform.</li>
        <li>One ticket per person, for you only. Bring your Penn State ID. The chapter can refuse entry under its own rules or the law.</li>
        <li><b>Refunds:</b> if the event is cancelled on PhatFrats, you're refunded automatically. Otherwise, ask ${esc(seller)}; tickets are non-refundable unless the chapter agrees.</li>
        <li>You attend at your own risk. PhatFrats isn't responsible for the event, injuries, lost property or the chapter's conduct.</li>
        <li>Payment is handled securely by Stripe. Your card statement shows the chapter.</li>
      </ul>
      <label class="tk-agree"><input type="checkbox" id="tkBuyAgree"><span>I've read and agree to the <a href="/about#ticket-terms" target="_blank" rel="noopener">PhatFrats Ticket Terms</a>.</span></label>
      <div id="tkBuyMsg" role="alert" style="color:#ffd0d5;font-weight:700"></div>
      <div class="dlg-actions"><button class="btn ghost" type="button" data-tk-cancel>Cancel</button><button class="btn" type="button" id="tkBuyGo">Pay ${money(p.price)} with Stripe</button></div>
    </div>`;
    dlg.querySelector('[data-tk-cancel]').onclick = () => dlg.close();
    dlg.querySelector('#tkBuyGo').onclick = async (e) => {
      const msg = dlg.querySelector('#tkBuyMsg');
      if (!dlg.querySelector('#tkBuyAgree').checked) { msg.textContent = 'Check the box to accept the ticket terms first.'; return; }
      e.target.disabled = true; msg.textContent = '';
      try { const r = await S().api('/api/tickets/checkout', { partyId: p.id, agree: true }); location.href = r.url; }
      catch (err) { msg.textContent = err.message; e.target.disabled = false; }
    };
    if (!dlg.open) dlg.showModal();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ticket]');
    if (!b || !S()) return;
    e.preventDefault(); e.stopPropagation();
    if (!S().state.user) { S().openLogin(); return; }
    const p = S().party && S().party(b.dataset.ticket);
    if (p) openBuy(p);
  }, true);

  async function start() {
    await loadMine();
    // Coming back from Stripe after paying.
    const q = new URLSearchParams(location.search);
    if (q.get('ticket') === 'success' && q.get('session_id') && S().state.user) {
      try {
        const r = await S().api('/api/tickets/confirm', { sessionId: q.get('session_id'), partyId: q.get('party') });
        mine.set(r.ticket.partyId, r.ticket);
        S().toast('🎟️ You have a ticket! Your code: ' + r.ticket.code, 8000);
        if (S().party && S().party(r.ticket.partyId)) S().select({ type: 'party', id: r.ticket.partyId }, true);
      } catch (err) { S().toast(err.message, 8000); }
      history.replaceState(null, '', location.pathname + location.hash);
    }
    S().renderAll();
  }

  window.PFTickets = { button, detail, start, reload: () => loadMine().then(() => S().renderAll()) };
})();
