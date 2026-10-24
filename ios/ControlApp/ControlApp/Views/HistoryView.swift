import SwiftUI
import SwiftData

struct HistoryView: View {
    @Query(sort: \ControlSession.startTime, order: .reverse) private var sessions: [ControlSession]
    
    var totalMinutes: Int {
        sessions.filter { $0.countTowardStats }.reduce(0) { $0 + $1.actualWorkMinutes }
    }
    
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Total Focus Time")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("\(totalMinutes / 60)h \(totalMinutes % 60)m")
                                .font(.title2)
                                .fontWeight(.bold)
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text("Sessions")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("\(sessions.count)")
                                .font(.title2)
                                .fontWeight(.bold)
                        }
                    }
                    .padding(.vertical, 8)
                }
                
                Section("Sessions") {
                    ForEach(sessions) { session in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(session.modeName)
                                    .font(.headline)
                                Spacer()
                                Text("\(session.actualWorkMinutes)m")
                                    .fontWeight(.semibold)
                            }
                            Text(session.startTime.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption)
                                .foregroundColor(.secondary)
                            if let tasksCompleted = session.tasksCompleted, tasksCompleted > 0 {
                                Text("\(tasksCompleted) task\(tasksCompleted == 1 ? "" : "s") completed")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("History")
        }
    }
}
