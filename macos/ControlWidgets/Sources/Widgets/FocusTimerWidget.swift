import WidgetKit
import SwiftUI

/// Live focus / break timer with play state, cycle progress and the active task.
struct FocusTimerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ControlFocusTimer", provider: ControlProvider()) { entry in
            FocusTimerView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Focus Timer")
        .description("Your live session countdown, mode and cycle progress.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct FocusTimerView: View {
    let entry: ControlEntry

    var body: some View {
        if let state = entry.state {
            if state.session.active {
                activeSession(state.session)
            } else {
                idle(state.today.blocks)
            }
        } else {
            WidgetOfflineView()
        }
    }

    @ViewBuilder
    private func activeSession(_ session: WidgetSession) -> some View {
        let tint = Color(hexString: session.modeColor)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(tint).frame(width: 8, height: 8)
                Text(session.modeName.isEmpty ? "Control" : session.modeName)
                    .font(.caption).fontWeight(.semibold)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text(session.phaseLabel.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
            }

            timerText(session)
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            if session.totalCycles > 0 {
                Text("Cycle \(max(session.currentCycle, 1)) of \(session.totalCycles)")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let task = session.currentTask, !task.isEmpty {
                Text(task).font(.caption2).lineLimit(1).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func timerText(_ session: WidgetSession) -> some View {
        if session.isPaused {
            Text(WidgetFormat.remaining(session.remainingSeconds))
                .foregroundStyle(.secondary)
        } else if let endsAt = session.endsAt, endsAt > Date().timeIntervalSince1970 * 1000 {
            let target = Date(timeIntervalSince1970: endsAt / 1000)
            Text(timerInterval: Date()...target, countsDown: true)
        } else {
            Text(WidgetFormat.remaining(session.remainingSeconds))
        }
    }

    private func idle(_ blocks: [WidgetBlock]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "timer").font(.caption)
                Text("No active session").font(.caption).fontWeight(.semibold)
            }
            .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let next = WidgetFormat.nextBlock(in: blocks) {
                Text("Next").font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
                Text(next.title).font(.caption).fontWeight(.semibold).lineLimit(2)
                Text("\(WidgetFormat.clock(next.startTime)) – \(WidgetFormat.clock(next.endTime))")
                    .font(.caption2).foregroundStyle(.secondary)
            } else {
                Image(systemName: "checkmark.circle").font(.title2).foregroundStyle(.secondary)
                Text("Nothing planned").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
