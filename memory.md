# Mandatory Task for AI Agents

Every time you finish making changes to this codebase, you **MUST** create or update the `.dmg` and `.app` files so that the application installers are always up to date:

```bash
npm run package:dmg
```

### Build Details & Artifact Locations
- **Packaging Command**: `npm run package:dmg` (runs `npm run icons` → `npm run build` → `npm run widgets:build` → `electron-builder`). The `package:*` scripts build widgets automatically.
- **Generated `.dmg`**: [`release/Control-1.0.0-arm64.dmg`](release/Control-1.0.0-arm64.dmg)
- **Generated `.app` Bundle**: [`release/mac-arm64/Control.app`](release/mac-arm64/Control.app)
- **Installed macOS App**: `~/Applications/Control.app` (run `npm run install:app` — it packages and installs there)

Always run this packaging command as your final step before finishing your response.

### Install location (`~/Applications`, not `/Applications`)
`npm run install:app` installs to **`$HOME/Applications/Control.app`** via
`scripts/install-app.sh`. Do not change this back to `/Applications`:

- `/Applications` is not writable without elevation, so the install would fail
  (or demand a sudo password) for a normal user.
- macOS treats `~/Applications` as a first-class per-user Applications folder
  (Launchpad, Spotlight, widget gallery).
- **The WidgetKit extension must keep a stable on-disk path.** PlugInKit
  registers the `.appex` by absolute path, so moving the app makes the widget
  re-register under a new path and lose its existing desktop instances.

The script quits the running app, replaces the bundle with `ditto` (which
preserves the Electron framework symlinks that `cp -R` mangles), re-registers
the bundle with `lsregister` so PlugInKit refreshes the widget registration,
verifies the `.appex` is embedded, and relaunches the app.

### Single-App Widgets (do not regress)
The WidgetKit widget is **embedded inside `Control.app`** — there is **NO separate "Control Widgets.app"**. Keep it that way.

- `macos/ControlWidgets/bundle.sh` builds **only** the `.appex` (no host app) and stages it at `build/widgets/ControlWidgetsExtension.appex`.
- `scripts/embed-widget.js` is the electron-builder `afterPack` hook. It copies the staged `.appex` into `Control.app/Contents/PlugIns/` and signs **only the appex**.
- `package.json` `build.extraResources` stages `build/widgets/**` into the app's `Contents/Resources/widgets/`; the hook relocates it to `Contents/PlugIns/`.
- The appex keeps its own sandbox entitlements (`macos/ControlWidgets/ControlWidgets.entitlements`): `com.apple.security.app-sandbox` + a read-only home-relative exception for `~/.control-app/` (the widget-state.json snapshot the app publishes via `electron/widgetBridge.ts`). Control.app itself stays unsandboxed (needs `/etc/hosts` + `osascript` admin); host and extension sandbox settings may differ.

**Never re-sign the outer `Control.app` or its `Frameworks/`** from the hook. Electron already ad-hoc signs those; blanket `codesign --force` on the outer bundle invalidates the Helper app signatures. Sign the appex only.

### Known quirk (not a bug)
`codesign --verify --strict` on the packaged app reports *"code has no resources but signature indicates they must be present"* for `Control.app` and its Helper apps. This is a **pre-existing Electron + ad-hoc-signing quirk** (present in a baseline build with no widget) and does **not** affect the app at runtime. Do not chase it.

### Verification for widgets
After packaging, confirm the widget resolves to its home inside Control.app:
```bash
pluginkit -m -p com.apple.widgetkit-extension | grep -i controlwidgets
# expect: com.control.widgets.ControlWidgets  ...  /Users/<you>/Applications/Control.app/Contents/PlugIns/ControlWidgetsExtension.appex
```

### The sandbox home-directory trap (do not regress)
The widget extension is sandboxed, and **inside a sandbox `NSHomeDirectory()` and
`FileManager.homeDirectoryForCurrentUser` are redirected to the app's container**
(`~/Library/Containers/com.control.widgets.ControlWidgets/Data`) — *not* the user's
real home. The snapshot is written by the unsandboxed Electron app to the real
home (`~/.control-app/widget-state.json`), so resolving it with
`homeDirectoryForCurrentUser` silently reads a file that does not exist, `load()`
returns `nil`, and **every widget renders its empty placeholder**.

`WidgetStore` therefore resolves the real home via `getpwuid(getuid())` (the
password database, readable from the sandbox) and relies on the
`com.apple.security.temporary-exception.files.home-relative-path.read-only`
entitlement (`/.control-app/`) for the read itself. The app additionally mirrors
the snapshot into the extension's container as a fallback.

Rule: **never** compute the snapshot path with `homeDirectoryForCurrentUser` in
the widget. If a widget suddenly shows empty/placeholder content, check that
`WidgetStore.load()` still finds a file — the extension logs
`No widget snapshot found` under subsystem `com.control.widgets.ControlWidgets`:

```bash
/usr/bin/log show --last 10m --predicate 'subsystem == "com.control.widgets.ControlWidgets"'
```

Widgets are refreshed by the WidgetKit timeline (60s), not by a push: WidgetKit
suspends the extension process as soon as a timeline is produced, so an
in-process file watcher would never run.

