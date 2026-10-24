import WidgetKit
import SwiftUI

/// The most recent quick note.
struct QuickNoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ControlQuickNote", provider: ControlProvider()) { entry in
            QuickNoteView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick Note")
        .description("Your latest captured note, always one glance away.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct QuickNoteView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ControlEntry

    var body: some View {
        if let state = entry.state {
            content(state.note)
        } else {
            WidgetOfflineView()
        }
    }

    private func content(_ note: WidgetNote?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "note.text").font(.caption)
                Text("Latest Note").font(.caption).fontWeight(.bold)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.secondary)

            if let note, !note.text.isEmpty {
                if let task = note.taskTitle, !task.isEmpty {
                    Text(task).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(note.text)
                    .font(.callout)
                    .lineLimit(family == .systemSmall ? 4 : (family == .systemMedium ? 5 : 10))
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            } else {
                Spacer(minLength: 0)
                Text("No notes yet")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
