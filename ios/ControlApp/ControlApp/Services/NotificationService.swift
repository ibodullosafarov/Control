import Foundation
import UserNotifications

class NotificationService {
    static let shared = NotificationService()
    
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                print("Notification permission error: \(error)")
            }
        }
    }
    
    func schedulePhaseCompleteNotification(phase: SessionPhase, nextPhase: String) {
        let content = UNMutableNotificationContent()
        if phase == .work {
            content.title = "Work Complete"
            content.body = "Time for \(nextPhase)!"
        } else {
            content.title = "Break Complete"
            content.body = "Time to get back to work!"
        }
        content.sound = .default
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }
}
