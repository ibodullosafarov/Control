import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var modes: [StudyMode]
    @Query(sort: \TaskItem.order) private var tasks: [TaskItem]
    @Query private var activeSessions: [ActiveSession]
    @Query private var settings: [AppSettings]
    
    @StateObject private var timerManager = TimerManager.shared
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            TasksView()
                .tabItem {
                    Label("Tasks", systemImage: "checklist")
                }
                .tag(0)
            
            TimerView()
                .tabItem {
                    Label("Timer", systemImage: "timer")
                }
                .tag(1)
            
            ModesView()
                .tabItem {
                    Label("Modes", systemImage: "brain.head.profile")
                }
                .tag(2)
            
            HistoryView()
                .tabItem {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                .tag(3)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
                .tag(4)
        }
        .onAppear {
            timerManager.setModelContext(modelContext)
            if let active = activeSessions.first {
                timerManager.activeSession = active
                timerManager.isRunning = true
                timerManager.startTimer()
                // Calculate remaining time
                let now = Date()
                let elapsed = Int(now.timeIntervalSince(active.phaseStartTime)) - active.totalPauseSecondsThisPhase
                timerManager.timeRemaining = max(0, active.phaseDurationSeconds - elapsed)
            }
            setupDefaultData()
        }
    }
    
    private func setupDefaultData() {
        if modes.isEmpty {
            let defaultModes = [
                StudyMode(id: "mode-deep-work", name: "Deep Work", description: "Long, uninterrupted control sessions for complex deep problem solving", icon: "Brain", color: "#38bdf8", workDuration: 52, breakDuration: 10, cycles: 3, longBreakDuration: 20, longBreakInterval: 3, blocklist: ["youtube.com", "twitter.com", "x.com", "reddit.com", "instagram.com", "tiktok.com"], blockedApps: ["Discord", "Slack"], allowBreakWebsites: false, isDefault: true, order: 0),
                StudyMode(id: "mode-study", name: "Study", description: "Academic and curriculum control", icon: "BookOpen", color: "#10b981", workDuration: 45, breakDuration: 10, cycles: 3, longBreakDuration: 20, longBreakInterval: 3, blocklist: ["youtube.com", "twitter.com", "x.com", "reddit.com"], blockedApps: ["Discord", "Slack"], allowBreakWebsites: true, order: 1),
                StudyMode(id: "mode-chill", name: "Chill / Free Time", description: "Deliberate leisure & decompression", icon: "Coffee", color: "#f43f5e", workDuration: 30, breakDuration: 0, cycles: 1, longBreakDuration: 0, longBreakInterval: 1, blocklist: [], blockedApps: [], allowBreakWebsites: true, countTowardStats: false, isChillMode: true, blockingStrategy: .none, order: 4)
            ]
            for mode in defaultModes {
                modelContext.insert(mode)
            }
        }
        if settings.isEmpty {
            let appSettings = AppSettings()
            appSettings.defaultModeId = modes.first?.id ?? "mode-deep-work"
            modelContext.insert(appSettings)
        }
        try? modelContext.save()
    }
}
