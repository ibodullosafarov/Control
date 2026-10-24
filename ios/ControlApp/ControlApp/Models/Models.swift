import Foundation
import SwiftData

@Model
final class ModeFolder {
    @Attribute(.unique) var id: String
    var name: String
    var createdAt: Date
    var color: String?
    var icon: String?
    
    @Relationship(deleteRule: .nullify) var modes: [StudyMode] = []
    
    init(id: String = UUID().uuidString, name: String, createdAt: Date = Date(), color: String? = nil, icon: String? = nil) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.color = color
        self.icon = icon
    }
}

@Model
final class NoteFolder {
    @Attribute(.unique) var id: String
    var name: String
    var modeId: String?
    var createdAt: Date
    var color: String?
    var icon: String?
    
    @Relationship(deleteRule: .cascade) var notes: [Note] = []
    
    init(id: String = UUID().uuidString, name: String, modeId: String? = nil, createdAt: Date = Date(), color: String? = nil, icon: String? = nil) {
        self.id = id
        self.name = name
        self.modeId = modeId
        self.createdAt = createdAt
        self.color = color
        self.icon = icon
    }
}

@Model
final class Note {
    @Attribute(.unique) var id: String
    var content: String
    var taskId: String?
    var taskTitle: String?
    var modeId: String?
    var modeName: String?
    var folderId: String?
    var createdAt: Date
    var updatedAt: Date
    
    var folder: NoteFolder?
    
