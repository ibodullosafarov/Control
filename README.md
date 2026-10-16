# Control

**Your personal study and deep-work system for macOS.**

Control brings your tasks, control sessions, website blocking, study planning, and progress into one place — so you can spend less time managing productivity and more time actually working.

No accounts. No AI features. No unnecessary complexity. Just your workspace, your rules, and your time.

---

## What is Control?

Control is a macOS desktop application designed to help you build a consistent study routine and protect your attention.

Instead of juggling a task manager, a timer, a website blocker, and a calendar, Control brings these tools together in one controlled workspace.

## Features

### Tasks
- Build and organize a queue of tasks.
- Arrange tasks in the order you want to complete them.
- Associate tasks with your study modes.
- Keep your next action clear instead of deciding what to do every time you finish something.

### Control Timer
- Run controlled work sessions with configurable breaks and cycles.
- Use custom study modes for different activities.
- Track your recorded work time.
- Get audio cues to help you recognize session transitions.

### Shield
- Block distracting websites during control sessions.
- Block selected desktop applications.
- Integrate with SelfControl where configured.
- Automatically coordinate blocking with your control and break sessions.

**Important:** Website and application blocking may require administrator authorization and additional system configuration. Blocking behavior depends on your settings and the configured integrations.

### Day Planner
- Plan your day around scheduled work.
- Organize study sessions into a deterministic daily schedule.
- Connect planning with your control modes and timers.
- Integrate with Google Calendar and export calendar events through `.ics` files.

### Modes
Create study modes for different types of work.

A mode can define the control interval, break duration, number of cycles, accent color, and associated blocking configuration.

For example, you could create separate modes for Math, English, Vocabulary, or a longer deep-work session.

Modes let you adapt your workflow to the task instead of forcing every activity into the same timer.

### Obsidian Templates
If you use Obsidian, you can organize your study plans with Markdown templates.

Control supports template-based workflows for turning Markdown plans into scheduled sessions or applying checklists to daily notes.

The scheduling workflow can use session durations, start times, timer settings, control modes, and other supported fields. Review the parsed schedule before applying it.

Control can work with a configured Obsidian vault using these locations:

- `Control/Templates` — reusable templates.
- `Control/Days` — generated daily notes.
- `Control/Tasks` — task notes.

Template behavior depends on the format you use. Consult the template documentation for supported syntax and examples.

### Google Calendar
Connect your Google Calendar to coordinate your external schedule with your study plan.

- Synchronize supported planned sessions.
- Use calendar events as part of your daily workflow.
- Export events using `.ics` files.

Google Calendar integration requires configuration and authorization. It is optional; you can use Control without connecting a calendar.

### Statistics
Review your recorded study activity and work history to understand how you spend your time.

### Menu Bar
Keep Control running in the background and access its live countdown from the macOS menu bar.

### Personalization
- Choose from 13 built-in themes.
- Configure your study modes and blocking preferences.
- Customize your workspace without needing an online account.

---

## Installation

Control is built for macOS and currently targets Apple Silicon.

### Requirements

- A Mac with Apple Silicon.
- macOS 13 or later.
- Additional permissions for features such as website and application blocking.

### Install from a DMG

1. Download the `Control-1.0.0-arm64.dmg` release.
2. Open the downloaded DMG.
3. Follow the installation instructions provided with the release.
4. Launch Control from your Applications folder.

### macOS security warning

The current release is ad-hoc signed and is not notarized by Apple. macOS may warn you when opening it.

This does not automatically mean the application is malicious, but it does mean the release has not passed Apple's notarization process.

Only install software from a source you trust. If macOS blocks the application, review the warning and the release's authenticity before deciding whether to proceed.

---

## Getting started

You do not need to configure everything before using Control. Start with the essentials.

### 1. Set up your first tasks

Open the Tasks section and add the work you want to complete.

Keep tasks concrete. For example:

- Solve 25 SAT Math questions.
- Complete an English practice set.
- Review vocabulary.
- Correct mistakes from yesterday.

Arrange them in your preferred order.

### 2. Configure a study mode

Open Modes and choose an existing configuration or create your own.

Set the control interval, break duration, and number of cycles that fit your work. You can use different modes for different subjects.

