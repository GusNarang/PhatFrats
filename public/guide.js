// The site guide: every PhatFrats feature explained in plain words, in one pop-up anyone can open.
// Opened by any [data-guide] button (the hero button, the menu link and the floating "Site guide" pill),
// or by visiting /#guide or /?guide=1.
(function () {
  const P = window.PF_PRICING;
  const price = P ? P.money(P.current()) : '$4.99';
  const term = P ? P.term : 'semester';

  const css = document.createElement('style');
  css.textContent = `
  .guide-fab{position:fixed;left:max(16px,env(safe-area-inset-left,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;display:flex;align-items:center;gap:8px;
    font:800 .95rem var(--body);color:#241a00;background:var(--gold);border:0;border-radius:999px;padding:12px 18px;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.45),0 0 0 2px rgba(255,210,63,.35)}
  .guide-fab:hover{transform:translateY(-2px)}
  .guide-fab:focus-visible{outline:3px solid var(--cyan);outline-offset:3px}
  @media (max-width:520px){.guide-fab{padding:0;width:46px;height:46px;justify-content:center;font-size:1.25rem}.guide-fab .g-fab-label{display:none}}
  .guide-fab{transition:opacity .2s,transform .2s}
  .guide-fab.away{opacity:0;transform:translateY(12px);pointer-events:none}
  nav.links a.guide-link{color:var(--gold)}
  #pfGuide{width:min(760px,calc(100vw - 24px))}
  #pfGuide .g-wrap{display:flex;flex-direction:column;max-height:88vh}
  #pfGuide .g-top{padding:22px 24px 12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
  #pfGuide .g-top h3{font-family:var(--display);font-weight:400;font-size:1.6rem;line-height:1.05;margin:0}
  #pfGuide .g-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  #pfGuide .g-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
  #pfGuide .g-chips::-webkit-scrollbar{display:none}
  #pfGuide .g-chips a{flex:0 0 auto;font:700 .8rem var(--body);color:var(--ink);text-decoration:none;background:var(--night-3);border:1px solid var(--line);border-radius:999px;padding:6px 11px;white-space:nowrap}
  #pfGuide .g-chips a:hover{border-color:var(--gold)}
  #pfGuide .g-search{width:100%}
  #pfGuide .g-body{overflow:auto;padding:14px 24px 24px;display:flex;flex-direction:column;gap:10px}
  #pfGuide details{background:var(--night);border:1px solid var(--line);border-radius:14px;padding:0 14px}
  #pfGuide details[open]{border-color:rgba(255,210,63,.5)}
  #pfGuide summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;padding:13px 0;font-weight:800;font-size:1rem}
  #pfGuide summary::-webkit-details-marker{display:none}
  #pfGuide summary .g-ico{font-size:1.35rem;width:30px;text-align:center;flex:0 0 auto}
  #pfGuide summary .g-sub{display:block;font-weight:500;font-size:.82rem;color:var(--muted)}
  #pfGuide summary::after{content:"+";margin-left:auto;font:700 1.2rem var(--mono);color:var(--muted)}
  #pfGuide details[open] summary::after{content:"–"}
  #pfGuide .g-text{padding:0 0 14px 40px;color:var(--ink);line-height:1.55;font-size:.94rem}
  #pfGuide .g-text p{margin:0 0 8px}
  #pfGuide .g-text ul,#pfGuide .g-text ol{margin:0 0 8px;padding-left:20px}
  #pfGuide .g-text li{margin:3px 0}
  #pfGuide .g-tip{background:rgba(53,224,255,.1);border-left:3px solid var(--cyan);border-radius:8px;padding:8px 10px;font-size:.88rem;margin:6px 0 4px}
  #pfGuide .g-empty{color:var(--muted);text-align:center;padding:18px}
  #pfGuide .g-group{font:700 .72rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gold);margin:8px 0 0}
  @media (max-width:520px){#pfGuide .g-top{padding:18px 16px 10px}#pfGuide .g-body{padding:12px 14px 20px}#pfGuide .g-text{padding-left:0}}
  `;
  document.head.appendChild(css);

  const tip = (t) => `<div class="g-tip">💡 ${t}</div>`;
  // [group, id, icon, title, subtitle, html]
  const SECTIONS = [
    ['Start here', 'start', '🚀', 'Getting started', 'Make an account in about a minute', `
      <ol><li>Tap <b>Log in</b> at the top, then <b>Sign up</b>.</li>
      <li>Use your <b>Penn State email</b> (the one ending in @psu.edu) and pick a password.</li>
      <li>We email you a <b>6-digit code</b>. Type it in to confirm it's really you. Codes last 15 minutes, and you can ask for a new one.</li>
      <li>That's it. The party map and this week's parties unlock.</li></ol>
      ${tip('Forgot your password? Tap Log in, then "Forgot password?" and we\'ll email you a code to reset it.')}
      <p>You don't need an account to browse the list of all 34 fraternity houses or to play Door Rush for practice.</p>`],
    ['Start here', 'map', '🗺️', 'The party map', 'Find what\'s happening this weekend', `
      <p>The map shows every fraternity house around State College. Houses with a party this week <b>glow</b>.</p>
      <ul><li><b>Tap a glowing house</b> to see the party: theme, day and start time, dress code and music.</li>
      <li>The <b>hype meter</b> shows how full the party is getting. When it's nearly full, spots go fast.</li>
      <li>Use the <b>night</b> and <b>vibe</b> filters (Neon, Costume, Daytime, Chill, Dress up, Philanthropy) to narrow it down.</li>
      <li>Scroll down to <b>This week's parties</b> to see them all as cards instead.</li>
      <li>Tap <b>☆ Follow this house</b> on any house to get alerts when it posts a party.</li></ul>`],
    ['Start here', 'invite', '🎟️', 'Getting on the list', 'How invites work', `
      <ol><li>Open a party and tap <b>Request invite</b>.</li>
      <li>The fraternity sees your request and decides. You'll be <b>approved</b> ("you're on the list") or <b>waitlisted</b> if it's packed.</li>
      <li>You get a notification in the 🔔 bell as soon as they answer, and an email when you're approved.</li>
      <li>At the door, bring your <b>Penn State ID</b>.</li></ol>
      <p>Your invite is just for you. Friends coming along each request their own.</p>
      ${tip('A brother can also put you on the list directly by your email. Those invites are free and don\'t use your weekly invite.')}`],
    ['Start here', 'passes', '💎', 'Free vs Full Access', 'What you get, and what it costs', `
      <p><b>🎉 Your first weekend is free:</b> new accounts get Full Access through their first Sunday night.</p>
      <p><b>Free account:</b> see the whole map and every party, and request an invite to <b>one party per week</b>. Your free invite comes back every <b>Monday at midnight</b>. Need more? <b>Earn extra invites</b>: +1 for every friend who joins with your link, and +1 for finishing top 10 in Door Rush. Extra invites are saved until you use them.</p>
      <p><b>Full Access (${price} a ${term}):</b></p>
      <ul><li><b>Unlimited</b> invite requests.</li>
      <li>Your requests go to the <b>front of the line</b> with hosts.</li>
      <li><b>PhatBot</b>, the AI party guide.</li>
      <li>💎 <b>Early access</b>: when a house posts a new party, you see it and can request it <b>24 hours before everyone else</b>.</li>
      <li>⭐ <b>Instant alerts</b> the moment a house you follow posts a party.</li>
      <li>A <b>gold ring</b> around your initials, a <b>💎</b> by your name for friends and on leaderboards, and <b>Door Rush skins</b> (looks only).</li></ul>
      <p>It's <b>one payment with no auto-renew</b>, and it lasts until the end of the term. Pay securely by card from the <b>Passes</b> section. Have a promo code? Enter it at checkout.</p>
      ${tip('You can get Full Access free: bring 3 friends, or win the weekly Door Rush prize. See "Free semester" and "Door Rush" below.')}`],

    ['With friends', 'friends', '👯', 'Friends', 'See where your friends are going', `
      <p>Tap the <b>👯 button</b> at the top. Friends mode is free for everyone.</p>
      <ul><li><b>Add friends</b> by their Penn State email, by sending your <b>friend link</b>, or from "People you may know". They have to accept before you're friends.</li>
      <li>On any party, tap <b>"👀 I'm going"</b> to show your friends. Tap it again to hide it.</li>
      <li>The <b>This weekend</b> tab shows which parties your friends are going to. Party cards show a 👯 number too.</li>
      <li>Tap <b>Profile</b> on a friend to see their plans, streak, badges, Door Rush scores, favorite house and friends you have in common.</li>
      <li>The <b>Leaderboard</b> tab ranks you and your friends in Door Rush this week.</li>
      <li>On a party, <b>"📨 Invite friends"</b> sends your friends a link to come with you.</li></ul>
      ${tip('Friends never see your location, only the parties you choose to show. Your plans disappear after the party.')}`],
    ['With friends', 'groups', '📸', 'Group plans and sharing', 'Go together and hype it up', `
      <ul><li><b>👯 Going with friends?</b> on a party makes a group link. Send it to your group chat. Everyone who opens it joins your group and requests their own invite, and you can see who already asked (✓).</li>
      <li><b>📸 Share</b> makes a story-sized picture of the party for Instagram or Snapchat, with a link back to it.</li></ul>`],
    ['With friends', 'free', '🎁', 'Free semester: bring 3 friends', 'Invite friends, get Full Access free', `
      <p>Tap your <b>initials</b> at the top to open your profile and copy your <b>invite link</b>.</p>
      <p><b>Every friend</b> who signs up with it and confirms their Penn State email earns you <b>an extra invite</b>. When <b>3 friends</b> have joined, you also get Full Access free for the rest of the term. It all happens automatically, with a notification.</p>
      <p>Your profile shows how many friends have joined so far. Your friend link counts too.</p>`],

    ['Your account', 'bell', '🔔', 'Saved parties and the bell', 'Never miss a party', `
      <ul><li>Tap <b>♡</b> on a party to <b>save</b> it. If it starts filling up and you haven't requested yet, we'll warn you.</li>
      <li>The <b>🔔 bell</b> collects everything: approvals, friend requests, prizes, the Weekend Drop and "your friends are going" alerts.</li>
      <li>Important ones are emailed too. Turn emails off any time in your profile under <b>Settings</b>.</li></ul>`],
    ['Your account', 'profile', '🏅', 'Your profile, streaks and badges', 'Tap your initials at the top', `
      <p>Your profile shows your saved parties, your invite link and your <b>badges</b>:</p>
      <ul><li>🔥 <b>Weekend streak</b>: request an invite on several weekends in a row.</li>
      <li>🥇 <b>First on the list</b>: be the first person approved at a party.</li>
      <li>🎉 <b>Party regular</b>: 5 approved invites.</li>
      <li>🕹️ <b>Door Rush champion</b>: win the weekly prize.</li>
      <li>🤝 <b>Connector</b>: bring 3 friends to PhatFrats.</li>
      <li>💎 <b>Full Access</b> and 🌱 <b>Founding member</b> (joined in the first semester).</li></ul>`],
    ['Your account', 'guests', '🧑‍🤝‍🧑', 'Bringing someone from outside Penn State', 'Only at parties that allow it', `
      <p>Some parties let each person on the list bring <b>one outside guest</b> (someone who isn't a Penn State student). You'll see "Outside guests: Allowed" on the party.</p>
      <ul><li>Once you're on the list, add your guest's <b>name</b> and an <b>email or phone number</b>.</li>
      <li>The house approves them, and you get a notification.</li>
      <li>Your guest's details are deleted two days after the party.</li></ul>`],

    ['Fun extras', 'game', '🕹️', 'Door Rush and the weekly prize', 'Play free, win a free semester', `
      <p><b>Door Rush</b> is the PhatFrats game. Open it from <b>Game</b> in the menu.</p>
      <ul><li>Guests walk up the street. Send each to the right party before they reach the red line: <b>★ → Neon</b>, <b>● → Chill</b>, <b>◆ → Costume</b>.</li>
      <li>Hooded crashers with a red ✕: hit <b>Bounce</b>.</li>
      <li>3 mistakes and the doors close. Streaks, 👑 VIPs and the Hype meter boost your score.</li></ul>
      <p><b>The prizes:</b> each week (Monday to Sunday) the <b>top score wins Full Access free</b> through the end of next term, and <b>places 2 to 10 each earn an extra invite</b>. They're given automatically every Monday.</p>
      ${tip('Anyone can play for practice. Log in to save your scores and compete for the prize.')}`],
    ['Fun extras', 'drop', '🔥', 'The Weekend Drop', 'New lineup every Thursday', `
      <p>Every <b>Thursday at 6 PM</b>, the weekend's lineup drops. The countdown on the homepage tells you how long is left.</p>
      <p>When there's big news, we send it to everyone's 🔔 and email.</p>`],
    ['Fun extras', 'bot', '🤖', 'PhatBot, the AI party guide', 'A Full Access perk', `
      <p>Tap the <b>PhatBot</b> bubble in the bottom-right corner and ask anything: "What's the chillest party Friday?", "What should I wear to the neon one?", "Which houses are close to East Halls?"</p>
      <p>PhatBot comes with Full Access, up to 60 messages a day.</p>`],
    ['Fun extras', 'app', '📲', 'Put PhatFrats on your home screen', 'Open it like an app', `
      <ul><li><b>iPhone:</b> in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</li>
      <li><b>Android:</b> tap <b>Get the app</b> on the homepage, or your browser's menu, then <b>Install</b>.</li></ul>`],

    ['Stay safe', 'safety', '🛟', 'The Party Smart kit', 'Quick tools for a safe night', `
      <p>Scroll to <b>Party smart</b> on the homepage for one-tap tools:</p>
      <ul><li>🚨 <b>Call 911</b> and 🚓 <b>Penn State Police</b>.</li>
      <li>📍 <b>Share my location</b> with a friend, and 🏠 <b>"I'm home safe"</b>.</li>
      <li>⏰ <b>Check-in reminder</b> to message your friends after a set time.</li>
      <li>🚩 <b>Report something</b> privately to the PhatFrats team.</li></ul>
      ${tip('If anyone is in danger, call 911 first. Penn State\'s Responsible Action protocol is there so people get help.')}`],
    ['Stay safe', 'privacy', '🔒', 'Your privacy', 'What others can and can\'t see', `
      <ul><li>Nobody sees your email. Leaderboards show first names and last initials only.</li>
      <li>Friends see only the parties you mark "I'm going". Never your live location.</li>
      <li><b>Ghost mode</b> (in 👯 → Privacy) hides you from friends for the weekend or until you turn it off.</li>
      <li>Removing or blocking someone is quiet. They aren't told.</li>
      <li>Some houses keep their crowd private, so nobody's plans for that party show.</li></ul>`],

    ['More', 'frats', '🏛️', 'For fraternities', 'Brothers and chapter leaders', `
      <p>In a fraternity? Open <a href="/frats" style="color:var(--gold)">For frats</a> in the menu.</p>
      <ul><li><b>Brothers</b> join their chapter with the chapter password and can put friends on the list by email.</li>
      <li><b>Chapter leaders</b> sign in with the leader password to post parties, approve or waitlist requests, choose whether outside guests are allowed, and manage members.</li>
      <li>Each chapter has its own page with its colors and story.</li></ul>`],
    ['More', 'faq', '❓', 'Quick answers', 'Common questions', `
      <p><b>Do I need a Penn State email?</b> Yes. That keeps PhatFrats just for students.</p>
      <p><b>When does my free invite come back?</b> Every Monday at midnight. Used it already? Earn an extra one by bringing a friend or finishing top 10 in Door Rush.</p>
      <p><b>Does Full Access renew by itself?</b> No. It's one payment, and it ends with the term.</p>
      <p><b>I didn't get my code.</b> Check spam, then ask for a new one (once a minute).</p>
      <p><b>Something's wrong or I have an idea.</b> Use the contact form on the <a href="/about" style="color:var(--cyan)">About page</a>.</p>`],
  ];

  function dialog() {
    let d = document.getElementById('pfGuide');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'pfGuide';
    d.setAttribute('aria-labelledby', 'pfGuideTitle');
    let lastGroup = '';
    const body = SECTIONS.map(([group, id, icon, title, sub, html]) => {
      const head = group !== lastGroup ? `<p class="g-group">${group}</p>` : '';
      lastGroup = group;
      return `${head}<details id="g-${id}" data-title="${(title + ' ' + sub).toLowerCase().replace(/"/g, '')}" data-text="${(title + ' ' + sub + ' ' + html.replace(/<[^>]+>/g, ' ')).toLowerCase().replace(/"/g, '')}">
        <summary><span class="g-ico" aria-hidden="true">${icon}</span><span>${title}<span class="g-sub">${sub}</span></span></summary>
        <div class="g-text">${html}</div></details>`;
    }).join('');
    d.innerHTML = `<div class="g-wrap">
      <div class="g-top">
        <div class="g-row"><div><span class="eyebrow">Site guide</span><h3 id="pfGuideTitle">How PhatFrats works</h3>
          <p class="muted" style="margin:6px 0 0;font-size:.92rem">Everything on the site, in plain words. Tap a topic to open it.</p></div>
          <button class="btn ghost small" type="button" data-guide-close>Close</button></div>
        <input class="input g-search" type="search" placeholder="Search the guide, like &quot;invite&quot; or &quot;friends&quot;" aria-label="Search the guide">
        <nav class="g-chips" aria-label="Guide topics">${SECTIONS.map(([, id, icon, title]) => `<a href="#g-${id}" data-guide-jump="${id}">${icon} ${title}</a>`).join('')}</nav>
      </div>
      <div class="g-body">${body}<p class="g-empty" hidden>Nothing matches. Try another word, or ask us on the <a href="/about" style="color:var(--cyan)">About page</a>.</p></div>
    </div>`;
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelector('[data-guide-close]').addEventListener('click', () => d.close());
    d.querySelector('.g-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      let shown = 0;
      const all = [...d.querySelectorAll('.g-body details')];
      // Topics named after the search open first; otherwise the first couple that mention it.
      const titled = q ? all.filter((x) => x.dataset.title.includes(q)) : [];
      all.forEach((x) => {
        const hit = !q || x.dataset.text.includes(q);
        x.hidden = !hit; if (hit) shown++;
        x.open = !!q && hit && (titled.length ? titled.includes(x) : shown <= 2);
      });
      const firstOpen = all.find((x) => x.open);
      if (firstOpen) firstOpen.scrollIntoView({ block: 'nearest' });
      d.querySelectorAll('.g-group').forEach((g) => { g.hidden = !!q; });
      d.querySelector('.g-empty').hidden = shown > 0;
    });
    d.querySelectorAll('[data-guide-jump]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const x = d.querySelector('#g-' + a.dataset.guideJump);
      x.hidden = false; x.open = true;
      x.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.body.appendChild(d);
    return d;
  }
  function open(topic) {
    const d = dialog();
    if (!d.open) d.showModal();
    const first = d.querySelector('#g-' + (topic || 'start'));
    if (first) { first.open = true; if (topic) first.scrollIntoView({ block: 'start' }); }
  }

  // The floating button, always in reach.
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'guide-fab'; fab.setAttribute('data-guide', '');
  fab.setAttribute('aria-label', 'Open the site guide: how PhatFrats works');
  fab.innerHTML = '<span aria-hidden="true">📖</span><span class="g-fab-label">Site guide</span>';
  document.body.appendChild(fab);
  // No need for two guide buttons on screen at once: it steps aside while the hero's button is visible.
  const heroBtn = document.getElementById('heroGuide');
  if (heroBtn && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => fab.classList.toggle('away', e.isIntersecting)).observe(heroBtn);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-guide]');
    if (b) { e.preventDefault(); open(b.dataset.guide || ''); }
  });
  const fromUrl = () => location.hash === '#guide' || new URLSearchParams(location.search).get('guide');
  if (fromUrl()) setTimeout(() => open(), 300);
  window.addEventListener('hashchange', () => { if (location.hash === '#guide') open(); });

  window.PFGuide = { open };
})();
