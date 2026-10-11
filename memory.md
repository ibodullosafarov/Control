# Mandatory Task for AI Agents

Every time you finish making changes to this codebase, you **MUST** create or update the `.dmg` and `.app` files so that the application installers are always up to date:

```bash
npm run package:dmg
```

### Build Details & Artifact Locations
- **Packaging Command**: `npm run package:dmg` (runs `npm run build` and uses `electron-builder` to generate both the `.dmg` installer and the `.app` bundle).
- **Generated `.dmg`**: [`release/Control-1.0.0-arm64.dmg`](release/Control-1.0.0-arm64.dmg)
- **Generated `.app` Bundle**: [`release/mac-arm64/Control.app`](release/mac-arm64/Control.app)
- **Installed macOS App**: `/Applications/Control.app` (can also run `npm run install:app`)

Always run this packaging command as your final step before finishing your response.
