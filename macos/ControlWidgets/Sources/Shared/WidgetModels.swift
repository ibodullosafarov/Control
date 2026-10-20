import Foundation
import SwiftUI

// MARK: - Codable snapshot (mirrors electron/widgetBridge.ts)

public struct WidgetState: Codable {
    public var schemaVersion: Int
    public var updatedAt: String
    public var name: String
    public var session: WidgetSession
    public var today: WidgetToday
    public var stats: WidgetStats
    public var note: WidgetNote?
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
}

public struct WidgetToday: Codable {
    public var date: String
    public var blocks: [WidgetBlock]
}

public struct WidgetBlock: Codable, Identifiable {
    public var id: String
    public var title: String
    public var startTime: String
    public var endTime: String
    public var modeName: String
    public var color: String
    public var status: String
}

public struct WidgetStats: Codable {
    public var focusMinutesToday: Int
    public var cyclesToday: Int
    public var sessionsToday: Int
    public var streakDays: Int
}

public struct WidgetNote: Codable {
    public var text: String
    public var updatedAt: String
    public var taskTitle: String?
}

// MARK: - Reader

/// Reads the snapshot the app publishes to `~/.control-app/widget-state.json`.
/// The widget extension is intentionally unsandboxed so it can read the shared
/// path without an App Group (which would require a paid signing team).
public enum WidgetStore {
    public static let stateFile: URL = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".control-app/widget-state.json")

    public static func load() -> WidgetState? {
        guard let data = try? Data(contentsOf: stateFile) else { return nil }
        return try? JSONDecoder().decode(WidgetState.self, from: data)
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
