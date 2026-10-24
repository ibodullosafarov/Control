import Foundation
import AVFoundation

class SoundService {
    static let shared = SoundService()
    private var audioPlayer: AVAudioPlayer?
    
    func playChime() {
        // Use system sound as fallback - in production could use custom sounds
        AudioServicesPlaySystemSound(1057) // Tink
    }
    
    func playComplete() {
        AudioServicesPlaySystemSound(1025) // Glass
    }
    
    func playBreakStart() {
        AudioServicesPlaySystemSound(1104) // SMS
    }
}
