import Foundation
import SwiftData
import ActivityKit

@MainActor
class TimerManager: ObservableObject {
    static let shared = TimerManager()
    
    @Published var activeSession: ActiveSession?
    @Published var timeRemaining: Int = 0
    @Published var isRunning: Bool = false
    
    private var timer: Timer?
    private var modelContext: ModelContext?
    
    func setModelContext(_ context: ModelContext) {
        self.modelContext = context
    }
    
    func startSession(mode: StudyMode, tasks: [TaskItem], cycleCount: Int) {
        let workSecs = mode.workDuration * 60
        let breakSecs = mode.breakDuration * 60
        
        let session = ActiveSession(
            modeId: mode.id,
            modeName: mode.name,
            modeIcon: mode.icon,
            modeColor: mode.color,
            isChillMode: mode.isChillMode,
            workDurationMins: mode.workDuration,
            breakDurationMins: mode.breakDuration,
            totalCycles: cycleCount,
            currentCycle: 1,
            phase: .work,
            phaseStartTime: Date(),
            phaseDurationSeconds: workSecs,
            accumulatedWorkSeconds: 0,
            completedCyclesCount: 0,
            isPaused: false,
            taskIds: tasks.map { $0.id },
            activeTaskId: tasks.first?.id,
            completedTaskIds: [],
            blocklist: mode.blocklist,
            blockedApps: mode.blockedApps,
            blockingStrategy: mode.blockingStrategy,
            countTowardStats: mode.countTowardStats,
            allowBreakWebsites: mode.allowBreakWebsites,
            startedAt: Date(),
            longBreakDurationMins: mode.longBreakDuration,
            longBreakInterval: mode.longBreakInterval
        )
        
        modelContext?.insert(session)
        try? modelContext?.save()
        
        activeSession = session
        timeRemaining = workSecs
        isRunning = true
        startTimer()
        SoundService.shared.playChime()
    }
    
    func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
    }
    
    func tick() {
        guard let session = activeSession, !session.isPaused else { return }
        
        let now = Date()
        let elapsed = Int(now.timeIntervalSince(session.phaseStartTime)) - session.totalPauseSecondsThisPhase
        timeRemaining = max(0, session.phaseDurationSeconds - elapsed)
        
        if timeRemaining == 0 {
            completePhase()
        }
    }
    
    func completePhase() {
        guard let session = activeSession else { return }
        
        if session.phase == .work {
            session.accumulatedWorkSeconds += session.phaseDurationSeconds
            
            let completion = resolveWorkCompletion(completedCyclesCount: session.completedCyclesCount, totalCycles: session.totalCycles)
            
            if completion == .complete {
                completeSession()
            } else {
                // Move to break
                session.completedCyclesCount += 1
                session.currentCycle = session.completedCyclesCount + 1
                
                let isLongBreak = session.longBreakInterval > 0 && session.longBreakDurationMins ?? 0 > 0 && session.completedCyclesCount % session.longBreakInterval == 0
                let breakSecs = isLongBreak ? (session.longBreakDurationMins ?? 0) * 60 : session.breakDurationMins * 60
                
                session.phase = breakSecs > 0 ? .shortBreak : .work
                session.phaseStartTime = Date()
                session.phaseDurationSeconds = breakSecs
                session.totalPauseSecondsThisPhase = 0
                session.pauseStartedAt = nil
                
                timeRemaining = breakSecs
                SoundService.shared.playBreakStart()
                NotificationService.shared.schedulePhaseCompleteNotification(phase: .work, nextPhase: breakSecs > 0 ? "break" : "work")
                
                if breakSecs == 0 {
                    // Skip break, go straight to next work
                    completePhase()
                    return
                }
            }
        } else if session.phase == .shortBreak || session.phase == .longBreak {
            // Break complete, start next work
            session.phase = .work
            session.phaseStartTime = Date()
            session.phaseDurationSeconds = session.workDurationMins * 60
            session.totalPauseSecondsThisPhase = 0
            session.pauseStartedAt = nil
            
            timeRemaining = session.workDurationMins * 60
            SoundService.shared.playChime()
            NotificationService.shared.schedulePhaseCompleteNotification(phase: .shortBreak, nextPhase: "work")
        }
        
        try? modelContext?.save()
    }
    
    func completeSession() {
        guard let session = activeSession, let modelContext else { return }
        
        let completedSession = ControlSession(
            modeId: session.modeId,
            modeName: session.modeName,
            modeIcon: session.modeIcon,
            isChillMode: session.isChillMode,
            startTime: session.startedAt,
            endTime: Date(),
            plannedWorkMinutes: session.totalCycles * session.workDurationMins,
            actualWorkMinutes: session.accumulatedWorkSeconds / 60,
            plannedCycles: session.totalCycles,
            completedCycles: session.completedCyclesCount,
            status: "completed",
            countTowardStats: session.countTowardStats,
            tasksTotal: session.taskIds.count,
            tasksCompleted: session.completedTaskIds.count,
            taskIds: session.taskIds
        )
        
        modelContext.insert(completedSession)
        modelContext.delete(session)
        try? modelContext?.save()
        
        stopTimer()
        activeSession = nil
        SoundService.shared.playComplete()
    }
    
    func pauseSession() {
        guard let session = activeSession else { return }
        if !session.isPaused {
            session.isPaused = true
            session.pauseStartedAt = Date()
        }
    }
    
    func resumeSession() {
        guard let session = activeSession, session.isPaused, let pauseStarted = session.pauseStartedAt else { return }
        let pauseDuration = Int(Date().timeIntervalSince(pauseStarted))
        session.totalPauseSecondsThisPhase += pauseDuration
        session.totalPauseSecondsAllPhases += pauseDuration
        session.isPaused = false
        session.pauseStartedAt = nil
        try? modelContext?.save()
    }
    
    func stopTimer() {
        timer?.invalidate()
        timer = nil
        isRunning = false
    }
}
