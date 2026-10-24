import Foundation
import SwiftUI
import os

// MARK: - Codable snapshot (mirrors electron/widgetBridge.ts)
//
// Every type decodes leniently: a missing or renamed field falls back to a
// sensible default instead of failing the whole decode. A schema change in
// the Electron app must never blank out every widget.

public struct WidgetState: Codable {
    public var schemaVersion: Int
    public var updatedAt: String
    public var name: String
    public var session: WidgetSession
    public var today: WidgetToday
    public var stats: WidgetStats
    public var note: WidgetNote?

    public init(
        schemaVersion: Int = 1,
        updatedAt: String = "",
        name: String = "",
        session: WidgetSession = .idle,
        today: WidgetToday = .empty,
        stats: WidgetStats = .zero,
        note: WidgetNote? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.updatedAt = updatedAt
        self.name = name
        self.session = session
        self.today = today
        self.stats = stats
        self.note = note
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        session = try c.decodeIfPresent(WidgetSession.self, forKey: .session) ?? .idle
        today = try c.decodeIfPresent(WidgetToday.self, forKey: .today) ?? .empty
        stats = try c.decodeIfPresent(WidgetStats.self, forKey: .stats) ?? .zero
        note = try c.decodeIfPresent(WidgetNote.self, forKey: .note)
    }
}

public struct WidgetSession: Codable {
    public var active: Bool
    public var modeName: String
    public var modeColor: String
    public var phase: String
    public var phaseLabel: String
    public var isPaused: Bool
    public var endsAt: Double?
    public var remainingSeconds: Int
    public var currentCycle: Int
    public var totalCycles: Int
    public var currentTask: String?

    public init(
        active: Bool = false,
        modeName: String = "",
        modeColor: String = "#8e8e93",
        phase: String = "idle",
        phaseLabel: String = "Idle",
        isPaused: Bool = false,
        endsAt: Double? = nil,
        remainingSeconds: Int = 0,
        currentCycle: Int = 0,
        totalCycles: Int = 0,
        currentTask: String? = nil
    ) {
        self.active = active
        self.modeName = modeName
        self.modeColor = modeColor
        self.phase = phase
        self.phaseLabel = phaseLabel
        self.isPaused = isPaused
        self.endsAt = endsAt
        self.remainingSeconds = remainingSeconds
        self.currentCycle = currentCycle
        self.totalCycles = totalCycles
        self.currentTask = currentTask
    }

    /// The "nothing running" state.
    public static let idle = WidgetSession()

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? false
        modeName = try c.decodeIfPresent(String.self, forKey: .modeName) ?? ""
        modeColor = try c.decodeIfPresent(String.self, forKey: .modeColor) ?? "#8e8e93"
        phase = try c.decodeIfPresent(String.self, forKey: .phase) ?? "idle"
        phaseLabel = try c.decodeIfPresent(String.self, forKey: .phaseLabel) ?? "Idle"
        isPaused = try c.decodeIfPresent(Bool.self, forKey: .isPaused) ?? false
        endsAt = try c.decodeIfPresent(Double.self, forKey: .endsAt)
        remainingSeconds = try c.decodeIfPresent(Int.self, forKey: .remainingSeconds) ?? 0
        currentCycle = try c.decodeIfPresent(Int.self, forKey: .currentCycle) ?? 0
        totalCycles = try c.decodeIfPresent(Int.self, forKey: .totalCycles) ?? 0
        currentTask = try c.decodeIfPresent(String.self, forKey: .currentTask)
    }
}

public struct WidgetToday: Codable {
    public var date: String
    public var blocks: [WidgetBlock]

    public init(date: String = "", blocks: [WidgetBlock] = []) {
        self.date = date
        self.blocks = blocks
    }

    public static let empty = WidgetToday()

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        blocks = try c.decodeIfPresent([WidgetBlock].self, forKey: .blocks) ?? []
    }
}

public struct WidgetBlock: Codable, Identifiable {
    public var id: String
    public var title: String
    public var startTime: String
    public var endTime: String
    public var modeName: String
    public var color: String
    public var status: String

    public init(
        id: String = "",
        title: String = "",
        startTime: String = "",
        endTime: String = "",
        modeName: String = "",
        color: String = "#8e8e93",
        status: String = "proposed"
    ) {
        self.id = id
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.modeName = modeName
        self.color = color
        self.status = status
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        startTime = try c.decodeIfPresent(String.self, forKey: .startTime) ?? ""
        endTime = try c.decodeIfPresent(String.self, forKey: .endTime) ?? ""
        modeName = try c.decodeIfPresent(String.self, forKey: .modeName) ?? ""
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? "#8e8e93"
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "proposed"
    }
}

public struct WidgetStats: Codable {
    public var focusMinutesToday: Int
    public var cyclesToday: Int
    public var sessionsToday: Int
    public var streakDays: Int

    public init(
        focusMinutesToday: Int = 0,
        cyclesToday: Int = 0,
        sessionsToday: Int = 0,
        streakDays: Int = 0
    ) {
        self.focusMinutesToday = focusMinutesToday
        self.cyclesToday = cyclesToday
        self.sessionsToday = sessionsToday
        self.streakDays = streakDays
    }

    public static let zero = WidgetStats()

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        focusMinutesToday = try c.decodeIfPresent(Int.self, forKey: .focusMinutesToday) ?? 0
        cyclesToday = try c.decodeIfPresent(Int.self, forKey: .cyclesToday) ?? 0
        sessionsToday = try c.decodeIfPresent(Int.self, forKey: .sessionsToday) ?? 0
        streakDays = try c.decodeIfPresent(Int.self, forKey: .streakDays) ?? 0
    }
}

