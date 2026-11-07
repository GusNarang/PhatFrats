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

1. In the control room, under **Chapters**, set a chapter's password. That switches the chapter on. Then use **Add leader** with the leader's PhatFrats email.
2. Brothers log in with their own accounts, open `/frats`, pick their chapter and enter the chapter password.
3. Leaders post, edit and cancel parties (up to two weeks ahead), approve or waitlist students' invite requests (Full Access first), manage members and change the chapter password.
4. There are no plus-ones: everyone who comes needs their own invite request or brother invite.
5. Every brother can invite people by Penn State email, up to 20 per party. Invited people go straight on the list, get an email, and don't use their weekly free invite. Someone without an account joins the list when they sign up with that email.

Live chapter parties show on the map and in the party list next to the demo parties, marked "Posted by the house". Requests to them wait for the chapter instead of getting the demo's instant answer. PhatBot knows about them too.
