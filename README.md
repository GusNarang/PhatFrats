# PhatFrats

A party finder for Penn State students, built by **Agastya Narang**.

Create an account with a Penn State email and get a map of every Interfraternity Council house around State College, with this week's parties lit up. Click a house to see the theme, time, dress code and how full it's getting, then request an invite right from the page. A directory of all 34 IFC chapters, with addresses and Instagram handles, is open to everyone.

## Passes

| | Free | Full Access ($4.99 per semester) |
|---|---|---|
| See the map and party details | Yes | Yes |
| Invite requests | One party per week | Unlimited |
| Place in the host's line | Normal | Front of the line |
| PhatBot, the AI party guide | No | Yes |

**Free boosts.** New accounts get Full Access free through their first Sunday night (`users.trial_until`, set once when the email is confirmed; it never changes `plan`, so it doesn't count as a paid pass). Free accounts earn extra invites (`users.bonus_invites`, up to 10 saved): +1 for each friend who joins with their link and confirms, and +1 for places 2 to 10 in the weekly Door Rush (handed out with the Monday prize). Extras are used after the weekly free invite. When a free account is out of invites, tapping a party opens a pop-up explaining how to earn another. Logged-out visitors see a teaser from `/api/teaser`: how many parties, which nights, vibes and how full, with no names or houses.


The free invite resets every Monday at midnight Eastern. Full Access is one payment per semester with no auto-renew. The price and an optional launch deal live in `public/pricing.js`; set `launch.ends` to a date to switch the deal on. Checkout isn't built yet, so accounts are Free unless set by hand. Only a confirmed payment should ever set `plan = 'full'`.

## Email confirmation

New accounts get a 6-digit code by email and must enter it before they can see the map or request invites. Codes expire after 15 minutes and allow 5 tries. A new code can be sent once a minute, up to 5 per hour.

Forgotten passwords work the same way: **Forgot password?** on the log-in screen emails a reset code with the same limits. Setting a new password logs the account out on every other device.

Set the `SMTP_*` values from `.env.example` to send email.

## PhatBot

PhatBot is an AI chat for Full Access accounts with a confirmed email. It knows this week's parties, every IFC chapter in the directory, and the person's own plan and invite requests, and helps both students and chapter members planning events. It can't send or manage invites yet.

- Runs on Claude through the Anthropic API (`ai.js`). Set `ANTHROPIC_API_KEY` to turn it on; without it the chat button stays hidden.
- Uses Claude Haiku 5.5 at low effort by default, which keeps each message to a fraction of a cent. `PHATBOT_MODEL` and `PHATBOT_EFFORT` change that.
- Each Full Access account gets 60 messages a day (`chat_usage` table), plus at most 10 a minute. Free accounts don't see the chat.
- Conversations aren't stored. The page keeps them until it's reloaded. Without `SMTP_HOST`, a local run prints the code in the terminal instead.

## Run it

You need Node.js 22 or newer and a [Neon](https://neon.tech) database.

1. Copy `.env.example` to `.env` and add your Neon connection string.
2. Install and set up:

   ```bash
   npm install
   ```

   ```bash
   npm run db:setup
   ```

3. Start the site, then open http://localhost:3000:

   ```bash
   npm start
   ```

## How it's put together

- `server.js`: the Express server, with sign-up, log-in, log-out, sessions and invite requests
- `ai.js`: PhatBot's instructions and the call to Claude
- `public/chapters.js`: the 34 IFC chapters, shared by the page and PhatBot
- `db/schema.sql`: the `users`, `email_codes`, `password_reset_codes`, `sessions`, `invite_requests` and `chat_usage` tables
- `data/parties.js`: the party list, sent only to logged-in accounts with a confirmed email
- `public/`: the site itself (`index.html` and map data)
- `tools/map/`: the scripts that generated the map data
- `archive/`: the earlier single-file demo, which has no accounts

Passwords are hashed with scrypt and sessions last 30 days in an HttpOnly cookie. The weekly invite limit and email confirmation are enforced on the server.

**Never commit or upload `.env`.** It holds your database password.

## Notes

- Chapter names and addresses come from [pennstateifc.org/chapters](https://www.pennstateifc.org/chapters).
- Every party and host approval is fictional demo data.
- The street map uses data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors). House pins come from geocoding each IFC address.
- Not affiliated with Penn State University or the Interfraternity Council.

## Control room

The control room is hidden. A logged-in admin opens it by pressing Shift, Caps Lock, P, P, L, G, U, S one after another, then entering the admin password. It shows visitors, sign-ups, invite requests, PhatBot use, estimated money and every account. From there they can ban or unban accounts and switch Full Access on or off by hand.

- A banned account is logged out everywhere and can't log back in or reset its password. Admins can't be banned.
- For anyone else the keys do nothing, and `/admin` shows a 404 page. The password works for one visit: leaving or reloading the control room, or opening the main site, locks it again.
- Only a hash of the admin password is stored, in `users.admin_password_hash`. To change it: `$env:ADMIN_PASSWORD = 'new password'; npm run admin:password -- you@psu.edu; Remove-Item Env:ADMIN_PASSWORD`
- To make someone an admin, run this in the Neon SQL editor, then set their password with the command above: `UPDATE users SET role = 'admin' WHERE email = 'their@psu.edu';`
- Sales are estimated as paying Full Access members × the price until Stripe is connected. AI spend uses the token counts PhatBot records, priced in `admin.js`.
- `AI_CREDIT_DOLLARS` (optional, default 5) sets the Anthropic credit shown on the page.

## Frat portal

Chapters manage their own parties at `/frats` (linked as **For frats** on the main site).

1. Each chapter has two passwords, set in the control room under **Chapters**: a **leader password** for the chapter leader sign-in, and a **brother password** that brothers join with. A leader can also change both from the portal's Settings. **Add leader** in the control room still works for making someone a leader by email.
2. Everyone logs in with their own PhatFrats account and opens `/frats`. Brothers use **Brother sign-in**; leaders use **Chapter leader sign-in**.
3. Leaders post, edit and cancel parties (up to two weeks ahead), approve or waitlist students' invite requests (Full Access first), manage members and change the chapter password.
4. There are no plus-ones: everyone who comes needs their own invite request or brother invite.
5. Every brother can invite people by Penn State email, up to 20 per party. Invited people go straight on the list, get an email, and don't use their weekly free invite. Someone without an account joins the list when they sign up with that email.

**Test Frat** (`data/test-chapters.js`) is a practice chapter. It works like a real one in the portal, but its parties never appear on the public map, in the party list or to PhatBot, and students can't request them.

Live chapter parties show on the map and in the party list next to the demo parties, marked "Posted by the house". Requests to them wait for the chapter instead of getting the demo's instant answer. PhatBot knows about them too.

### Frats page in the control room

The control room has two pages: **Overview** and **Frats** (`/admin#frats`). The Frats page shows:

- **Totals:** chapters set up, brothers and leaders, upcoming and total parties, student requests (waiting, approved, waitlisted), approval rate, and brother invites and how many were claimed.
- **A 30-day trend** of parties posted, requests, brother invites and new brothers.
- **Needs attention:** chapters with requests waiting, chapters set up without a leader, and full parties.
- **Top inviting brothers.**
- **Every upcoming frat party,** with how full it is. **Take down** removes a party from the map, and **Put back** restores it.
- **A chapters table** with each chapter's numbers and its password and leader controls.

Practice chapters like Test Frat are listed but left out of the totals, the trend and the leaderboard.

### Outside guests

Leaders can switch on **Allow outside guests** for each party (off by default). At those parties:

- Every student or brother on the list can bring **one** person who isn't a Penn State student, named in advance with an email or phone number. Penn State emails are refused, because students need their own invite.
- A student adds their guest in the request box or later from **My invites**. The leader approves or waitlists the guest in the portal's **Requests** tab.
- A brother adds their guest from **Invite people**. Brothers vouch for their guests, so those go straight on the list.
- Approved guests with an email get a confirmation. Guests show a photo ID that matches their name.
- Approved outside guests count toward the party's capacity. Banning a sponsor removes their guests.
- Guests' details are deleted two days after the party.

## Door Rush

Door Rush is the arcade game at `/game`, free for everyone. Visitors without an account play practice games; any confirmed account (Free or Full Access) saves scores, joins the weekly leaderboard and can win the weekly prize. Its code is in `game/door-rush.js`, served by `game-routes.js`. Each saved game uses a one-time ticket, and impossible scores are refused. The leaderboard shows each player's best game this week, as first name and last initial, and resets Monday at midnight Eastern.

## Payments (Stripe)

Full Access is sold with Stripe Checkout: one payment, no subscription. A pass lasts through the end of the current term (Spring through May 15, Summer through Aug 20, Fall through Jan 10). Buying with less than 30 days left also covers the next term. The rules are in `PRICING.passEnds` in `public/pricing.js`. When a pass ends, the account goes back to Free. Full Access given by hand in the control room never ends.

Checkout stays off until these are set in Vercel:

- `STRIPE_SECRET_KEY`: from the Stripe dashboard. A test key (`sk_test_`) takes only test cards; a live key (`sk_live_`) takes real money.
- `STRIPE_WEBHOOK_SECRET`: the signing secret of a webhook endpoint at `https://phat-frats.vercel.app/api/stripe/webhook`, listening for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.

A payment is recorded both by the webhook and when the buyer returns to the site, so either one alone is enough. Each payment is stored once in the `payments` table. The control room counts only live-mode payments as sales.

### Chapter pages

Each chapter's portal page uses its own identity: national colors and founding (`data/chapter-identity.js`), Greek letters, address, Instagram, live stats and its next party. Leaders can add a tagline and story and pick their own colors in **Settings → Chapter page**. Beta Sigma Beta and Tau Phi Delta have no published colors, so their pages use the site colors until a leader picks some.

The admin can open any chapter's page, with or without a leader, from **Open page** in the control room's Chapters table (`/frats?chapter=ID`). It works only while the control room is unlocked, and gives everything a leader can do.

## The Batcave (control room extras)

The control room has six pages: **Overview**, **Live**, **Money**, **Frats**, **Fame** and **Log**. Code lives in `admin-extras.js` and `ops.js` (server) and `public/batcave.js` (page).

- **Live:** a radar of houses people are viewing, a live ticker (no names or emails), the **beacon** (a site-wide banner for everyone, Free, Full Access or chapter leaders, shown by `public/beacon.js`), **lockdown** switches that pause sign-ups, invite requests or checkout, and the **spotlight** that pins one party to the top of the list.
- **Money:** revenue by day, this semester and all time, a semester goal, recent sales, **promo codes** (a 100% code grants the pass without Stripe; others discount checkout, minimum $0.50), and **gifts** of Full Access to all leaders, all brothers or a list of emails.
- **Fame:** Hall of Fame, the Night Forecast of which parties will fill first, growth (conversion, milestones, top referring sites) and Door Rush god mode (double-points events, reset the weekly board, remove a player's scores).
- **Log:** every change made from the control room, as plain sentences.
- Search everything from the box at the top, switch on **Batcave mode** with the 🦇 button, and type `batman` anywhere for a surprise.

## Community features

Built to bring students back every week. Code is in `community.js` (server) and `public/community.js` (main page).

- **Save parties** with ♡. Saved parties that reach 80% full raise an alert in the bell.
- **Notification bell** next to your name: approvals, waitlists, brother invites, referral progress, prizes and the Weekend Drop. Most also go by email unless switched off in the profile.
- **Profile** (tap your initials): weekend streak, badges (First on the list, Party regular, Door Rush champion, Connector, Full Access, Founding member), saved parties and email settings.
- **Referrals:** everyone gets a link (`/?ref=CODE`). When 3 friends sign up with it and confirm their email, the referrer gets Full Access through the end of the semester.
- **Share cards:** 📸 Share makes an Instagram-story image of a party, with a link back (`/?party=ID`).
- **Group plans:** 👯 makes a link (`/?group=CODE`) for friends going together. Each friend still requests their own invite, and the group shows who has.
- **Door Rush weekly prize:** each Monday, last week's top scorer gets Full Access through the end of next semester, automatically. A Vercel scheduled job (`crons` in `vercel.json`) calls `/api/cron/door-rush-prize` every Monday at 05:10 UTC (just after midnight in State College; Vercel's free plan may run it any time within that hour). Visiting Door Rush or the bell also checks, as a backup, and a week's prize is only ever given once. Set `CRON_SECRET` in Vercel so only the scheduler can call the job.
- **The Weekend Drop:** a countdown to Thursday 6 PM on the main page. In the control room (Live), **Send the Drop** notifies everyone, emails up to 400 people in blind-copied batches, and lights the beacon for 3 days.
- **Party Smart kit:** call 911, Penn State Police, share your location with a friend, tell friends you're home, a check-in reminder, and **Report something** (goes to the control room inbox).
- **About & contact** at `/about`. Messages land in the control room inbox.
- **Install as an app:** the site can be added to a phone's home screen (`public/sw.js` keeps a fallback copy for weak signal; account data is never stored).
- **Demo parties** can be hidden from the control room (Live) once real chapters are posting.

## Demo account

For graders and reviewers: log in (not sign up) as `demo@demo.com` through the normal Log in box. The demo link **https://phat-frats.vercel.app/?demo** opens Log in with that email filled in. The account is already confirmed (no email code) and has Full Access with no end date. It is **not** an admin: its role is `user` and it has no control room password.

To create it, or reset its password: `$env:DEMO_PASSWORD = "..."; npm run demo:account -- demo@demo.com; Remove-Item Env:DEMO_PASSWORD`. Only a hash of the password is stored, and resetting signs it out everywhere.

## Site guide

A plain-words guide to every feature (`public/guide.js`), with search and topic chips. It opens from the gold "📖 How PhatFrats works" button in the hero, "📖 Guide" in the menu, the floating "📖 Site guide" button (bottom left), or `/#guide`. When a feature changes, update its section there.

## Friends mode

Free for everyone (`friends.js` on the server, `public/friends.js` on the site). The 👯 button in the header opens the Friends screen:

- **This weekend**: which parties your friends marked "I'm going", and your own plans. Party cards show a 👯 count, and each party's details list friends going, with an "I'm going" switch and "Invite friends" (sends your group link to the friends you pick).
- **Friends**: requests to accept or decline, and each friend's profile: plans this weekend, streak, badges, Door Rush stats, favorite house, parties together and friends in common.
- **Add**: your friend link (`/?friend=CODE`, the same code as your referral link), add by email, and suggestions (people you referred, group plans, friends of friends).
- **Leaderboard**: this week's best Door Rush scores among you and your friends.
- **Privacy**: ghost mode (this weekend, or until switched off) and blocked people.

Privacy rules: friendships are mutual; friends only see parties you marked yourself, never a location; plans are deleted after the party's day; removing, declining and blocking are silent; and a chapter leader can tick "Keep the crowd private" on a party so it never shows on friends boards. The bell adds "3 friends are going to ..." alerts.

## Theme song

"On The List" plays on repeat on the Door Rush page only (`public/music.js`, loaded by `public/game.html`). Browsers only allow sound after someone interacts with the page, so it starts on the first tap, click or key. A floating 🔊 button (bottom left) mutes it, separately from the game's own sound effects button; the choice is remembered in that browser. People whose device asks for reduced motion start muted. The song file lives at `public/audio/on-the-list.mp3` and only downloads when it's about to play.
