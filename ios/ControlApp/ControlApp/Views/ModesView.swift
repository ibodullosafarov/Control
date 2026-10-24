import SwiftUI
import SwiftData

struct ModesView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \StudyMode.order) private var modes: [StudyMode]
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(modes) { mode in
                    HStack {
                        Image(systemName: modeIconName(mode.icon))
                            .foregroundColor(Color(hex: mode.color))
                            .frame(width: 30)
                        VStack(alignment: .leading) {
                            Text(mode.name)
                                .font(.headline)
                            Text("\(mode.workDuration)m work / \(mode.breakDuration)m break • \(mode.cycles) cycles")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        if mode.isDefault {
                            Text("Default")
                                .font(.caption)
                                .foregroundColor(.blue)
                        }
                    }
                }
            }
            .navigationTitle("Modes")
        }
    }
    
    func modeIconName(_ icon: String) -> String {
        switch icon {
        case "Brain": return "brain.head.profile"
        case "BookOpen": return "book"
        case "Target": return "target"
        case "Trophy": return "trophy"
        case "Coffee": return "cup.and.saucer"
        default: return "brain.head.profile"
        }
    }
}
