# Deploying to Render

**One service runs the whole app.** The build compiles the frontend into
`frontend/dist`, and the Express server serves those files alongside `/api/*`.

That means a single URL, no CORS to configure (the browser talks to the same
origin it loaded from), and only one free-tier service to keep awake.

---

## Before you start — rotate your secrets

`backend/.env` was committed to this public repo earlier, so treat everything in
it as compromised. Do these first:

1. **Telegram bot token** — message [@BotFather](https://t.me/BotFather) →
   `/revoke` → pick the bot → copy the new token.
2. **MongoDB** — the old Atlas cluster is gone; the new one below gets a fresh
   password. Don't reuse `akhila:root`.

The old values remain in git history. Rotating is what makes them harmless.

---

## 1. MongoDB Atlas (required)

Render's filesystem is wiped on every deploy and restart, so the local JSON
store can't be used in production — every registration would vanish.

1. [cloud.mongodb.com](https://cloud.mongodb.com) → create a free **M0** cluster.
2. **Database Access** → add a user, strong password, "Read and write to any database".
3. **Network Access** → Add IP Address → **Allow access from anywhere**
   (`0.0.0.0/0`). Render doesn't publish fixed egress IPs on the free plan.
4. **Connect** → **Drivers** → copy the connection string. It looks like:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/tradotsav?retryWrites=true&w=majority
   ```

   Replace `USER`/`PASSWORD`, and keep `/tradotsav` before the `?` — that names
   the database.

---

## 2. Deploy

Push this branch to GitHub, then in Render: **New → Blueprint → pick this repo**.
It reads [render.yaml](render.yaml) and creates the service.

Fill in the values Render prompts for:

| Variable | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 1 |
| `TELEGRAM_BOT_TOKEN` | your new token |
| `CHANNEL_ID` | `-1003967476757` |
| `VITE_ADMIN_USER` | your admin username |
| `VITE_ADMIN_PASS` | a new password |
| `TWILIO_*` | leave blank unless you want real SMS |

Don't set `PORT` — Render injects it. Don't set `VITE_API_URL` — leaving it blank
is what makes the frontend call its own origin. Don't set `CORS_ORIGIN` either;
it's only needed if you host the frontend somewhere else.

`VITE_*` values are compiled into the JavaScript at **build** time, so changing
the admin password needs a redeploy, not just a restart.

Prefer two separate services (a static site plus an API)? That works too — set
`VITE_API_URL` to the API's URL and `CORS_ORIGIN` to the site's URL. You then
have two free services to keep awake instead of one.

---

## 3. After deploying

- Visit `https://<your-service>.onrender.com/` — the signup page should load.
- Visit `https://<your-service>.onrender.com/api/health` — should return
  `{"ok":true,"mode":"mongo"}`. If it says `mock`, `MONGO_URI` didn't take.
- Register once and confirm the row appears in Atlas.
- The database starts empty. `npm run seed` is local-only — don't run it against
  production.

---

## Known limits on the free plan

**The service sleeps after ~15 minutes idle.** While asleep:

- the bot stops responding (nothing polls Telegram),
- the expiry cron doesn't run, so nobody gets removed on time,
- the first request afterwards takes ~50 seconds to wake.

Requests wake it, so the website itself works — it's the background work that
stops. Two ways round it:

- **Free:** point [UptimeRobot](https://uptimerobot.com) at `/api/health` every
  5 minutes. Keeps it awake, and the cron keeps running.
- **Paid:** Render's Starter plan ($7/mo) never sleeps.

**Other things worth knowing**

- *Pending OTPs are lost on restart.* The code lives in a file on the ephemeral
  disk. The user just requests a new one — no data loss, minor annoyance.
- *Telegram updates during downtime are dropped.* On boot with no saved offset
  the server skips the backlog. That's deliberate — it stops the duplicate
  welcome messages — but a `/start` sent while asleep won't be seen.
- *The admin password ships inside the JavaScript bundle.* Vite inlines
  `VITE_ADMIN_PASS`, so anyone can read it in devtools. It keeps casual visitors
  out of the dashboard; it is not real authentication. Move the check to a
  backend endpoint before this holds real subscriber data.
- *The cron runs every minute.* Fine for the 5-minute test plans, but that's
  1,440 sweeps a day. Consider hourly for real monthly plans.
