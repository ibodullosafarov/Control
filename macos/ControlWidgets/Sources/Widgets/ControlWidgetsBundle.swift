import WidgetKit
import SwiftUI

@main
struct ControlWidgetsBundle: WidgetBundle {
    var body: some Widget {
        FocusTimerWidget()
        TodayPlanWidget()
        QuickStatsWidget()
        QuickNoteWidget()
    }
}
