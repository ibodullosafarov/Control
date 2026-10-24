import SwiftUI
import SwiftData

struct SettingsView: View {
    @Query private var settings: [AppSettings]
    @Query private var modes: [StudyMode]
    
    var appSettings: AppSettings? {
        settings.first
    }
    
    var body: some View {
        NavigationStack {
            List {
                Section("General") {
                    HStack {
                        Text("Sound")
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { appSettings?.soundEnabled ?? true },
                            set: { appSettings?.soundEnabled = $0; try? modelContext.save() }
                        ))
                    }
                }
                
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("App")
                        Spacer()
                        Text("Control for iOS")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section {
                    Text("Focus timer with tasks, modes, and session tracking")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
    
    @Environment(\.modelContext) private var modelContext
}
