import ActivityKit
import WidgetKit
import SwiftUI

struct ControlLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ControlActivityAttributes.self) { context in
            // Lock screen/banner UI
            VStack {
                HStack {
                    Text(context.attributes.modeName)
                        .font(.headline)
                    Spacer()
                    Text("\(context.state.currentCycle)/\(context.state.totalCycles)")
                        .font(.caption)
                }
                Text(formatTime(context.state.timeRemaining))
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                Text(context.state.phase)
                    .font(.caption)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.modeName)
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.currentCycle)/\(context.state.totalCycles)")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(formatTime(context.state.timeRemaining))
                        .font(.title2)
                        .fontWeight(.bold)
                }
            } compactLeading: {
                Text("🎯")
            } compactTrailing: {
                Text(formatTime(context.state.timeRemaining))
                    .font(.caption2)
            } minimal: {
                Text("🎯")
            }
        }
    }
}

func formatTime(_ seconds: Int) -> String {
    let mins = seconds / 60
    let secs = seconds % 60
    return String(format: "%02d:%02d", mins, secs)
}
