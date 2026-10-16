# Control Online — Full Supabase Tutorial (auth, users, email confirmation)

Online rooms use **Supabase** for two things only:

1. **Auth** — email + password sign-up / sign-in (tokens stay on-device).
2. **Realtime** — ephemeral Presence + Broadcast channels named `online-room:<CODE>`.
   No custom server to run. LAN rooms keep working with zero setup.

---

## Part 0 — What you're building

```
Control app (Rooms → Online)
  ├─ sign-up / sign-in via Supabase Auth (auth.users, managed by Supabase)
  ├─ public.profiles (id, display_name) — one row per user, auto-created on signup
  └─ realtime channel online-room:<CODE> — roster + live timers, no tables
```

You will: create a free project → configure email auth + confirmation →
run one SQL file → connect the app → create real users → test with two accounts.

---

## Part 1 — Create the Supabase account and project

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in
   (GitHub login is fine).
2. Create an **Organization** if asked (name it anything, e.g. `control`).
3. **New project**:
   - Name: `control` (anything works)
   - Database password: generate a strong one and **save it in a password manager**
     (you need it only for direct DB access; the app never uses it).
   - Region: pick the one closest to you / your users (e.g. `West EU`,
     `East US`). Closer = lower realtime latency.
   - Plan: **Free** is enough (500 MB DB, 50k monthly active users, 200 concurrent
     realtime connections — plenty for rooms).
4. Wait ~2 minutes for provisioning. You land on the project dashboard.

## Part 2 — Copy the API keys

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy two values:
   - `Project URL` → this is `VITE_SUPABASE_URL`
     (looks like `https://xyzcompany.supabase.co`)
   - `anon public` key → this is `VITE_SUPABASE_ANON_KEY`
     (a long `eyJhbGciOi…` token)
3. ⚠️ Never put the `service_role` key in the app. It bypasses all security rules
   and must stay secret (server-side only).

## Part 3 — Configure email auth + confirmation

1. Left sidebar → **Authentication** → **Providers** → **Email** → make sure it's
   **enabled** (it is by default).
2. Still in **Authentication**, go to **Settings** (or **Configuration**):
   - **Confirm email**: this is the key switch.
     - `ON` (recommended for real users): sign-up sends a confirmation email.
       The account can't sign in until the user clicks the link. The Control app
       already handles this — after sign-up it shows
       *"Account created — check your email for a confirmation link, then sign in."*
     - `OFF` (testing shortcut): sign-up signs the user straight in, no email
       needed. Useful while you're wiring things up, then turn it back ON.
   - **Site URL**: set it to `https://xyzcompany.supabase.co`
     (your project URL) or any page you own. Why it matters: confirmation and
     password-reset links point here. The desktop app uses email + password
     directly (no OAuth browser redirects), so no special redirect setup is
     needed — the user just clicks the link in their email, gets confirmed,
     then signs in inside Control.
   - Leave **Redirect URLs** empty unless you add a website later.
3. Password rules: Supabase's default minimum is **6 characters** — the app's
   sign-up form already enforces `minLength={6}`, so they match.

### How email confirmation actually flows (what your users experience)

With **Confirm email ON**:

1. User opens Control → Rooms → **Online** → *New here? Create one*.
2. Enters display name + email + password → **Create account**.
3. App shows: *"Account created — check your email, then sign in."*
   (Technical note: Supabase returns no session until the email is confirmed,
   and the app detects exactly that.)
4. User opens the inbox, clicks **Confirm email** → browser opens a Supabase
   confirmation page → account is now verified.
5. Back in Control, the form has flipped to **Sign in**. User signs in.
   Done — they can now host and join rooms.

With **Confirm email OFF**, step 2 signs them straight in (steps 3–5 vanish).

## Part 4 — Email sending: built-in vs custom SMTP

Out of the box, Supabase sends auth emails (confirmation, password reset)
through its own mailer. That works immediately, but on the **free tier it's
rate-limited** (a few emails per hour). Good enough for you + friends testing.

When you have real users, add your own SMTP sender (10 min, one time):