### 3. Start a control session

Choose your task, start the timer, and work through the session.

If you use Shield, configure your blocking preferences before relying on it to protect a session.

### 4. Plan your day

Use the Day Planner to arrange your work into a realistic schedule.

If you already plan in Obsidian, configure your vault and use the supported Markdown template workflow instead of manually recreating every session.

### 5. Review your progress

Use Stats and your recorded history to see how your study sessions are going.

The goal isn't to fill every minute of your day. It's to make the time you spend working more intentional.

---

## Google Calendar setup

Google Calendar is optional.

To connect it:

1. Open Control's settings and locate the Google Calendar configuration.
2. Follow the documented Google OAuth setup.
3. Enable the Google Calendar API for the associated Google Cloud project.
4. Configure the appropriate OAuth client credentials.
5. Complete authorization and verify synchronization with a test event.

Google's OAuth configuration can vary depending on the client type and account setup. Follow the current setup guide rather than sharing credentials or tokens with other people.

---

## Data and privacy

Control is designed around local use.

- **No Control account required.**
- **No AI features.**
- Application data is stored locally.
- The application's main JSON data file is located at `~/.control-app/data.json`.
- Google Calendar synchronization is optional and communicates with Google when configured.
- Blocking integrations can interact with system-level configuration on your Mac.

Your local application data and your synchronized Google Calendar data are separate things. Removing local application data does not necessarily remove events already created in Google Calendar.

### Back up your data

Before reinstalling Control, changing configurations, or troubleshooting data issues, keep a copy of important local data.

At minimum, back up:

`~/.control-app/data.json`

Also preserve any external files you depend on, such as your Obsidian vault, templates, and Google OAuth configuration.

Do not share OAuth credentials or secrets when requesting support.

---

## Troubleshooting

### Control won't open

The release may trigger macOS security warnings because it is not notarized. Verify that you obtained the correct release and review macOS's security guidance before proceeding.

### Website blocking doesn't work

Check that the required permissions and blocking configuration are in place. If your setup uses SelfControl, verify that its command-line integration is installed and configured.

### Google Calendar doesn't synchronize

Check your internet connection, Google Cloud API settings, OAuth client configuration, and authorization status. Make sure the Google Calendar API is enabled.

### My Obsidian template isn't parsed correctly

Verify that the template follows a supported format, that the correct vault is configured, and that referenced modes exist in Control. Preview the schedule before applying it.

### My data appears to be missing

Check the local application data directory and any backups before attempting a reset or reinstall. Avoid deleting application data while troubleshooting.

---

## Building from source

Control is built with:

- Electron 44
- React 19
- TypeScript
- Vite 8
- Tailwind CSS 4
- Electron Builder

### Prerequisites

- Node.js and npm.
- Git, if cloning a repository.
- macOS and the dependencies required by the project.

### Development

Clone the repository, enter the project directory, and install dependencies:

```bash
npm install
```

Start the development environment:

```bash
npm run dev
```

To launch the built application using the project's start script:

```bash
npm start
```

### Build a DMG

```bash
npm run package:dmg
```

The release output is written to the project's `release` directory. The current documented release is `Control-1.0.0-arm64.dmg`.

For the exact supported architectures and packaging requirements, refer to the release configuration in the source repository.

---

## Project philosophy

Control is built around a few simple principles:

- **Control over complexity.** The interface should help you start working, not become another project to manage.
- **Local-first.** Your essential workflow should not require an account or an AI service.
- **Your rules.** Configure your modes, schedules, and blocking preferences around the way you study.
- **One workspace.** Tasks, timers, planning, and control protection should work together.
- **Practical productivity.** The goal is meaningful work, not maximizing the number of productivity features you use.

Control is not intended to turn every moment into work. Breaks, flexibility, and realistic plans matter too.

---

## Feedback and contributions

Control is an evolving personal project. Feedback, bug reports, and suggestions are welcome.

When reporting an issue, include:

- Your macOS version.
- Your Control version.
- The steps needed to reproduce the issue.
- Any relevant error messages or logs.

Never include passwords, OAuth secrets, access tokens, or private personal data in a bug report.

---

**Control — Take control of your time.**
