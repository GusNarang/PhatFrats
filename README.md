# PhatFrats

A party finder for Penn State students, built by **Agastya Narang**.

Create an account with a Penn State email and get a map of every Interfraternity Council house around State College, with this week's parties lit up. Click a house to see the theme, time, dress code and how full it's getting, then request an invite right from the page. A directory of all 34 IFC chapters, with addresses and Instagram handles, is open to everyone.

## Passes

| | Free | Full Access ($0.75, one time) |
|---|---|---|
| See the map and party details | Yes | Yes |
| Invite requests | One party | Unlimited |
| Place in the host's line | Normal | Front of the line |

Checkout isn't built yet, so every account is currently Free. Only a confirmed payment should ever set `plan = 'full'`.

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
- `db/schema.sql`: the `users`, `sessions` and `invite_requests` tables
- `public/`: the site itself (`index.html`, party data and map data)
- `tools/map/`: the scripts that generated the map data
- `archive/`: the earlier single-file demo, which has no accounts

Passwords are hashed with scrypt and sessions last 30 days in an HttpOnly cookie. The one-party limit is enforced on the server.

**Never commit or upload `.env`.** It holds your database password.

## Notes

- Chapter names and addresses come from [pennstateifc.org/chapters](https://www.pennstateifc.org/chapters).
- Every party and host approval is fictional demo data.
- Email addresses aren't verified yet, and there's no password reset yet.
- The street map uses data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors). House pins come from geocoding each IFC address.
- Not affiliated with Penn State University or the Interfraternity Council.
