import SwiftUI
import SwiftData

struct TimerView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var modes: [StudyMode]
    @Query(sort: \TaskItem.order) private var tasks: [TaskItem]
    @StateObject private var timerManager = TimerManager.shared
    
    @State private var selectedMode: StudyMode?
    @State private var selectedTasks: Set<String> = []
    @State private var cycleCount: Int = 3
    
    var body: some View {
        NavigationStack {
            if let session = timerManager.activeSession {
                ActiveSessionView(session: session)
            } else {
                VStack(spacing: 24) {
                    Text("Start Control Session")
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    // Mode Selection
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(modes.sorted(by: { $0.order < $1.order })) { mode in
                                ModeCard(mode: mode, isSelected: selectedMode?.id == mode.id)
                                    .onTapGesture {
                                        selectedMode = mode
                                        cycleCount = mode.cycles
                                    }
                            }
                        }
                        .padding(.horizontal)
                    }
                    
                    // Task Selection
                    if !tasks.filter({ !$0.isCompleted }).isEmpty {
                        VStack(alignment: .leading) {
                            Text("Tasks")
                                .font(.headline)
                                .padding(.horizontal)
                            
                            ForEach(tasks.filter { !$0.isCompleted }) { task in
                                HStack {
                                    Image(systemName: selectedTasks.contains(task.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundColor(selectedTasks.contains(task.id) ? .blue : .gray)
                                    Text(task.title)
                                    Spacer()
                                }
                                .padding(.horizontal)
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    if selectedTasks.contains(task.id) {
                                        selectedTasks.remove(task.id)
                                    } else {
                                        selectedTasks.insert(task.id)
                                    }
                                }
                            }
                        }
                    }
                    
                    // Cycle Count
                    if let mode = selectedMode, !mode.isChillMode {
                        VStack {
                            Text("Cycles: \(cycleCount)")
                                .font(.headline)
                            Stepper("", value: $cycleCount, in: 1...12)
                                .labelsHidden()
                        }
                    }
                    
                    Spacer()
                    
                    Button {
                        startSession()
                    } label: {
                        Text("Start Session")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(selectedMode != nil ? Color.blue : Color.gray)
                            .cornerRadius(12)
                    }
                    .disabled(selectedMode == nil)
                    .padding()
                }
                .navigationTitle("Timer")
            }
        }
        .onAppear {
            if selectedMode == nil {
                selectedMode = modes.first { $0.isDefault } ?? modes.first
                if let mode = selectedMode {
                    cycleCount = mode.cycles
                }
            }
        }
    }
    
    private func startSession() {
        guard let mode = selectedMode else { return }
        let selectedTaskItems = tasks.filter { selectedTasks.contains($0.id) }
        timerManager.startSession(mode: mode, tasks: selectedTaskItems, cycleCount: cycleCount)
    }
}

struct ModeCard: View {
    let mode: StudyMode
    let isSelected: Bool
    
    var body: some View {
        VStack {
            Image(systemName: iconName)
                .font(.title)
                .foregroundColor(Color(hex: mode.color))
            Text(mode.name)
                .font(.caption)
                .fontWeight(.medium)
            Text("\(mode.workDuration)m")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(width: 80, height: 80)
        .background(isSelected ? Color(hex: mode.color).opacity(0.2) : Color.gray.opacity(0.1))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? Color(hex: mode.color) : Color.clear, lineWidth: 2)
        )
    }
    
    var iconName: String {
        switch mode.icon {
        case "Brain": return "brain.head.profile"
        case "BookOpen": return "book"
        case "Target": return "target"
        case "Trophy": return "trophy"
        case "Coffee": return "cup.and.saucer"
        default: return "brain.head.profile"
        }
    }
}

struct ActiveSessionView: View {
    @Bindable var session: ActiveSession
    @StateObject private var timerManager = TimerManager.shared
    
    var body: some View {
        VStack(spacing: 32) {
            VStack {
                Text(session.modeName)
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(Color(hex: session.modeColor))
                
                Text(session.phase == .work ? "Focus" : (session.phase == .shortBreak || session.phase == .longBreak ? "Break" : "Chill"))
                    .font(.headline)
                    .foregroundColor(.secondary)
            }
            
            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.2), lineWidth: 20)
                    .frame(width: 250, height: 250)
                
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color(hex: session.modeColor), style: StrokeStyle(lineWidth: 20, lineCap: .round))
                    .frame(width: 250, height: 250)
                    .rotationEffect(.degrees(-90))
                    .animation(.linear, value: progress)
                
                VStack {
                    Text(formatTime(timerManager.timeRemaining))
                        .font(.system(size: 48, weight: .bold, design: .monospaced))
                    Text("Cycle \(session.completedCyclesCount + 1)/\(session.totalCycles)")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            
            HStack(spacing: 40) {
                Button {
                    if session.isPaused {
                        timerManager.resumeSession()
                    } else {
                        timerManager.pauseSession()
                    }
                } label: {
                    Image(systemName: session.isPaused ? "play.fill" : "pause.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 70, height: 70)
                        .background(Color(hex: session.modeColor))
                        .clipShape(Circle())
                }
                
                Button {
                    timerManager.completePhase()
                } label: {
                    Image(systemName: "forward.fill")
                        .font(.title)
                        .foregroundColor(.white)
                        .frame(width: 70, height: 70)
                        .background(Color.gray)
                        .clipShape(Circle())
                }
            }
            
            Spacer()
        }
        .padding()
        .navigationBarBackButtonHidden()
    }
    
    var progress: Double {
        guard session.phaseDurationSeconds > 0 else { return 0 }
        return Double(session.phaseDurationSeconds - timerManager.timeRemaining) / Double(session.phaseDurationSeconds)
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
