import Foundation
import ActivityKit

struct ControlActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var timeRemaining: Int
        var phase: String
        var currentCycle: Int
        var totalCycles: Int
    }
    
    var modeName: String
    var modeColor: String
}
