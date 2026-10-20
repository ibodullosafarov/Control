/**
 * electron-builder afterPack hook: embed the WidgetKit extension into
 * Control.app/Contents/PlugIns/.
 *
 * Why this exists: WidgetKit widgets must live in a .appex embedded in a
 * containing .app. Rather than ship a second "Control Widgets.app", we embed
 * the extension into Electron's own Control.app so the user installs one app.
 * The staged appex is built by macos/ControlWidgets/bundle.sh into
 * build/widgets/ControlWidgetsExtension.appex and pulled in via extraResources.
 *
 * CRITICAL: we sign ONLY the .appex and deliberately do NOT re-sign the outer
 * Control.app or its Frameworks. Electron already ad-hoc signs the outer
 * bundle and its Helper apps; blanket re-signing the outer bundle with
 * `codesign --force` invalidates the Helper app signatures ("code has no
 * resources but signature indicates they must be present") and breaks the
 * bundle. The appex is signed before it is copied in, so it already carries a
 * valid self-contained signature; Electron's outer seal treats Contents/PlugIns
 * as nested content and does not need to be re-sealed for an ad-hoc build.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export default async function afterPack(context) {
  const appOutDir = context.appOutDir; // e.g. release/mac-arm64
  const appName = context.packager.appInfo.productFilename; // "Control"

  const appBundle = path.join(appOutDir, `${appName}.app`);
  const plugInsDir = path.join(appBundle, 'Contents', 'PlugIns');
  const destAppex = path.join(plugInsDir, 'ControlWidgetsExtension.appex');

  // Locate the staged appex. extraResources copies build/widgets/** into the
  // app's Contents/Resources/widgets/.
  const candidates = [
    path.join(appBundle, 'Contents', 'Resources', 'widgets', 'ControlWidgetsExtension.appex'),
    path.join(appOutDir, 'resources', 'widgets', 'ControlWidgetsExtension.appex'),
    path.join(context.packager.projectDir, 'build', 'widgets', 'ControlWidgetsExtension.appex'),
  ];
  const srcAppex = candidates.find((p) => fs.existsSync(p));

  if (!srcAppex) {
    // Widgets are optional: if the extension wasn't built, skip quietly so
    // packaging still produces a working app.
    console.log(
      `[embed-widget] no staged appex found (looked in ${candidates.join(', ')}). ` +
        'Skipping widget embed. Run "npm run widgets:build" first to include widgets.'
    );
    return;
  }

  console.log(`[embed-widget] embedding ${srcAppex} -> ${destAppex}`);
  fs.mkdirSync(plugInsDir, { recursive: true });
  fs.rmSync(destAppex, { recursive: true, force: true });
  fs.cpSync(srcAppex, destAppex, { recursive: true });

  // Ensure the embedded copy carries a valid ad-hoc signature with the widget
  // sandbox entitlements (PlugInKit requires a sandbox). We sign the appex
  // only — never the outer bundle. bundle.sh already signs the staged copy,
  // but re-sign here so the embedded copy is bound to this exact location.
  const entitlements = path.join(
    context.packager.projectDir,
    'macos',
    'ControlWidgets',
    'ControlWidgets.entitlements'
  );

  const { execFileSync } = await import('node:child_process');
  const signArgs = ['--force', '--sign', '-'];
  if (fs.existsSync(entitlements)) {
    signArgs.push('--entitlements', entitlements);
  }
  signArgs.push(destAppex);
  console.log('[embed-widget] ad-hoc signing appex');
  execFileSync('codesign', signArgs, { stdio: 'inherit' });

  console.log('[embed-widget] done (outer bundle left untouched)');
}
