# Mandatory Task for AI Agents

Every time you finish making changes to this codebase, you **MUST** create or update the `.dmg` and `.app` files so that the application installers are always up to date:

```bash
npm run package:dmg
```

### Build Details & Artifact Locations
- **Packaging Command**: `npm run package:dmg` (runs `npm run icons` → `npm run build` → `npm run widgets:build` → `electron-builder`). The `package:*` scripts build widgets automatically.
- **Generated `.dmg`**: [`release/Control-1.0.0-arm64.dmg`](release/Control-1.0.0-arm64.dmg)
- **Generated `.app` Bundle**: [`release/mac-arm64/Control.app`](release/mac-arm64/Control.app)
- **Installed macOS App**: `/Applications/Control.app` (can also run `npm run install:app`)

Always run this packaging command as your final step before finishing your response.

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
# expect: com.control.widgets.ControlWidgets  ...  /Applications/Control.app/Contents/PlugIns/ControlWidgetsExtension.appex
```
