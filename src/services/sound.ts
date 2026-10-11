/**
 * Web Audio API synthesizer for calm, aesthetic acoustic cues.
 * Pure native audio synthesis with zero external assets needed.
 */

class SoundService {
  private ctx: AudioContext | null = null;
  private isUnlocked = false;

  constructor() {
    this.setupUnlockListeners();
  }

  private setupUnlockListeners() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('click', unlock, { once: true, passive: true });
  }

  public unlock() {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        this.isUnlocked = true;
      }).catch(() => {});
    } else {
      this.isUnlocked = true;
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    return this.ctx;
  }

  private async ensureActive(): Promise<AudioContext | null> {
    const ctx = this.getContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('AudioContext resume error:', err);
      }
    }
    return ctx;
  }

  /** Play a warm Tibetan singing bowl resonance (Break Started) */
  async playBowl(volume = 0.7) {
    const ctx = await this.ensureActive();
    if (!ctx) return;

    const safeVol = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;
    const startTime = now + 0.01;
    const freqs = [432, 864, 1296]; // Natural harmonic series
    const gains = [0.65, 0.3, 0.12];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gains[idx] * safeVol), startTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 3.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 3.3);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
    });
  }

  /** Play an uplifting dual chime (Work Starting / Resuming) */
  async playChime(volume = 0.7) {
    const ctx = await this.ensureActive();
    if (!ctx) return;

    const safeVol = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;
    const notes = [523.25, 659.25]; // C5, E5

    notes.forEach((freq, i) => {
      const startTime = now + 0.01 + i * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.6 * safeVol), startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.3);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
    });
  }

  /** Play a celebratory harmonic chord (Session Complete) */
  async playComplete(volume = 0.7) {
    const ctx = await this.ensureActive();
    if (!ctx) return;

    const safeVol = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880]; // A Major chord

    notes.forEach((freq, i) => {
      const startTime = now + 0.01 + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.45 * safeVol), startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 2.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 2.5);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
    });
  }

  /** Play a subtle minimal click */
  async playTick(volume = 0.3) {
    const ctx = await this.ensureActive();
    if (!ctx) return;

    const safeVol = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;
    const startTime = now + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, startTime);
    osc.frequency.exponentialRampToValueAtTime(200, startTime + 0.03);

    gain.gain.setValueAtTime(Math.max(0.0001, 0.25 * safeVol), startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.04);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (_) {}
    };
  }
}

export const sound = new SoundService();
