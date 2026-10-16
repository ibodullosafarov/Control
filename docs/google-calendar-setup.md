# Google Calendar Two-Way Sync — Setup & Reference

Control mirrors Day Planner events with Google Calendar in both directions.
All Google communication runs in the Electron **main process**; the renderer
only ever receives a filtered `GoogleSyncStatus` — OAuth tokens and client
secrets never cross the process boundary.

## 1. Create a Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**, add yourself as a **test user**
     (while the app is in testing mode).
   - Scopes: `calendar.events`, `calendar.calendarlist.readonly`, `openid`, `email`
     (Control requests exactly these — see `GOOGLE_SCOPES` in
     `electron/google/credentials.ts`).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app** (recommended — needs no Client Secret).
   - **Web application** also works, but you must then paste its **Client Secret**
     into Control too, or sign-in fails with `client_secret is missing`.
   - For **Web application** add an authorized redirect URI — Control uses a
     loopback server on an ephemeral port, so any
     `http://127.0.0.1:<port>/callback` form works; Google accepts the
     loopback pattern for installed apps.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`).
   For a Web-application client also copy its **Client Secret**.
   If sign-in fails with `invalid_client`, that almost always means the secret
   is missing or wrong — re-enter both in Settings → Google Calendar.

## 2. Give Control the Client ID

Pick one (first match wins):

| Source | How |
|---|---|
| Environment | `GOOGLE_OAUTH_CLIENT_ID` (and `GOOGLE_OAUTH_CLIENT_SECRET` for Web-application clients) before launching Control |
| Settings UI | Preferences → Google Calendar → **Enter Client ID**, plus the **Client Secret** field when your client needs one (stored in `~/.control-app/google-oauth.json`) |

Then click **Connect Google Calendar**. Your browser opens for consent
(system browser, never a webview); Control listens on
`http://127.0.0.1:<ephemeral>/callback` with PKCE (S256) + random `state`.

> **Which client type?** A **Desktop** client needs only the Client ID — the
> secret field stays empty. A **Web application** client *requires* its Client
> Secret at sign-in (Google's rule, not Control's — no app can skip it); without
> it you'll get `client_secret is missing` / `invalid_client`. If sign-in fails
> that way, Control opens the credentials form automatically — just add the secret.
>
> **Rotating the Client ID?** Tokens are bound to the OAuth client, so saving a
> different ID signs out the current connection — hit **Reconnect** afterwards.
> If sync ever reports "authorization expired", the same Reconnect button in
> Settings → Google Calendar fixes it; planner data and mappings are kept.
>
> **Secret in Settings but still failing?** If `GOOGLE_OAUTH_CLIENT_ID` is set in
> your shell environment, it takes precedence — Control merges the Settings-file
> secret under it, but unsetting the env var and restarting is cleaner.
>
> **Still stuck?** Hit **Copy diagnostics** at the bottom of the Google Calendar
> section and share the output — it contains error codes and the event log but
> never tokens or secrets (`~/.control-app/google-sync/diagnostics.log`).

## 3. How sync behaves

- **First connect** runs a full sync: eligible local events are pushed, and
  the last 45 days of the target calendar are imported. After that everything
  is incremental via per-calendar **sync tokens**.
- **Push eligibility** (existing history is never bulk-uploaded):
  - events dated within the last 45 days, or
  - older events you **edit after connecting** (`updatedAt > connectedAt`), or
  - events already linked from a previous sync.
  - Tasks, templates and session history are never calendar events and are
    never uploaded — the engine only reads `DayPlan.blocks`.
- **Conflict policy**: concurrent edits → **local wins** (ETag `412` is
  retried without the precondition); a remote **deletion** beats a pending
  local edit (the planner block is removed after you confirm the apply).
- **Sync tokens advance only after the app confirms** the imported changes
  were saved to `~/.control-app/data.json`. A crash can repeat work but never
  loses acknowledged imports or creates duplicates (every push searches by the
  `controlBlockId` extended property before inserting).
- **Triggers**: after connect, ~4 s after launch, window control (debounced),
  every 5 minutes, ~1.5 s after local saves, on reconnect, and **Sync Now**.
- **Full Resync** drops all sync tokens and re-imports — use it if the two
  sides ever look inconsistent.

## 4. Where state lives (all local, all in `~/.control-app/`)

| File | Contents |
|---|---|
| `google-tokens.json` | OAuth tokens, encrypted with the OS keychain when available (`insecureStorage` is reported in Settings otherwise) |
| `google-oauth.json` | OAuth Client ID you entered in Settings |
| `google-sync/state.json` | Mappings, sync tokens, pending ops, counters (atomic writes) |
| `data.json` | Your planner data (sole writer: the renderer) |

**Disconnect** clears tokens and sync state. Your planner data is always kept.
Optionally also delete the events Control created in Google Calendar
(checkbox in the disconnect confirmation).

## 5. Limitations

- Recurring Google events arrive as individual instances within the sync
  window (no series mastering in the planner).
- Overnight timed events are shown single-day (`23:59` end); the true end is
  preserved and round-trips losslessly.
- Only calendars writable by your account can be selected as the push target
  (read-only/hidden calendars are filtered out).
- Pull covers the selected target calendar plus any calendar holding mapped
  events; other calendars are never imported.
- Offline edits queue durably in `google-sync/state.json` and flush on
  reconnect with exponential backoff.
- Events created from Markdown templates (Schedule/Apply flows) sync as
  ordinary Day Planner events — no separate path, no special setup. Completing
  a block after an auto-executed session syncs as a normal local edit.
- The automatic execution scheduler never touches Google: reminders and
  session starts are local-only; only the underlying planner edits sync.
