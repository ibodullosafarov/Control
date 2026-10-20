import SwiftUI
import WidgetKit

@main
struct ControlWidgetsApp: App {
    var body: some Scene {
        WindowGroup("Control Widgets") {
            HostView()
        }
        .windowResizability(.contentSize)
    }
}

struct HostView: View {
    @State private var state: WidgetState?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "square.grid.2x2")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Control Widgets").font(.headline)
                    Text("Live timer · Today's plan · Stats · Quick note")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            Divider()

            if let state {
                VStack(alignment: .leading, spacing: 6) {
                    Label(state.session.active
                          ? "\(state.session.modeName) — \(state.session.phaseLabel)"
                          : "No active session",
                          systemImage: state.session.active ? "timer" : "moon.zzz")
                    Label("\(state.stats.focusMinutesToday) min focused · \(state.stats.cyclesToday) cycles today",
                          systemImage: "chart.bar")
                    Label("\(state.today.blocks.count) planned block\(state.today.blocks.count == 1 ? "" : "s") today",
                          systemImage: "calendar")
                }
                .font(.callout)
                Text("Updated \(state.updatedAt)")
                    .font(.caption2).foregroundStyle(.tertiary)
            } else {
                Text("No snapshot yet — open Control once so it can publish widget data.")
                    .font(.callout).foregroundStyle(.secondary)
            }

            Divider()

            Text("To add: right-click the desktop → Edit Widgets… (or open Notification Center) and search “Control”. Keep the Control app running so the snapshot stays fresh.")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Button("Reload Widgets") {
                    WidgetCenter.shared.reloadAllTimelines()
                    state = WidgetStore.load()
                }
                Button("Open Widget Gallery") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.Desktop-Settings.extension") {
                        NSWorkspace.shared.open(url)
                    }
                }
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(18)
        .frame(width: 420)
        .onAppear { state = WidgetStore.load() }
    }
}
