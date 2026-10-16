"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.blocker = exports.appBlocker = exports.AppBlocker = exports.DistractionBlocker = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// macOS Finder uses .icns containers that embed PNGs of several sizes. Rather
// than app.getFileIcon (which can wedge on some Electron/macOS combos), we
// parse the container and return the largest embedded PNG as a data URL.
function pngFromBundle(bundlePath) {
    try {
        const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
        let iconFiles;
        try {
            iconFiles = fs.readdirSync(resourcesDir).filter((f) => /\.icns$/i.test(f));
        }
        catch {
            iconFiles = [];
        }
        // { buf, start, end } of the largest valid embedded PNG found across all
        // .icns files in the bundle.
        let best = null;
        for (const file of iconFiles) {
            let buf;
            try {
                buf = fs.readFileSync(path.join(resourcesDir, file));
            }
            catch {
                continue;
            }
            // Walk the .icns container chunk-by-chunk. Each embedded PNG begins with
            // its signature inside one of these chunks; some icns formats store the
            // PNG raw, but we simply scan for PNG signatures and validate by walking
            // the PNG's own chunks forwards from the IHDR.
            let idx = -1;
            while ((idx = buf.indexOf(PNG_SIGNATURE, idx + 1)) !== -1) {
                let pos = idx + 8; // start of the PNG's first chunk (length field)
                if (buf.toString('ascii', pos + 4, pos + 8) !== 'IHDR')
                    continue;
                const firstLen = buf.readUInt32BE(pos);
                const w = buf.readUInt32BE(pos + 8);
                const h = buf.readUInt32BE(pos + 12);
                if (!w || !h || w > 4096 || h > 4096)
                    continue;
                let cursor = pos + 8 + firstLen + 4; // skip IHDR data + CRC
                let end = 0;
                while (cursor + 8 <= buf.length) {
                    const len = buf.readUInt32BE(cursor);
                    const type = buf.toString('ascii', cursor + 4, cursor + 8);
                    if (type === 'IEND') {
                        end = cursor + 8 + len;
                        break;
                    }
                    cursor += 8 + len + 4; // data + CRC
                }
                if (end <= idx)
                    continue;
                if (!best || w * h > best.w * best.h) {
                    best = { buf, start: idx, end, w, h };
                }
            }
        }
        if (!best || best.end - best.start <= 8)
            return null;
        const png = best.buf.subarray(best.start, best.end);
        return `data:image/png;base64,${png.toString('base64')}`;
    }
    catch {
        return null;
    }
}
const HOSTS_FILE = '/etc/hosts';
const BLOCK_START_MARKER = '# --- BEGIN CONTROL MANAGED BLOCKLIST ---';
const BLOCK_END_MARKER = '# --- END CONTROL MANAGED BLOCKLIST ---';
const SELFCONTROL_CLI_PATH = '/Applications/SelfControl.app/Contents/MacOS/selfcontrol-cli';
class DistractionBlocker {
    activeDomains = [];
    currentStrategy = 'none';
    isActive = false;
    constructor() {
        // Ensure clean state on startup
        this.cleanupOnExit();
    }
    isSelfControlInstalled() {
        return fs.existsSync(SELFCONTROL_CLI_PATH);
    }
    async isSelfControlRunning() {
        if (!this.isSelfControlInstalled())
            return false;
        try {
            const { stdout } = await execAsync(`"${SELFCONTROL_CLI_PATH}" is-running`);
            return stdout.trim().includes('YES');
        }
        catch {
            return false;
        }
    }
    async startBlocking(domains, strategy = 'dynamic_hosts') {
        if (!domains || domains.length === 0 || strategy === 'none') {
            await this.stopBlocking();
            return { success: true };
        }
        this.activeDomains = domains;
        this.currentStrategy = strategy;
        if (strategy === 'selfcontrol' && this.isSelfControlInstalled()) {
            return await this.startSelfControl(domains, 25);
        }
        return await this.applyHostsBlock(domains);
    }
    async applyHostsBlock(domains) {
        try {
            let currentHosts = '';
            if (fs.existsSync(HOSTS_FILE)) {
                currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
            }
            // Remove existing block section
            const regex = new RegExp(`${BLOCK_START_MARKER}[\\s\\S]*?${BLOCK_END_MARKER}\n?`, 'g');
            const cleanHosts = currentHosts.replace(regex, '').trim();
            // Build new managed block section
            const entries = [
                BLOCK_START_MARKER,
                '# Managed automatically by Control. Do not edit manually.',
            ];
            for (const domain of domains) {
                const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                if (clean) {
                    entries.push(`127.0.0.1 ${clean}`);
                    entries.push(`::1 ${clean}`);
                    if (!clean.startsWith('www.')) {
                        entries.push(`127.0.0.1 www.${clean}`);
                        entries.push(`::1 www.${clean}`);
                    }
                }
            }
            entries.push(BLOCK_END_MARKER);
            const newContent = `${cleanHosts}\n\n${entries.join('\n')}\n`;
            // Write to temp file first
            const tempPath = path.join('/tmp', `hosts_control_${Date.now()}`);
            fs.writeFileSync(tempPath, newContent, 'utf-8');
            // Try writing directly if permissions allow, or use AppleScript privilege prompt
            try {
                fs.writeFileSync(HOSTS_FILE, newContent, 'utf-8');
            }
            catch {
                // Requires root escalation
                const cmd = `osascript -e 'do shell script "cp ${tempPath} ${HOSTS_FILE} && dscacheutil -flushcache && killall -HUP mDNSResponder" with administrator privileges'`;
                await execAsync(cmd);
            }
            // Flush DNS
            try {
                await execAsync('dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true');
            }
            catch { }
            try {
                if (fs.existsSync(tempPath))
                    fs.unlinkSync(tempPath);
            }
            catch { }
            this.isActive = true;
            return { success: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Failed to apply hosts block:', msg);
            return { success: false, error: msg };
        }
    }
    async stopBlocking() {
        try {
            if (fs.existsSync(HOSTS_FILE)) {
                const currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
                const regex = new RegExp(`${BLOCK_START_MARKER}[\\s\\S]*?${BLOCK_END_MARKER}\n?`, 'g');
                if (regex.test(currentHosts)) {
                    const cleanHosts = currentHosts.replace(regex, '').trim() + '\n';
                    const tempPath = path.join('/tmp', `hosts_control_clean_${Date.now()}`);
                    fs.writeFileSync(tempPath, cleanHosts, 'utf-8');
                    try {
                        fs.writeFileSync(HOSTS_FILE, cleanHosts, 'utf-8');
                    }
                    catch {
                        const cmd = `osascript -e 'do shell script "cp ${tempPath} ${HOSTS_FILE} && dscacheutil -flushcache && killall -HUP mDNSResponder" with administrator privileges'`;
                        await execAsync(cmd);
                    }
                    try {
                        if (fs.existsSync(tempPath))
                            fs.unlinkSync(tempPath);
                    }
                    catch { }
                }
            }
            try {
                await execAsync('dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true');
            }
            catch { }
            this.isActive = false;
            this.activeDomains = [];
            return { success: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('Failed to stop blocking:', msg);
            return { success: false, error: msg };
        }
    }
    async startSelfControl(domains, minutes) {
        if (!this.isSelfControlInstalled()) {
            return { success: false, error: 'SelfControl.app is not installed at /Applications/SelfControl.app' };
        }
        try {
            const endDate = new Date(Date.now() + minutes * 60 * 1000).toISOString();
            const blocklistPath = path.join('/tmp', 'control_selfcontrol_blocklist.txt');
            fs.writeFileSync(blocklistPath, domains.join('\n'), 'utf-8');
            const cmd = `"${SELFCONTROL_CLI_PATH}" start --blocklist "${blocklistPath}" --enddate "${endDate}"`;
            await execAsync(cmd);
            this.isActive = true;
            return { success: true };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: msg };
        }
    }
    getStatus() {
        return {
            isActive: this.isActive,
            strategy: this.currentStrategy,
            blockedCount: this.activeDomains.length,
            blockedDomains: this.activeDomains,
            selfControlAvailable: this.isSelfControlInstalled(),
            hostsManageable: true,
        };
    }
    cleanupOnExit() {
        process.on('exit', () => {
            try {
                if (fs.existsSync(HOSTS_FILE)) {
                    const currentHosts = fs.readFileSync(HOSTS_FILE, 'utf-8');
                    const regex = new RegExp(`${BLOCK_START_MARKER}[\\s\\S]*?${BLOCK_END_MARKER}\n?`, 'g');
                    if (regex.test(currentHosts)) {
                        const cleanHosts = currentHosts.replace(regex, '').trim() + '\n';
                        fs.writeFileSync(HOSTS_FILE, cleanHosts, 'utf-8');
                    }
                }
            }
            catch { }
        });
    }
}
exports.DistractionBlocker = DistractionBlocker;
// ─────────────────────────────────────────────────────────────────────────────
// AppBlocker: Native macOS Application Blocking Engine
// Kills running blocked apps and polls to re-kill them during control sessions
// ─────────────────────────────────────────────────────────────────────────────
const APP_SEARCH_DIRS = () => [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(os.homedir(), 'Applications'),
];
function appNameFromBundle(bundlePath, fallback) {
    try {
        const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
        const text = fs.readFileSync(plistPath, 'utf-8');
        for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
            const m = text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
            if (m && m[1])
                return m[1];
        }
    }
    catch { }
    return fallback;
}
class AppBlocker {
    activeApps = [];
    isActive = false;
    pollTimer = null;
    cachedApps = null;
    cachedAppsIcons = new Map();
    POLL_INTERVAL_MS = 2000;
    async startBlocking(appNames) {
        if (!appNames || appNames.length === 0) {
            return { success: true };
        }
        this.activeApps = appNames;
        this.isActive = true;
        // Immediately kill any currently running blocked apps
        const results = await Promise.all(appNames.map(async (name) => {
            const killed = await this.killApp(name).catch(() => false);
            return { name, killed };
        }));
        const failed = results.filter((r) => !r.killed);
        // Start polling to catch apps that get relaunched
        this.startPolling();
        if (failed.length > 0) {
            return {
                success: true,
                error: `Could not terminate: ${failed.map((f) => f.name).join(', ')}. Grant Control Automation permission in System Settings → Privacy & Security.`,
            };
        }
        return { success: true };
    }
    async stopBlocking() {
        this.isActive = false;
        this.activeApps = [];
        this.stopPolling();
        return { success: true };
    }
    startPolling() {
        this.stopPolling();
        this.pollTimer = setInterval(() => {
            if (this.isActive && this.activeApps.length > 0) {
                this.killAllBlocked().catch(() => { });
            }
        }, this.POLL_INTERVAL_MS);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async killAllBlocked() {
        for (const appName of this.activeApps) {
            await this.killApp(appName).catch(() => { });
        }
    }
    async killApp(appName) {
        const cleanName = appName.replace(/\.app$/i, '').trim();
        if (!cleanName)
            return false;
        try {
            // Multi-strategy kill: graceful AppleScript quit first, then escalating
            // process-kill fallbacks covering exact names, fuzzy/helper matches,
            // and matching processes by bundle path.
            const script = `osascript -e 'quit app "${cleanName}"' >/dev/null 2>&1; ` +
                `pkill -x "${cleanName}" >/dev/null 2>&1; ` +
                `pkill -fi "${cleanName}" >/dev/null 2>&1; ` +
                `pkill -f "/${cleanName}.app/" >/dev/null 2>&1; ` +
                `true`;
            await execAsync(script);
            return true;
        }
        catch {
            return false;
        }
    }
    async isAppRunning(appName) {
        const cleanName = appName.replace(/\.app$/i, '').trim();
        if (!cleanName)
            return false;
        try {
            const { stdout } = await execAsync(`pgrep -x "${cleanName}" 2>/dev/null || pgrep -fi "${cleanName}" 2>/dev/null || true`);
            return stdout.trim().length > 0;
        }
        catch {
            return false;
        }
    }
    async getRunningApps() {
        const running = [];
        for (const app of this.activeApps) {
            if (await this.isAppRunning(app)) {
                running.push(app);
            }
        }
        return running;
    }
    // ── Installed app discovery (Spotlight-powered, filesystem fallback) ──────
    async listInstalledApps() {
        if (this.cachedApps)
            return this.cachedApps;
        let apps = [];
        try {
            const { stdout } = await withTimeout(execAsync(`mdfind "kMDItemContentType == 'com.apple.application-bundle'" 2>/dev/null`), 8000);
            const paths = stdout.split('\n').filter((p) => p.trim().endsWith('.app'));
            for (const appPath of paths) {
                const fallback = path.basename(appPath).replace(/\.app$/i, '');
                apps.push({
                    name: appNameFromBundle(appPath, fallback),
                    path: appPath,
                });
            }
        }
        catch { }
        if (apps.length === 0) {
            // Fallback: directory scan if Spotlight is unavailable
            for (const dir of APP_SEARCH_DIRS()) {
                try {
                    for (const entry of fs.readdirSync(dir)) {
                        if (entry.endsWith('.app')) {
                            const appPath = path.join(dir, entry);
                            const fallback = entry.replace(/\.app$/i, '');
                            apps.push({
                                name: appNameFromBundle(appPath, fallback),
                                path: appPath,
                            });
                        }
                    }
                }
                catch { }
            }
        }
        // Deduplicate and sort
        const seen = new Set();
        apps = apps
            .filter((a) => {
            if (seen.has(a.path))
                return false;
            seen.add(a.path);
            return true;
        })
            .sort((a, b) => a.name.localeCompare(b.name));
        this.cachedApps = apps;
        return apps;
    }
    async searchInstalledApps(query) {
        const apps = await this.listInstalledApps();
        const q = query.trim().toLowerCase();
        const results = q ? apps.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 10) : apps.slice(0, 10);
        // Attach real app icons (data URLs) by extracting the embedded PNG from
        // each bundle's .icns. Reuse cached icons where possible to keep the
        // search snappy.
        await Promise.all(results.map(async (result) => {
            try {
                const cached = this.cachedAppsIcons.get(result.path);
                if (cached !== undefined) {
                    result.icon = cached;
                    return;
                }
                const icon = pngFromBundle(result.path);
                result.icon = icon || '';
                this.cachedAppsIcons.set(result.path, result.icon);
            }
            catch {
                this.cachedAppsIcons.set(result.path, '');
            }
        }));
        return results;
    }
    getStatus() {
        return {
            isActive: this.isActive,
            blockedApps: this.activeApps,
            blockedCount: this.activeApps.length,
        };
    }
}
exports.AppBlocker = AppBlocker;
exports.appBlocker = new AppBlocker();
exports.blocker = new DistractionBlocker();
