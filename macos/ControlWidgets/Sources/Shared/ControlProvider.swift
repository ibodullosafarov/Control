import WidgetKit
import SwiftUI

/// One entry type and provider shared by every Control widget.
public struct ControlEntry: TimelineEntry {
    public let date: Date
    public let state: WidgetState?
}

public struct ControlProvider: TimelineProvider {
    public init() {}

    public func placeholder(in context: Context) -> ControlEntry {
        ControlEntry(date: Date(), state: nil)
    }

    public func getSnapshot(in context: Context, completion: @escaping (ControlEntry) -> Void) {
        completion(ControlEntry(date: Date(), state: WidgetStore.load()))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<ControlEntry>) -> Void) {
        let entry = ControlEntry(date: Date(), state: WidgetStore.load())
        // Live countdowns self-update via Text(timerInterval:), so a modest
        // poll keeps the rest (plan, stats, note) fresh without hammering.
        let next = Calendar.current.date(byAdding: .minute, value: 5, to: Date())
            ?? Date().addingTimeInterval(300)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