1. Get SMTP credentials from a sender (e.g. [Resend](https://resend.com),
   Postmark, or Gmail App Password for tiny scale).
2. Dashboard → **Project Settings** → **Auth** → **SMTP Settings** → enable,
   paste host / port / username / password / sender address.
3. Send yourself a test sign-up to verify.

Optional but recommended: **Authentication → Email Templates** → customize the
*Confirm signup* template (mention "Control", keep the `{{ .ConfirmationURL }}`
button — that's the magic link, don't delete it).

## Part 5 — Create the profiles table (one SQL file)

Dashboard → **SQL Editor** → **New query** → paste the entire contents of
`supabase/schema.sql` in this repo → **Run**. It creates:

- `public.profiles` (`id`, `display_name`, timestamps) — one row per auth user.
- **Row Level Security**: signed-in users can *read* all names (the roster needs
  this) but can *insert/update only their own* row. Anonymous users see nothing.
- A **trigger** (`handle_new_user`) that auto-creates the profile row on every
  signup, taking the display name from the sign-up form.
- Nothing for Realtime — Presence + Broadcast on `online-room:*` channels work
  with zero configuration.

Verify it worked:

1. **Table Editor** → you should see a `profiles` table (empty for now).
2. **Authentication → Policies** → `profiles` should list 3 policies
   (select / insert / update).

## Part 6 — Connect the Control app

**Option A — `.env` file (permanent, needs rebuild):**

```bash
cp .env.example .env
# fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run build
```

**Option B — in-app override (no rebuild, per machine):**

Control → Rooms → **Online** → **Advanced** → paste URL + anon key →
**Save & reload**. Stored in `localStorage` (`control-supabase-config`).

`.env` is gitignored — keys are never committed. If a key ever leaks, regenerate
it in Project Settings → API.

## Part 7 — Create actual users (3 ways)

**Way 1 — self sign-up through the app (normal path, do this first):**
Rooms → Online → *New here? Create one* → display name + email + password.
Confirm the email if required, then sign in.

**Way 2 — create manually in the dashboard (for friends/family):**
Authentication → **Users** → **Add user** → **Create new user** → enter email +
password (tick *Auto Confirm User* if you want to skip their confirmation step)
→ Save. Tell them the email + password; they sign in via the app's Sign in form.

**Way 3 — invite by email:**
Authentication → Users → **Invite user** → enter their email. They get an invite
link, set their password, then sign in via the app.

After any of these, check **Authentication → Users** — the new user appears in
the list — and **Table Editor → profiles** — their display-name row appears
(created by the trigger, or upserted on first rename from the app).

## Part 8 — End-to-end test with two accounts

1. **Account A** (your machine): Rooms → Online → sign in → **Host — new code**
   → note the 6-letter code (e.g. `KQ7XPA`).
2. **Account B** (second machine, or a second Control window / browser dev
   server): sign in with a different account → enter the code → **Join**.
3. On A, start a control session. Within ~20 seconds B's roster shows
   `Controlling · <mode>` next to A's name, with a live countdown.
4. Stop/leave on either side — the roster updates within seconds.

LAN check (regression): switch to the **LAN · Wi-Fi** tab — the old offline
host/join flow is untouched and works with no account at all.

## Part 9 — Managing users day-to-day

All in Dashboard → **Authentication → Users**:

| Task | How |
|---|---|
| See all users / who confirmed | Users table shows email, created-at, confirmation status |
| Resend confirmation | Open the user → **Resend confirmation** (or turn Confirm email OFF temporarily while testing) |
| Reset someone's password | Open the user → **Send password reset** (or they use *Forgot password?* in the app) |
| Block someone | Open the user → **Ban** (they can't sign in; unban anytime) |
| Delete someone | Open the user → **Delete** (their `profiles` row is cascade-deleted automatically) |
| Change a display name | Users do it themselves in the app (Online account → *rename*), which updates both auth metadata and the `profiles` row |

## Part 10 — Troubleshooting

| Symptom | Cause → fix |
|---|---|
| App shows "Setup needed" / "not configured" | Keys missing: `.env` not filled, or no Advanced override saved. Check `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
| "Wrong email or password" right after sign-up | Confirm email is ON and they haven't clicked the link yet → check inbox/spam, or verify status in Users. |
| Confirmation email never arrives | Free-tier rate limit, or spam folder → wait / check spam; add custom SMTP (Part 4) for real usage. |
| "Could not join room (TIMEOUT…)" | Machine offline, URL typo, or project paused (free projects pause after inactivity — dashboard shows **Resume**) |
| Signed in but roster stays empty | Both sides must enter the **same code** (case-insensitive, 6 chars). Presence syncs within seconds of joining. |
| Display name shows "Guest" | They signed up before the trigger existed, or left the name blank → use *rename* in the app, which upserts the profile row. |
| Need to rotate a leaked anon key | Project Settings → API → regenerate → update `.env` / Advanced override on each machine. |

## How it works (for contributors)

- `src/services/cloud.ts` — Supabase client singleton, auth helpers,
  `useCloudSession()` hook, `CloudRoomSession` (Realtime channel wrapper),
  `generateRoomCode()` / `sanitizeRoomCode()`.
- `src/components/AuthPanel.tsx` — sign-up / sign-in / sign-out / rename /
  password reset + Advanced key override. Used in Rooms and Settings.
- `src/components/CloudRoomsPanel.tsx` — host/join by code, roster with live
  timer states, auto-publishes `activeSession` (heartbeat every 20s).
- `src/components/RoomsView.tsx` — Online | LAN tab switch. LAN path is the
  untouched Electron TCP implementation (`electron/rooms/`).
- Channel: `online-room:<CODE>`, presence key = random per-join id carrying
  `{ name, user_id }`, broadcast event `timer` carrying
  `{ peerId, name, userId, state }`. Roster = presence members + last
  broadcast state per member.

## Limits / next steps

- Codes are ephemeral: a room exists while ≥1 peer is subscribed. No history
  is stored (by design — same privacy posture as LAN rooms).
- Abuse controls (rate limits, code allowlists) can be added later with a
  `cloud_rooms` table + RLS; presence channels already isolate rooms by code.
- Google OAuth / Apple sign-in would need redirect handling in Electron —
  deliberately out of scope for v1; email + password covers desktop.
