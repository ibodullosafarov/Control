import Foundation

enum ThemeId: String, Codable, CaseIterable {
    case moder, softPaper = "soft_paper", lavender, matcha, sunset, abyss, paper, serika, carbon, nord, emerald, dracula, mocha
}

enum BlockingStrategy: String, Codable {
    case dynamicHosts = "dynamic_hosts", selfcontrol, none
}

enum SessionPhase: String, Codable {
    case work, shortBreak = "short_break", longBreak = "long_break", chill, idle, completed
}

enum TaskSource: String, Codable {
    case calendar, manual
}

enum CompanionCommandAction: String, Codable {
    case noteUpsert = "note.upsert", noteDelete = "note.delete"
}
