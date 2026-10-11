# Control — Personal Study & Deep Work System for macOS

> **A typography-first, distraction-free personal study and deep work operating system built exclusively for macOS.**  
> Inspired by the precision of *Monkeytype*, the instant speed of *Raycast*, and the fluid liquid-glass depth of macOS Sequoia.

---

## 💡 The Control Difference

Browser-extension blockers are easy to bypass — one tab, one Settings click, and they're gone. Control is
**native to the machine**, so it can't be clicked around:

- **Kills it at the network layer** — writes real `/etc/hosts` rules, which no browser can ignore.
- **Kills it at the process layer** — actually terminates and re-terminates distracting apps (Discord, Slack, X, Steam…).
- **Survives the "but I need it" moment** — an optional bridge to SelfControl for un-cancellable lockdowns.
- **Zero AI, 100% deterministic** — the day planner computes optimal focus windows with math, never hallucination.
- **All data stays on your Mac** — no telemetry, no cloud account, no dark patterns. Control respects your
  autonomy: instant exit, no forced timers.

---

## ⚡ Quick Start

### 1. Launch the Native macOS Application
If installed in `/Applications`:
```bash
open /Applications/Control.app
```
Or launch the prebuilt standalone release binary directly:
```bash
open release/mac-arm64/Control.app
```

### 2. Run from Source (Development / Instant Start)
```bash
npm install
npm run dev
# Or run the built production client:
npm start
```

### 3. Rebuild Application Bundle & DMG Installer
Whenever you make updates, generate the fresh `.app` bundle and `.dmg` installer:
```bash
npm run package:dmg
```
To install it directly to `/Applications`:
```bash
npm run install:app
```

---

## 🧭 How to Use Control Effectively (The Masterclass Guide)

Control is engineered to eliminate the mental friction of starting, eliminate the trap of endless digital distractions, and protect your deepest cognitive states. Follow this systematic workflow to achieve effortless flow every day.

```
1. Morning Kickoff  ──▶  2. Select Mode  ──▶  3. Shield Up  ──▶  4. Deep Focus  ──▶  5. Zen Break  ──▶  6. Review & Log
 (Queue Priorities)      (Lesson / Deep)       (Web & Apps)       (Binaural/Halo)     (Acoustic Chime)    (Stats & History)
```

---

### Phase 1: The Morning Kickoff & Priority Queue (`Tab [1]`)
Most procrastination happens because your brain doesn't know what to do next. When you open your Mac, Control greets you dynamically:
1. **Add Your Daily Tasks**: Type your priority into the quick-add bar and press `[Enter]`.
2. **Assign Specific Study Modes**: Control allows you to tag tasks with specific study modes (e.g. *Math Homework* tagged to **Homework Mode**, *Code Refactor* tagged to **Deep Study**).
3. **Order Your Queue**: Use the `[▲]` and `[▼]` promotion arrows to place your highest-leverage task at the very top under **Current Focus Target**.
4. **Follow the Visual Pipeline**:
   - `1. Write Tasks` → `2. Plan My Day` → `3. Distraction Shield`.

---

### Phase 2: Choosing or Crafting Your Focus Mode (`Tab [5]`)
Control does not enforce rigid 25-minute Pomodoro timers if your work demands longer immersion. Choose the mode that matches your cognitive load:

| Mode | Work Duration | Break Duration | Cycles | Best For |
|---|---|---|---|---|
| **Current Lesson** | 45 min | 10 min | 3 cycles | Structured lecture review, online courses |
| **Homework** | 50 min | 10 min | 2 cycles | Problem sets, assignments, essays |
| **Deep Study** | 60 min | 15 min | 2 cycles | Intense programming, thesis writing, research |
| **Chess / Sprint** | 25 min | 15 min | 2 cycles | Rapid tactical practice, rapid problem drills |
| **Chill / Free Time** | 30 min | 0 min | 1 cycle | Guilt-free leisure, browsing (no blocking) |

> 💡 **Custom Study Modes**: Click **Modes [5]** to create unlimited custom modes with tailored cycle lengths, customized work intervals, dedicated app blocklists, and custom accent colors.

---

