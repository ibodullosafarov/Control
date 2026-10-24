import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let entry = SimpleEntry(date: Date())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entries: [SimpleEntry] = [SimpleEntry(date: Date())]
        let timeline = Timeline(entries: entries, policy: .atEnd)
        completion(timeline)
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
}

struct ControlWidgetEntryView : View {
    var entry: Provider.Entry

    var body: some View {
        VStack {
            Text("Control")
                .font(.headline)
            Text("Focus Timer")
                .font(.caption)
        }
    }
}

struct ControlWidget: Widget {
    let kind: String = "ControlWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                ControlWidgetEntryView(entry: entry)
                    .containerBackground(.fill.tertiary, for: .widget)
            } else {
                ControlWidgetEntryView(entry: entry)
                    .padding()
                    .background()
            }
        }
        .configurationDisplayName("Control")
        .description("Quick access to your focus timer")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct ControlWidgetBundle: WidgetBundle {
    @main
    var body: some Widget {
        ControlWidget()
    }
}
