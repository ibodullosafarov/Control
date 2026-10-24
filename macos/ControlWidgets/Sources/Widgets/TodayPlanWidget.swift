import WidgetKit
import SwiftUI

/// Today's planned blocks with the next one highlighted.
struct TodayPlanWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ControlTodayPlan", provider: ControlProvider()) { entry in
            TodayPlanView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's Plan")
        .description("Your remaining planned blocks and what's next up.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct TodayPlanView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ControlEntry

    var body: some View {
        if let state = entry.state {
            content(state.today.blocks)
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder
    private func content(_ blocks: [WidgetBlock]) -> some View {
        if blocks.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "calendar").font(.title2).foregroundStyle(.secondary)
                Text("Nothing planned today").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Today").font(.caption).fontWeight(.bold)
                    Spacer()
                    Text("\(blocks.count) block\(blocks.count == 1 ? "" : "s")")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                let limit = family == .systemSmall ? 2 : (family == .systemMedium ? 3 : 6)
                let next = WidgetFormat.nextBlock(in: blocks)
                ForEach(Array(blocks.prefix(limit))) { block in
                    row(block, isNext: block.id == next?.id)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func row(_ block: WidgetBlock, isNext: Bool) -> some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hexString: block.color))
                .frame(width: 3, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(block.title)
                    .font(.caption).fontWeight(isNext ? .bold : .regular)
                    .lineLimit(1)
                Text("\(WidgetFormat.clock(block.startTime)) – \(WidgetFormat.clock(block.endTime))")
                    .font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if isNext {
                Text("NEXT")
                    .font(.system(size: 8, weight: .heavy))
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(Color(hexString: block.color).opacity(0.2))
                    .clipShape(Capsule())
            }
        }
    }
}