### Phase 3: Native Distraction Shielding (`Tab [3]`)
Distraction blockers that rely on browser extensions are easily bypassed. Control uses a **native two-tier system engine**:
1. **Network Layer (DNS / Hosts)**:
   - Safely updates `/etc/hosts` routing rules between managed tags and flushes macOS mDNSResponder caches.
   - Prevents access across **all browsers** (Safari, Chrome, Brave, Arc, Firefox).
2. **Process Layer (Native macOS App Lockdown)**:
   - Add native desktop apps that derail you (e.g. *Discord*, *Slack*, *Telegram*, *Steam*, *Twitter*).
   - When a focus work cycle begins, Control automatically minimizes or terminates distracting app processes.
3. **Break-Aware Automation**:
   - When your timer switches from **Work** to **Break**, Control **automatically unblocks** websites and apps so you can check messages guilt-free.
   - When the break ends and the next work cycle begins, the shield re-engages instantly.
4. **Hardcore SelfControl Bridge**:
   - For high-stakes study sessions, Control provides direct integration with the native `selfcontrol-cli` daemon for un-cancellable system lockdowns.

---

### Phase 4: Entering The Zone (The Active Session View `Tab [2]`)
Once you launch a session by clicking **Focus** on a task or pressing `[Enter]`:
- **Minimalist Tabular Countdown**: High-contrast, large digital clock with breathing ambient glow (`timer-halo-pulse`).
- **One-Target Focus Spotlight**: Displays your current active task right under the timer. Check it off when done with `[Mark Done]` to trigger a celebratory confetti burst and automatically advance to the next queued item.
- **Zen Focus Audio (Ambient Soundscapes)**:
  - Click the **Music** button in the header (or in the session dock) to layer background sound:
    - 🌧️ **Gentle Rain & Distant Thunder**: Blocks erratic background room noise.
    - ☕ **Cozy Coffee House**: Subtle murmur that boosts creative linguistic flow.
    - 🌲 **Pine Forest & Birds**: Relaxes tension during high-stress problem solving.
    - 📼 **Lo-Fi Vinyl Crackle**: Rhythmic warmth for extended study endurance.
    - 🌊 **Pacific Ocean Waves**: Calming rhythmic cadence.
    - 📻 **Pink / White Noise**: Maximum auditory masking for pure logical thinking.
- **Harmonic Acoustic Cues**:
  - Pure synthesized Tibetan singing bowls on break transitions.
  - Delicate chime pairs on work intervals.
  - Celebratory fanfare upon complete session mastery.

---

### Phase 5: Instant Exit & Background Run (Zero Time Restriction)
Control respects your autonomy:
- **No Close Restrictions**: The previous 30-second forced countdown delay has been **completely removed**.
- **Instant Exit**: When you click **Exit** or press `[Esc]`, you can immediately confirm exit with **one click** (`End Session & Exit App Immediately`). Control cleanly restores `/etc/hosts`, unblocks applications, stops background soundscapes, and exits cleanly.
- **Run in Background (`Minimize to Menu Bar`)**:
  - Need your full screen for Xcode, VS Code, or an IDE?
  - Click **Minimize to Menu Bar** in the exit dialog or close the window. Control will minimize to the macOS status bar tray.
  - The tray icon dynamically displays live time remaining: ` 24:18 (Deep Study)`.
  - Click the tray item anytime to pause, advance tasks, or reopen full-screen Control.

---

### Phase 6: Deterministic Day Planner (`Tab [4]`)
- **100% Deterministic (No AI Hallucinations)**: Calculates optimal focus windows, break buffers, and cycle allocations mathematically based on your available hours.
- **Google Calendar Direct Sync**: Exports your approved study schedule directly to your Google Calendar.
- **Apple Calendar (.ics) Export**: Generates standard `.ics` calendar files that open directly in macOS Apple Calendar.

---

### Phase 7: History & Flow Analytics (`Tab [6]`)
- Tracks total hours focused, daily streak records, cycle completion rate, and completed task archives.
- All analytics are computed locally on your device.

---

## ⌨️ Global Keyboard Shortcuts Master Cheat Sheet