    init(id: String = UUID().uuidString, content: String = "", taskId: String? = nil, taskTitle: String? = nil, modeId: String? = nil, modeName: String? = nil, folderId: String? = nil, createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.content = content
        self.taskId = taskId
        self.taskTitle = taskTitle
        self.modeId = modeId
        self.modeName = modeName
        self.folderId = folderId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct TaskReviewState: Codable {
    var intervalDays: Int
    var dueDay: String // YYYY-MM-DD
    var reps: Int
}

@Model
final class StudyMode {
    @Attribute(.unique) var id: String
    var name: String
    var modeDescription: String
    var icon: String
    var color: String
    var workDuration: Int // minutes
    var breakDuration: Int
    var cycles: Int
    var longBreakDuration: Int
    var longBreakInterval: Int
    var blocklist: [String]
    var blockedApps: [String]
    var allowlist: [String]
    var allowBreakWebsites: Bool
    var countTowardStats: Bool
    var isChillMode: Bool
    var blockingStrategy: BlockingStrategy
    var isDefault: Bool
    var order: Int
    var createdAt: Date
    var folderId: String?
    
    var folder: ModeFolder?
    
    init(id: String = UUID().uuidString, name: String, description: String = "", icon: String = "Brain", color: String = "#38bdf8", workDuration: Int = 52, breakDuration: Int = 10, cycles: Int = 3, longBreakDuration: Int = 20, longBreakInterval: Int = 3, blocklist: [String] = [], blockedApps: [String] = [], allowlist: [String] = [], allowBreakWebsites: Bool = false, countTowardStats: Bool = true, isChillMode: Bool = false, blockingStrategy: BlockingStrategy = .dynamicHosts, isDefault: Bool = false, order: Int = 0, createdAt: Date = Date(), folderId: String? = nil) {
        self.id = id
        self.name = name
        self.modeDescription = description
        self.icon = icon
        self.color = color
        self.workDuration = workDuration
        self.breakDuration = breakDuration
        self.cycles = cycles
        self.longBreakDuration = longBreakDuration
        self.longBreakInterval = longBreakInterval
        self.blocklist = blocklist
        self.blockedApps = blockedApps
        self.allowlist = allowlist
        self.allowBreakWebsites = allowBreakWebsites
        self.countTowardStats = countTowardStats
        self.isChillMode = isChillMode
        self.blockingStrategy = blockingStrategy
        self.isDefault = isDefault
        self.order = order
        self.createdAt = createdAt
        self.folderId = folderId
    }
}

@Model
final class TaskItem {
    @Attribute(.unique) var id: String
    var title: String
    var isCompleted: Bool
    var order: Int
    var modeId: String?
    var sessionId: String?
    var createdAt: Date
    var completedAt: Date?
    var cycles: Int?
    var cyclesCompleted: Int?
    var estimateMinutes: Int?
    var controlMinutes: Int?
    var targetCount: Int?
    var targetCountLabel: String?
    var doneCount: Int?
    var reviewData: Data? // encoded TaskReviewState
    var sourceRaw: String?
    var sourceId: String?
    
    var review: TaskReviewState? {
        get {
            guard let reviewData else { return nil }
            return try? JSONDecoder().decode(TaskReviewState.self, from: reviewData)
        }
        set {
            reviewData = try? JSONEncoder().encode(newValue)
        }
    }
    
    var source: TaskSource? {
        get { sourceRaw.flatMap { TaskSource(rawValue: $0) } }
        set { sourceRaw = newValue?.rawValue }
    }
    
    init(id: String = UUID().uuidString, title: String, isCompleted: Bool = false, order: Int = 0, modeId: String? = nil, sessionId: String? = nil, createdAt: Date = Date(), completedAt: Date? = nil, cycles: Int? = nil, cyclesCompleted: Int? = nil, estimateMinutes: Int? = nil, controlMinutes: Int? = nil, targetCount: Int? = nil, targetCountLabel: String? = nil, doneCount: Int? = nil, review: TaskReviewState? = nil, source: TaskSource? = nil, sourceId: String? = nil) {
        self.id = id
        self.title = title
        self.isCompleted = isCompleted
        self.order = order
        self.modeId = modeId
        self.sessionId = sessionId
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.cycles = cycles
        self.cyclesCompleted = cyclesCompleted
        self.estimateMinutes = estimateMinutes
        self.controlMinutes = controlMinutes
        self.targetCount = targetCount
        self.targetCountLabel = targetCountLabel
        self.doneCount = doneCount
        self.reviewData = try? JSONEncoder().encode(review)
        self.sourceRaw = source?.rawValue
        self.sourceId = sourceId
    }
}

@Model
final class ControlSession {
    @Attribute(.unique) var id: String
    var modeId: String
    var modeName: String
    var modeIcon: String
    var isChillMode: Bool
    var startTime: Date
    var endTime: Date
    var plannedWorkMinutes: Int
    var actualWorkMinutes: Int
    var plannedCycles: Int
    var completedCycles: Int
    var status: String // completed/cancelled/paused
    var notes: String?
    var countTowardStats: Bool
    var tasksTotal: Int?
    var tasksCompleted: Int?
    var taskTitles: [String]?
    var completedTaskTitles: [String]?
    var taskIds: [String]?
    var wallMinutes: Int?
    var pauseMinutes: Int?
    var skippedPhases: Int?
    var finishedEarly: Bool?
    var skipReason: String?
    
    init(id: String = UUID().uuidString, modeId: String, modeName: String, modeIcon: String = "Brain", isChillMode: Bool = false, startTime: Date = Date(), endTime: Date = Date(), plannedWorkMinutes: Int = 0, actualWorkMinutes: Int = 0, plannedCycles: Int = 1, completedCycles: Int = 0, status: String = "completed", notes: String? = nil, countTowardStats: Bool = true, tasksTotal: Int? = nil, tasksCompleted: Int? = nil, taskTitles: [String]? = nil, completedTaskTitles: [String]? = nil, taskIds: [String]? = nil, wallMinutes: Int? = nil, pauseMinutes: Int? = nil, skippedPhases: Int? = nil, finishedEarly: Bool? = nil, skipReason: String? = nil) {
        self.id = id
        self.modeId = modeId
        self.modeName = modeName
        self.modeIcon = modeIcon
        self.isChillMode = isChillMode
        self.startTime = startTime
        self.endTime = endTime
        self.plannedWorkMinutes = plannedWorkMinutes
        self.actualWorkMinutes = actualWorkMinutes
        self.plannedCycles = plannedCycles
        self.completedCycles = completedCycles
        self.status = status
        self.notes = notes
        self.countTowardStats = countTowardStats
        self.tasksTotal = tasksTotal
        self.tasksCompleted = tasksCompleted
        self.taskTitles = taskTitles
        self.completedTaskTitles = completedTaskTitles
        self.taskIds = taskIds
        self.wallMinutes = wallMinutes
        self.pauseMinutes = pauseMinutes
        self.skippedPhases = skippedPhases
        self.finishedEarly = finishedEarly
        self.skipReason = skipReason
    }
}

@Model
final class ActiveSession {
    @Attribute(.unique) var id: String
    var modeId: String
    var modeName: String
    var modeIcon: String
    var modeColor: String
    var isChillMode: Bool
    var workDurationMins: Int
    var breakDurationMins: Int
    var totalCycles: Int
    var currentCycle: Int
    var phaseRaw: String
    var phaseStartTime: Date
    var phaseDurationSeconds: Int
    var accumulatedWorkSeconds: Int
    var completedCyclesCount: Int
    var isPaused: Bool
    var pauseStartedAt: Date?
    var totalPauseSecondsThisPhase: Int
    var totalPauseSecondsAllPhases: Int
    var transitioning: Bool
    var taskIds: [String]
    var activeTaskId: String?
    var completedTaskIds: [String]
    var blocklist: [String]
    var blockedApps: [String]
    var blockingStrategyRaw: String
    var blockingOverride: Bool?
    var countTowardStats: Bool
    var allowBreakWebsites: Bool?
    var startedAt: Date
    var longBreakDurationMins: Int?
    var longBreakInterval: Int?
    var taskDwellSecondsData: Data?
    var taskCycleOffsetsData: Data?
    var sourceBlockId: String?
    var sourceBlockDate: String?
    
    var phase: SessionPhase {
        get { SessionPhase(rawValue: phaseRaw) ?? .idle }
        set { phaseRaw = newValue.rawValue }
    }
    
    var blockingStrategy: BlockingStrategy {
        get { BlockingStrategy(rawValue: blockingStrategyRaw) ?? .none }
        set { blockingStrategyRaw = newValue.rawValue }
    }
    
    var taskDwellSeconds: [String: Int] {
        get {
            guard let taskDwellSecondsData else { return [:] }
            return (try? JSONDecoder().decode([String: Int].self, from: taskDwellSecondsData)) ?? [:]
        }
        set {
            taskDwellSecondsData = try? JSONEncoder().encode(newValue)
        }
    }
    
    var taskCycleOffsets: [String: Int] {
        get {
            guard let taskCycleOffsetsData else { return [:] }
            return (try? JSONDecoder().decode([String: Int].self, from: taskCycleOffsetsData)) ?? [:]
        }
        set {
            taskCycleOffsetsData = try? JSONEncoder().encode(newValue)
        }
    }
    
    init(id: String = UUID().uuidString, modeId: String, modeName: String, modeIcon: String = "Brain", modeColor: String = "#38bdf8", isChillMode: Bool = false, workDurationMins: Int = 52, breakDurationMins: Int = 10, totalCycles: Int = 3, currentCycle: Int = 1, phase: SessionPhase = .work, phaseStartTime: Date = Date(), phaseDurationSeconds: Int = 0, accumulatedWorkSeconds: Int = 0, completedCyclesCount: Int = 0, isPaused: Bool = false, pauseStartedAt: Date? = nil, totalPauseSecondsThisPhase: Int = 0, totalPauseSecondsAllPhases: Int = 0, transitioning: Bool = false, taskIds: [String] = [], activeTaskId: String? = nil, completedTaskIds: [String] = [], blocklist: [String] = [], blockedApps: [String] = [], blockingStrategy: BlockingStrategy = .dynamicHosts, blockingOverride: Bool? = nil, countTowardStats: Bool = true, allowBreakWebsites: Bool? = nil, startedAt: Date = Date(), longBreakDurationMins: Int? = nil, longBreakInterval: Int? = nil, taskDwellSeconds: [String: Int] = [:], taskCycleOffsets: [String: Int] = [:], sourceBlockId: String? = nil, sourceBlockDate: String? = nil) {
        self.id = id
        self.modeId = modeId
        self.modeName = modeName
        self.modeIcon = modeIcon
        self.modeColor = modeColor
        self.isChillMode = isChillMode
        self.workDurationMins = workDurationMins
        self.breakDurationMins = breakDurationMins
        self.totalCycles = totalCycles
        self.currentCycle = currentCycle
        self.phaseRaw = phase.rawValue
        self.phaseStartTime = phaseStartTime
        self.phaseDurationSeconds = phaseDurationSeconds
        self.accumulatedWorkSeconds = accumulatedWorkSeconds
        self.completedCyclesCount = completedCyclesCount
        self.isPaused = isPaused
        self.pauseStartedAt = pauseStartedAt
        self.totalPauseSecondsThisPhase = totalPauseSecondsThisPhase
        self.totalPauseSecondsAllPhases = totalPauseSecondsAllPhases
        self.transitioning = transitioning
        self.taskIds = taskIds
        self.activeTaskId = activeTaskId
        self.completedTaskIds = completedTaskIds
        self.blocklist = blocklist
        self.blockedApps = blockedApps
        self.blockingStrategyRaw = blockingStrategy.rawValue
        self.blockingOverride = blockingOverride
        self.countTowardStats = countTowardStats
        self.allowBreakWebsites = allowBreakWebsites
        self.startedAt = startedAt
        self.longBreakDurationMins = longBreakDurationMins
        self.longBreakInterval = longBreakInterval
        self.taskDwellSecondsData = try? JSONEncoder().encode(taskDwellSeconds)
        self.taskCycleOffsetsData = try? JSONEncoder().encode(taskCycleOffsets)
        self.sourceBlockId = sourceBlockId
        self.sourceBlockDate = sourceBlockDate
    }
}

@Model
final class AppSettings {
    var userName: String?
    var setupCompleted: Bool = false
    var themeRaw: String = ThemeId.serika.rawValue
    var soundEnabled: Bool = true
    var soundVolume: Double = 0.7
    var launchAtLogin: Bool = true
    var autoStartBreaks: Bool = true
    var autoStartWork: Bool = false
    var defaultModeId: String = ""
    var blockingEnabled: Bool = true
    var blockingStrategyRaw: String = BlockingStrategy.dynamicHosts.rawValue
    var dailyGoalMinutes: Int = 120
    var activityTrackingEnabled: Bool = false
    var minimalModeOnControl: Bool = true
    var reducedMotion: Bool = false
    var dyslexicFont: Bool = false
    
    var theme: ThemeId {
        get { ThemeId(rawValue: themeRaw) ?? .serika }
        set { themeRaw = newValue.rawValue }
    }
    
    var blockingStrategy: BlockingStrategy {
        get { BlockingStrategy(rawValue: blockingStrategyRaw) ?? .dynamicHosts }
        set { blockingStrategyRaw = newValue.rawValue }
    }
    
    init() {}
}