public struct WidgetNote: Codable {
    public var text: String
    public var updatedAt: String
    public var taskTitle: String?

    public init(text: String = "", updatedAt: String = "", taskTitle: String? = nil) {
        self.text = text
        self.updatedAt = updatedAt
        self.taskTitle = taskTitle
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        taskTitle = try c.decodeIfPresent(String.self, forKey: .taskTitle)
    }
}

// MARK: - Reader

/// Reads the snapshot the app publishes to `~/.control-app/widget-state.json`.
///
/// ## Why this is not just `homeDirectoryForCurrentUser`
///
/// The widget extension is sandboxed (PlugInKit requires it). Inside a
/// sandbox, `NSHomeDirectory()` and `FileManager.homeDirectoryForCurrentUser`
/// are redirected to the app's **container**
/// (`~/Library/Containers/<bundle-id>/Data`) — *not* the user's real home.
/// The Electron app writes the snapshot into the real home
/// (`/Users/<you>/.control-app/widget-state.json`), so resolving the path with
/// `homeDirectoryForCurrentUser` silently yields a file that does not exist:
/// the read fails, `load()` returns `nil`, and every widget renders its empty
/// placeholder state. That is the "widgets show nothing" bug.
///
/// The real home is resolved from the password database (`getpwuid`), which
/// the sandbox permits, and the read is allowed by the
/// `com.apple.security.temporary-exception.files.home-relative-path.read-only`
/// entitlement in ControlWidgets.entitlements. The container copy is checked
/// as a fallback in case the app mirrors the snapshot there.
public enum WidgetStore {
    private static let logger = Logger(
        subsystem: "com.control.widgets.ControlWidgets",
        category: "store"
    )

    /// The user's real home directory (e.g. `/Users/ibodullo`).
    public static var realHome: URL {
        if let pw = getpwuid(getuid()) {
            return URL(fileURLWithPath: String(cString: pw.pointee.pw_dir))
        }
        // Fallback: NSHomeDirectory() may already be the real home when the
        // extension is not sandboxed (e.g. a debug run).
        return URL(fileURLWithPath: NSHomeDirectory())
    }

    /// The sandbox container directory for this extension.
    public static var containerHome: URL {
        URL(fileURLWithPath: NSHomeDirectory())
    }

    /// Snapshot locations to try, most authoritative first.
    public static var candidateFiles: [URL] {
        [
            realHome.appendingPathComponent(".control-app/widget-state.json"),
            containerHome.appendingPathComponent(".control-app/widget-state.json"),
            containerHome.appendingPathComponent("widget-state.json"),
        ]
    }

    /// Load the newest readable snapshot, or `nil` when there is none.
    public static func load() -> WidgetState? {
        var failures: [String] = []

        for file in candidateFiles {
            guard FileManager.default.fileExists(atPath: file.path) else { continue }
            do {
                let data = try Data(contentsOf: file)
                let state = try JSONDecoder().decode(WidgetState.self, from: data)
                logger.debug("Loaded widget snapshot from \(file.path, privacy: .public)")
                return state
            } catch {
                failures.append("\(file.path): \(error.localizedDescription)")
                logger.error(
                    "Could not decode widget snapshot at \(file.path, privacy: .public): \(error.localizedDescription, privacy: .public)"
                )
            }
        }

        if failures.isEmpty {
            logger.error(
                "No widget snapshot found. Tried: \(candidateFiles.map(\.path).joined(separator: ", "), privacy: .public)"
            )
        }
        return nil
    }
}

// MARK: - Helpers

public extension Color {
    /// Parses `#RRGGBB` / `#RGB` / `RRGGBB`; falls back to a neutral gray.
    init(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 {
            s = s.map { "\($0)\($0)" }.joined()
        }
        guard s.count == 6, let value = UInt64(s, radix: 16) else {
            self = Color(.sRGB, red: 0.56, green: 0.56, blue: 0.58, opacity: 1)
            return
        }
        let r = Double((value & 0xFF0000) >> 16) / 255
        let g = Double((value & 0x00FF00) >> 8) / 255
        let b = Double(value & 0x0000FF) / 255
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

public enum WidgetFormat {
    /// "13:05" style 24h label -> localized short time ("1:05 PM").
    public static func clock(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return hhmm }
        var comps = DateComponents()
        comps.hour = h
        comps.minute = m
        guard let date = Calendar.current.date(from: comps) else { return hhmm }
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: date)
    }

    public static func minutes(_ value: Int) -> String {
        if value < 60 { return "\(value)m" }
        let h = value / 60
        let m = value % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }

    public static func remaining(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let m = s / 60
        let sec = s % 60
        return String(format: "%d:%02d", m, sec)
    }

    /// Next block that hasn't ended yet, else the last block of the day.
    public static func nextBlock(in blocks: [WidgetBlock], now: Date = Date()) -> WidgetBlock? {
        let cal = Calendar.current
        let startOfDay = cal.startOfDay(for: now)
        func date(from hhmm: String) -> Date? {
            let parts = hhmm.split(separator: ":")
            guard parts.count >= 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
            return cal.date(byAdding: .minute, value: h * 60 + m, to: startOfDay)
        }
        if let next = blocks.first(where: { (date(from: $0.endTime) ?? .distantPast) > now }) {
            return next
        }
        return blocks.last
    }
}

// MARK: - Shared empty state

/// Shown when no snapshot could be read at all (the app has not published
/// yet, or the snapshot could not be located). Without this the widgets would
/// claim "nothing planned" — which is indistinguishable from a real bug.
public struct WidgetOfflineView: View {
    let message: String

    public init(message: String = "Open Control to publish data") {
        self.message = message
    }

    public var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Not connected")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