| Shortcut | Context | Action |
|---|---|---|
| `⌘K` | Anywhere | Open Spotlight Omni Command Palette |
| `⌘1` – `⌘7` | Anywhere | Instant Tab Navigation (Tasks, Timer, Shield, Planner, Modes, Stats, Settings) |
| `[Enter]` | Tasks Hub | Add new task & select mode |
| `[Shift + Enter]` | Tasks Hub | Quick-queue task without modal |
| `[Space]` | Active Timer | Pause / Resume Active Focus Session |
| `[N]` | Active Timer | Skip to Next Phase (Cycle / Break) |
| `[F]` | Active Timer | Finish & Record Session Early |
| `[Esc]` | Active Timer | Open Instant Exit Dialog / Dismiss |
| `[M]` | Active Timer | Mute / Unmute Acoustic Bells |
| `[P]` | Anywhere | Open Day Planner |
| `[C]` | Anywhere | Start Quick 30m Chill Leisure Session |

---

## 🎨 Maximally Modern Visual Themes

Control features 13 hyper-refined liquid-glass themes with multi-layered frosted blurs and specular edge lighting:

### Dark Suites (OLED & Ambient Glow)
- **Obsidian Aurora** *(Default)* — Deep midnight blue with electric cyan neon accents.
- **OLED Cyber Carbon** — Pure `#000000` pitch blacks with warm amber highlights.
- **Glacier Frost** — Nordic arctic blues with crisp ice highlights.
- **Matrix Jade** — Emerald phosphor terminal aesthetic.
- **Tokyo Neon Violet** — Cyberpunk lavender and neon violet glows.
- **Sunset Rose** — Twilight plum with warm rose quartz glow.
- **Deep Abyss** — Sub-oceanic high-contrast blue.
- **Solar Espresso** — Warm mocha roast with golden solar accents.

### Light Suites (Paper & Natural Clarity)
- **Modern Minimal** — Crisp slate whites with royal blue highlights.
- **Soft Paper** — Warm parchment tones with sepia contrast (gentle on eyes in daylight).
- **Liquid Pearl** — Frosted translucent glass with sky blue highlights.
- **Matcha Zen** — Soothing organic green tea tones.
- **Lavender Mist** — Pastel purple mist with violet accents.

Toggle between light and dark modes anytime with the animated **Sun / Moon** button in the header.

### ♿ Accessibility Built In
- **Reduce Animations & Motion** — disables all motion-blur effects, ambient orbs, and state transitions for a calm, instant UI (Settings → User Profile).
- **Dyslexia-Friendly Typography** — one toggle swaps the UI to *Atkinson Hyperlegible*, a high-legibility typeface designed for easier reading.
- **Keyboard-first** — full global shortcut map below; every core action is reachable without a mouse.

---

## 🔒 Local-First Privacy & Architecture

All application data is stored 100% locally on your Mac:
- **Location**: `~/.focus-app/data.json`
- **Zero External Telemetry**: No third-party tracking scripts, no cloud logins required.
- **Safe Host File Teardown**: Whenever Control closes, crashes, or unblocks, original `/etc/hosts` integrity is verified and restored.
- **One-Click Backup & Restore**: Export your full task history, custom modes, and planner configs to a single `.json` file anytime in **Settings [7]**.

---

## 🛠️ Tech Stack

- **Runtime**: Electron 44 (Native macOS ARM64 / Intel)
- **Frontend**: React 19, TypeScript 7, Vite 8
- **Styling**: Tailwind CSS 4, Liquid-Glass frosted glassmorphic design system
- **Icons & Graphics**: Lucide React, Simple Icons, Canvas Confetti
- **Audio Engine**: Web Audio API (Native acoustic synthesizer + multi-track ambient sound generator)
- **Packager**: Electron Builder

---

## 🗺️ Roadmap (Active Working Set)

Because this is a local-first app, each item below ships with full privacy preserved:

- **Launch readiness** — code signing + Apple notarization so installs don't fight Gatekeeper, then automatic in-app updates.
- **Public GitHub** — source, issue tracker, changelog, and community-shared day templates.
- **End-of-day focus report** — a one-line daily digest (hours, tasks closed, best window) delivered to your notification centre.
- **Template gallery on launch** — curated day-plans (exam sprints, thesis weeks, coding marathons, language study) ready in one click.
- **Focus insights** — time-of-day heatmaps and "your best focus hours" surfaced in History.

> **Suggested next steps for contributors:** sign/notarize the build, wire `electron-updater` to GitHub Releases, and flesh out the template gallery.

---

*Engineered with precision for peak human performance.*
