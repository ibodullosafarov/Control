import SwiftUI
import SwiftData

@main
struct ControlApp: App {
    let modelContainer: ModelContainer
    
    init() {
        do {
            let schema = Schema([
                ModeFolder.self,
                NoteFolder.self,
                Note.self,
                StudyMode.self,
                TaskItem.self,
                ControlSession.self,
                ActiveSession.self,
                AppSettings.self
            ])
            let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false, cloudKitDatabase: .automatic)
            modelContainer = try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
        
        NotificationService.shared.requestPermission()
    }
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .modelContainer(modelContainer)
        }
    }
}
