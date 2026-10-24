import WidgetKit
import SwiftUI

/// Focus minutes, cycles and streak for today.
struct QuickStatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ControlQuickStats", provider: ControlProvider()) { entry in
            QuickStatsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick Stats")
        .description("Focused time, cycles completed and your current streak.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct QuickStatsView: View {
    let entry: ControlEntry

    var body: some View {
        if let state = entry.state {
            content(state.stats)
        } else {
            WidgetOfflineView()
        }
    }

    private func content(_ stats: WidgetStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "chart.bar.fill").font(.caption)
                Text("Today").font(.caption).fontWeight(.bold)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.secondary)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(stats.focusMinutesToday)")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6).lineLimit(1)
                Text("min").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.top, -2)

            HStack(spacing: 12) {
                stat("Cycles", "\(stats.cyclesToday)")
                stat("Sessions", "\(stats.sessionsToday)")
                stat("Streak", "\(stats.streakDays)d")
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.callout).fontWeight(.semibold)
            Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }
}
