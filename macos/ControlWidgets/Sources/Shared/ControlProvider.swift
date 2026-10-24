import WidgetKit
import SwiftUI

/// One entry type and provider shared by every Control widget.
public struct ControlEntry: TimelineEntry {
    public let date: Date
    public let state: WidgetState?
}

public struct ControlProvider: TimelineProvider {
    /// How often WidgetKit asks us for a fresh snapshot.
    ///
    /// WidgetKit does not push updates to extensions — the system suspends the
    /// extension process as soon as a timeline has been produced, so an
    /// in-process file watcher would never run. The timeline refresh is the
    /// only reliable refresh mechanism, and it is what keeps the widgets in
    /// sync with the app (which republishes the snapshot every 15s).
    ///
    /// The live countdown in the focus widget keeps ticking on its own via
    /// `Text(timerInterval:)`, so it does not need a re-render to stay live.
    public static let refreshInterval: TimeInterval = 60

    public init() {}

    public func placeholder(in context: Context) -> ControlEntry {
        ControlEntry(date: Date(), state: nil)
    }

    public func getSnapshot(in context: Context, completion: @escaping (ControlEntry) -> Void) {
        completion(ControlEntry(date: Date(), state: WidgetStore.load()))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<ControlEntry>) -> Void) {
        let entry = ControlEntry(date: Date(), state: WidgetStore.load())
        let next = Date().addingTimeInterval(Self.refreshInterval)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
