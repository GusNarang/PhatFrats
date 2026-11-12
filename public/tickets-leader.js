// Ticketed events on the chapter page (/frats): connecting payouts, selling tickets for an event,
// seeing who bought one, and checking tickets at the door. Only shows while the site admin has
// ticketing switched on. The page shares its state and helpers as window.PFChapter.
(function () {
  const C = () => window.PFChapter;
  const esc = (s) => C().esc(s);
  const $ = (s) => document.querySelector(s);
  const money = (c) => '$' + (c / 100).toFixed(2).replace(/\.00$/, '');
  let info = null;

  const css = document.createElement('style');
  css.textContent = `
  .tk-dlg{max-width:560px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:18px;background:var(--night-2,#141a3a);color:var(--ink);padding:0}
  .tk-dlg::backdrop{background:rgba(5,8,20,.7)}
  .tk-dlg .in{padding:20px;max-height:84vh;overflow:auto}
  .tk-dlg h2{margin:0 0 8px}
  .tk-terms{font-size:.9rem;color:var(--muted);line-height:1.5;border:1px solid var(--line);border-radius:12px;padding:12px 14px;max-height:280px;overflow:auto;background:rgba(0,0,0,.18)}
  .tk-terms ol{margin:6px 0 0;padding-left:20px}.tk-terms li{margin-bottom:6px}
  .tk-check{display:flex;gap:10px;align-items:flex-start;margin:14px 0;font-weight:600;line-height:1.4}
  .tk-check input{width:20px;height:20px;margin-top:2px;flex:none}
  .tk-door{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .tk-door input{font:700 1.2rem var(--mono);letter-spacing:.12em;text-transform:uppercase;max-width:200px}
  .tk-result{margin-top:10px;font-weight:700}
  .tk-holders{font-size:.9rem;margin-top:10px}.tk-holders div{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding:6px 0}`;
  document.head.appendChild(css);

  function dialog(html) {
    let d = document.getElementById('tkDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'tkDlg'; d.className = 'tk-dlg'; document.body.appendChild(d); }
    d.innerHTML = '<div class="in">' + html + '</div>';
    if (!d.open) d.showModal();
    return d;
  }
  const close = () => { const d = document.getElementById('tkDlg'); if (d && d.open) d.close(); };

  // The chapter agreement, accepted once when connecting payouts (and again if the terms change).
  function agreementHtml() {
    const ch = C().state.data.membership.chapter.name;
    return `<div class="tk-terms"><b>Chapter Ticketing Agreement</b> (version ${esc(info.terms)})
      <p style="margin:6px 0 0">By connecting payouts, you confirm you're an authorized leader of <b>${esc(ch)}</b> and agree for the chapter that:</p>
      <ol>
        <li><b>Your chapter is the seller and organizer.</b> PhatFrats only provides the ticketing tool. Ticket money goes straight to your chapter's own Stripe account; PhatFrats never holds it.</li>
        <li><b>Philanthropy and alcohol-free events only.</b> No alcohol may be served, sold, provided or allowed at a ticketed event, and ticket money may never pay for alcohol. Selling tickets to a party with alcohol is not allowed and can break the law.</li>
        <li><b>You follow the rules.</b> All laws, and all Penn State, IFC and national organization policies, including event registration, capacity, fire code and risk management.</li>
        <li><b>Your chapter is solely responsible for the event:</b> safety, security, guests' conduct, accessibility and anything that happens there.</li>
        <li><b>Buyers' questions, refunds and disputes are the chapter's.</b> Cancelling an event in PhatFrats refunds every ticket automatically. Other refunds follow your chapter's policy. Chargebacks and disputes are handled by your chapter through Stripe.</li>
        <li><b>Money and taxes.</b> Your chapter is responsible for any taxes and reporting on its sales. Money raised for a philanthropy event must go to the cause you name.</li>
        <li><b>Fees.</b> PhatFrats' platform fee is ${esc(info.feePct)}% of each ticket (${esc(info.charityFeePct)}% for philanthropy events), plus Stripe's processing fees. Both are taken out automatically.</li>
        <li><b>You hold PhatFrats harmless.</b> Your chapter agrees to defend and hold harmless PhatFrats and its creator against any claim arising from your events, your ticket sales or a breach of this agreement.</li>
        <li><b>PhatFrats can switch it off.</b> We can turn off ticketing, remove an event or suspend a chapter at any time. If these terms change, you'll be asked to accept them again.</li>
      </ol>
      <p style="margin:6px 0 0">Full terms: <a href="/about#ticket-terms" target="_blank" rel="noopener">phatfrats.vercel.app/about#ticket-terms</a></p></div>`;
  }

  async function fetchInfo() {
    try { info = await C().api('/api/chapter/tickets'); } catch (e) { info = null; }
  }

  function render() {
    fetchInfo().then(() => { drawCard(); C().renderParties(); });
  }

  function drawCard() {
    const box = $('#ticketsCard');
    if (!box) return;
    if (!info || !info.on) { box.innerHTML = ''; return; }
    const leader = C().leader();
    const ticketed = C().state.data.parties.filter((p) => p.ticketed && p.status === 'live' && !p.past);
    let html = '<div class="card"><h2 style="margin-top:0">🎟️ Ticketed events</h2>';
    html += `<p class="muted" style="margin-top:0">Sell tickets for <b>philanthropy</b> and <b>alcohol-free</b> events, like a charity date night, a tournament or a benefit concert. Never for a party with alcohol. Money goes straight to your chapter's Stripe account. PhatFrats' fee: ${esc(info.charityFeePct)}% for philanthropy, ${esc(info.feePct)}% for other alcohol-free events, plus Stripe's processing fee.</p>`;
    if (leader) {
      if (!info.payouts.ready) {
        html += `<div class="btn-row"><button class="btn primary" type="button" data-tk-connect>${info.payouts.connected ? 'Finish payout setup with Stripe' : 'Connect payouts with Stripe'}</button></div>
          <p class="small muted">You'll accept the chapter ticketing agreement, then set up your chapter's own Stripe account (it takes about 5 minutes).</p>`;
      } else {
        html += '<p class="small"><span class="badge live">Payouts connected</span> Use <b>Sell tickets</b> on an upcoming event below.</p>';
      }
    }
    if (ticketed.length) {
      html += `<h3 style="margin:14px 0 6px">Check tickets at the door</h3>
        <form class="tk-door" id="tkDoor" novalidate><label class="sr" for="tkCode">Ticket code</label><input id="tkCode" maxlength="9" autocomplete="off" placeholder="ABCD2345" inputmode="text"><button class="btn primary" type="submit">Check ticket</button></form>
        <div class="tk-result" id="tkResult" role="status" aria-live="polite"></div>
        <p class="small muted">Also check their Penn State ID. Each code works once.</p>`;
    }
    box.innerHTML = html + '</div>';
  }

  function badge(p) {
    if (!p.ticketed) return '';
    const s = info && info.parties[p.id];
    const kind = p.ticketKind === 'philanthropy' ? 'Philanthropy' + (p.cause ? ': ' + p.cause : '') : 'Alcohol-free';
    return '<p class="small" style="margin:4px 0"><span class="badge guests">🎟️ ' + money(p.price) + ' tickets · ' + (s ? s.sold : 0) + ' sold' + (s && s.used ? ' · ' + s.used + ' checked in' : '') + '</span> <span class="badge past">' + esc(kind) + '</span></p>';
  }

  function buttons(p) {
    if (!info || !info.on || !C().leader() || p.past || p.status !== 'live') return [];
    if (!info.payouts.ready && !p.ticketed) return [];
    return ['<button class="btn slim" type="button" data-tk-party="' + p.id + '">' + (p.ticketed ? '🎟️ Tickets' : '🎟️ Sell tickets') + '</button>'];
  }

  function connectDialog() {
    const d = dialog(`<h2>Connect payouts</h2>${agreementHtml()}
      <label class="tk-check"><input type="checkbox" id="tkAgree"> I'm an authorized leader of this chapter, and I accept the Chapter Ticketing Agreement for the chapter.</label>
      <div id="tkMsg" role="alert"></div>
      <div class="btn-row"><button class="btn primary" type="button" id="tkGo">Accept and continue to Stripe</button><button class="btn" type="button" data-tk-close>Cancel</button></div>`);
    d.querySelector('#tkGo').onclick = async (e) => {
      if (!d.querySelector('#tkAgree').checked) { d.querySelector('#tkMsg').innerHTML = '<div class="notice err">Check the box to accept the agreement first.</div>'; return; }
      e.target.disabled = true;
      try { const r = await C().api('/api/chapter/payouts/connect', { agree: true }); location.href = r.url; }
      catch (err) { d.querySelector('#tkMsg').innerHTML = '<div class="notice err">' + esc(err.message) + '</div>'; e.target.disabled = false; }
    };
  }

  function partyDialog(p) {
    const s = (info && info.parties[p.id]) || { sold: 0, holders: [] };
    const ch = C().state.data.membership.chapter.name;
    const holders = s.holders && s.holders.length
      ? '<div class="tk-holders"><b>Ticket holders</b>' + s.holders.map((h) => '<div><span>' + esc(h.name) + '</span><span class="muted">' + (h.status === 'used' ? 'Checked in' : h.status === 'refunded' ? 'Refunded' : 'Paid') + '</span></div>').join('') + '</div>' : '';
    const d = dialog(`<h2>${p.ticketed ? 'Tickets' : 'Sell tickets'}: ${esc(p.title)}</h2>
      <p class="muted" style="margin-top:0">Only for philanthropy or alcohol-free events. ${s.sold ? '<b>' + s.sold + ' sold so far.</b> The price is locked now.' : ''}</p>
      <div class="field"><label for="tkKind">Kind of event</label><select id="tkKind">${Object.entries(info.kinds).map(([k, v]) => '<option value="' + k + '"' + (p.ticketKind === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('')}</select></div>
      <div class="field" id="tkCauseRow"><label for="tkCause">Charity or cause the money goes to</label><input id="tkCause" maxlength="80" value="${esc(p.cause || '')}" placeholder="For example: THON"></div>
      <div class="field"><label for="tkPrice">Ticket price ($1 to $100)</label><input id="tkPrice" type="number" min="1" max="100" step="0.5" inputmode="decimal" value="${p.price ? (p.price / 100) : 10}" ${s.sold ? 'disabled' : ''}></div>
      <label class="tk-check"><input type="checkbox" id="tkAttest"> For ${esc(ch)}, I confirm: this is a philanthropy or alcohol-free event; no alcohol will be served, sold, provided or allowed; it's registered and approved as Penn State, IFC and our national organization require; money from a philanthropy event goes to the cause named; and our chapter is solely responsible for the event and its ticket sales, under the Chapter Ticketing Agreement.</label>
      <div id="tkMsg" role="alert"></div>
      <div class="btn-row"><button class="btn primary" type="button" id="tkSave">${p.ticketed ? 'Save' : 'Start selling tickets'}</button>${p.ticketed && !s.sold ? '<button class="btn danger" type="button" id="tkStop">Stop selling</button>' : ''}<button class="btn" type="button" data-tk-close>Close</button></div>
      ${holders}`);
    const syncCause = () => { d.querySelector('#tkCauseRow').hidden = d.querySelector('#tkKind').value !== 'philanthropy'; };
    d.querySelector('#tkKind').onchange = syncCause; syncCause();
    const msg = (m) => { d.querySelector('#tkMsg').innerHTML = m ? '<div class="notice err">' + esc(m) + '</div>' : ''; };
    d.querySelector('#tkSave').onclick = async (e) => {
      if (!d.querySelector('#tkAttest').checked) { msg('Check the box to confirm the event qualifies.'); return; }
      e.target.disabled = true;
      try {
        await C().api('/api/chapter/parties/' + p.id + '/ticket', { on: true, kind: d.querySelector('#tkKind').value, cause: d.querySelector('#tkCause').value, price: Number(d.querySelector('#tkPrice').value), attest: true });
        close(); C().toast('🎟️ Tickets are on sale. Students see a Get ticket button on the map.'); await C().load();
      } catch (err) { msg(err.message); e.target.disabled = false; }
    };
    const stop = d.querySelector('#tkStop');
    if (stop) stop.onclick = async () => {
      try { await C().api('/api/chapter/parties/' + p.id + '/ticket', { on: false }); close(); C().toast('Ticket sales stopped.'); await C().load(); }
      catch (err) { msg(err.message); }
    };
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-tk-close]')) { close(); return; }
    if (t.closest('[data-tk-connect]')) { connectDialog(); return; }
    const b = t.closest('[data-tk-party]');
    if (b) { const p = C().partyById(b.dataset.tkParty); if (p) partyDialog(p); }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'tkDoor') return;
    e.preventDefault();
    const out = $('#tkResult'), code = $('#tkCode').value;
    out.textContent = 'Checking…'; out.style.color = '';
    try {
      const r = await C().api('/api/chapter/tickets/check', { code });
      if (r.ok) { out.textContent = '✅ Valid: ' + r.name + ' · ' + r.title + '. Checked in.'; out.style.color = 'var(--lime,#9dff4a)'; $('#tkCode').value = ''; }
      else { out.textContent = '⚠️ Already used' + (r.used ? ' at ' + new Date(r.used).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '') + ' (' + r.name + '). Don\'t let it in twice.'; out.style.color = 'var(--gold,#ffd23f)'; }
    } catch (err) { out.textContent = '❌ ' + err.message; out.style.color = 'var(--red,#ff5d6c)'; }
    $('#tkCode').focus();
  });

  // Coming back from Stripe's payout setup.
  const q = new URLSearchParams(location.search).get('payouts');
  if (q) setTimeout(() => { if (C()) C().toast(q === 'done' ? 'Back from Stripe. Payouts switch on as soon as Stripe finishes checking your account.' : 'The Stripe link expired. Press Finish payout setup to try again.'); }, 1200);

  window.PFTicketsLeader = { render, badge, buttons };
})();
