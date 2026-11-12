// Phone numbers on the main site. Invite details and confirmations come by text, so after confirming their
// email, students confirm their mobile number with a texted code. Existing accounts without a confirmed number
// get a gentle prompt once per visit. Uses the main page's helpers (window.PFSite). See sms.js on the server.
(function () {
  const S = () => window.PFSite;
  const esc = (s) => S().esc(s);
  const store = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  const css = document.createElement('style');
  css.textContent = `
  .ph-dlg{max-width:440px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:18px;background:var(--night-2);color:var(--ink);padding:0}
  .ph-dlg::backdrop{background:rgba(5,8,20,.7)}
  .ph-dlg form{padding:22px;display:flex;flex-direction:column;gap:12px}
  .ph-dlg h3{margin:0;font-family:var(--display);font-weight:400;font-size:1.4rem}
  .ph-dlg .fine{font-size:.78rem;color:var(--muted);line-height:1.45;margin:0}
  .ph-nudge{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:55;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;
    background:var(--night-2);border:2px solid var(--cyan);border-radius:16px;padding:10px 14px;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:calc(100% - 24px)}
  .ph-nudge b{font-size:.95rem}`;
  document.head.appendChild(css);

  const CONSENT = 'Text me my invite details and confirmations (about 1 to 10 texts a week). Msg & data rates may apply. Reply STOP to opt out, HELP for help.';

  let dlg = null;
  function build() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'ph-dlg';
    dlg.setAttribute('aria-labelledby', 'phTitle');
    dlg.innerHTML = `<form novalidate>
      <span class="eyebrow">📱 One more step</span>
      <h3 id="phTitle">Get your invites by text</h3>
      <p class="muted" id="phLead" style="margin:0"></p>
      <div id="phStep1">
        <div class="field"><label for="phNum">Mobile number</label><input class="input" id="phNum" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(814) 555-0123"></div>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="phConsent"> <span>${esc(CONSENT)} <a href="/about#texts" target="_blank" rel="noopener">Texting terms</a></span></label>
      </div>
      <div id="phStep2" hidden>
        <div class="field"><label for="phCode">6-digit code</label><input class="input code-input" id="phCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000"></div>
        <button class="btn ghost small" type="button" id="phResend" style="align-self:flex-start">Text me a new code</button>
      </div>
      <p class="err" id="phErr" role="alert"></p>
      <div class="dlg-actions">
        <button class="btn ghost" type="button" id="phLater">Later</button>
        <button class="btn" type="submit" id="phGo">Text me a code</button>
      </div>
      <p class="fine">We only text you about your own invites, tickets and account. We never sell or share your number.</p>
    </form>`;
    document.body.appendChild(dlg);
    const $ = (s) => dlg.querySelector(s);
    $('#phLater').addEventListener('click', () => dlg.close());
    $('#phResend').addEventListener('click', () => sendCode(true));
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!$('#phStep2').hidden) return verify();
      sendCode(false);
    });
    return dlg;
  }
  const $ = (s) => dlg.querySelector(s);
  function step(two) {
    $('#phStep1').hidden = two; $('#phStep2').hidden = !two;
    $('#phGo').textContent = two ? 'Confirm' : 'Text me a code';
    (two ? $('#phCode') : $('#phNum')).focus();
  }
  async function sendCode(resend) {
    const btn = resend ? $('#phResend') : $('#phGo');
    btn.disabled = true; $('#phErr').textContent = '';
    try {
      if (!$('#phConsent').checked) throw new Error('Tick the box to get your invite details and confirmations by text.');
      const r = await S().api('/api/phone', { phone: $('#phNum').value, smsConsent: true });
      Object.assign(S().state.user, pick(r));
      if (r.codeStatus === 'verified') { done(); return; }
      if (r.codeStatus === 'unavailable') {
        dlg.close();
        S().toast("Saved your number. Texts aren't switched on yet, so we'll email you for now.", 6000);
        return;
      }
      $('#phLead').textContent = 'We texted a code to ' + r.phone + '. It expires in 15 minutes.';
      step(true);
    } catch (err) { $('#phErr').textContent = err.message; }
    finally { btn.disabled = false; }
  }
  async function verify() {
    const btn = $('#phGo'); btn.disabled = true; $('#phErr').textContent = '';
    try {
      const r = await S().api('/api/phone/verify', { code: $('#phCode').value });
      Object.assign(S().state.user, pick(r));
      done();
    } catch (err) { $('#phErr').textContent = err.message; }
    finally { btn.disabled = false; }
  }
  const pick = (r) => ({ phone: r.phone, phoneVerified: r.phoneVerified, texts: r.texts, textsReady: r.textsReady });
  function done() {
    dlg.close();
    hideNudge();
    S().toast('📱 Phone confirmed. Your invite details and confirmations now come by text.', 6000);
  }

  // Opens the dialog. Used after sign-up and from the profile.
  function open() {
    const u = S().state.user; if (!u) return;
    build();
    $('#phErr').textContent = ''; $('#phCode').value = '';
    $('#phNum').value = u.phone || '';
    $('#phConsent').checked = !!u.texts || !u.phone;
    $('#phLead').textContent = u.phone
      ? 'Confirm ' + u.phone + ' (or fix it) and we\'ll text you a code. Your invite details and confirmations then come by text instead of email.'
      : 'Add your mobile number and we\'ll text you a code. Your invite details and confirmations then come by text instead of email.';
    step(false);
    if (!dlg.open) dlg.showModal();
  }

  // A once-per-visit prompt for accounts without a confirmed number, while texting is switched on for the site.
  function hideNudge() { const n = document.getElementById('phNudge'); if (n) n.remove(); }
  function nudge() {
    const u = S().state.user;
    if (!u || u.phoneVerified || !u.textsReady || store.get('pf_phone_nudge') || document.querySelector('dialog[open]')) return;
    store.set('pf_phone_nudge', '1');
    const n = document.createElement('div');
    n.id = 'phNudge'; n.className = 'ph-nudge'; n.setAttribute('role', 'status');
    n.innerHTML = `<b>📱 Get your invites by text</b><button class="btn small" type="button" data-ph-open>${u.phone ? 'Confirm my number' : 'Add my number'}</button><button class="btn ghost small" type="button" data-ph-hide aria-label="Not now">Not now</button>`;
    document.body.appendChild(n);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-ph-open]')) { hideNudge(); open(); }
    else if (e.target.closest('[data-ph-hide]')) hideNudge();
  });

  window.PFPhone = { open, nudge, CONSENT };
})();
