import Foundation

enum WorkCompletion {
    case complete
    case break_
}

func resolveWorkCompletion(completedCyclesCount: Int, totalCycles: Int) -> WorkCompletion {
    let done = completedCyclesCount + 1
    let total = totalCycles
    if total < 1 {
        return .complete
    }
    return done >= total ? .complete : .break_
}

func isSingleBlockMode(cycles: Int?, isChillMode: Bool = false) -> Bool {
    if isChillMode {
        return false
    }
    return (cycles ?? 1) <= 1
}

func clampCycles(_ value: Int, fallback: Int = 1) -> Int {
    return min(12, max(1, value))
}

func sessionWallMinutes(workMins: Int, breakMins: Int, cycles: Int) -> Int {
    let c = max(1, cycles)
    let w = max(0, workMins)
    let b = max(0, breakMins)
    return c * w + (c > 1 ? (c - 1) * b : 0)
}

func sessionWallMinutesFull(workMins: Int, breakMins: Int, cycles: Int, longBreakMins: Int = 0, longBreakInterval: Int = 0) -> Int {
    let c = max(1, cycles)
    if c <= 1 {
        return max(0, workMins)
    }
    var total = c * max(0, workMins)
    for i in stride(from: 1, to: c, by: 1) {
        total += isLongBreakCycle(cycleIdx: i, totalCycles: c, longBreakInterval: longBreakInterval, longBreakMins: longBreakMins, breakMins: breakMins)
    }
    return total
}

func isLongBreakCycle(cycleIdx: Int, totalCycles: Int, longBreakInterval: Int, longBreakMins: Int, breakMins: Int) -> Int {
    if cycleIdx >= totalCycles {
        return 0 // never trailing
    }
    if longBreakInterval > 0 && longBreakMins > 0 && cycleIdx % longBreakInterval == 0 {
        return longBreakMins
    }
    return max(0, breakMins)
}

let LONG_SESSION_CONFIRM_WALL_MINS = 60

func remainingTaskCycles(task: TaskItem) -> Int {
    let total = task.cycles ?? 0
    if total < 1 {
        return 1
    }
    let done = task.cyclesCompleted ?? 0
    return max(1, total - done)
}

func fitCyclesToDuration(durationMins: Int, workMins: Int, breakMins: Int) -> Int {
    let w = max(1, workMins)
    let b = max(0, breakMins)
    let dur = max(0, durationMins)
    return clampCycles(Int(round(Double(dur + b) / Double(w + b))), fallback: 1)
}

func formatTime(_ seconds: Int) -> String {
    let mins = seconds / 60
    let secs = seconds % 60
    return String(format: "%02d:%02d", mins, secs)
}
