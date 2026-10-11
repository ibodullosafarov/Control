// Procedural Web Audio Soundscape Synthesizer
// Generates continuous, soothing ambient soundscapes offline

export type AmbientSoundType = 'rain' | 'forest' | 'noise' | 'cafe' | 'ocean';

export interface AmbientSoundOption {
  id: AmbientSoundType;
  name: string;
  emoji: string;
  description: string;
}

export const AMBIENT_SOUNDS: AmbientSoundOption[] = [
  { id: 'rain', name: 'Rain on Glass', emoji: '🌧️', description: 'Soothing rain droplets & gentle mist' },
  { id: 'forest', name: 'Forest Zen', emoji: '🌲', description: 'Soft breeze & harmonic wood resonance' },
  { id: 'noise', name: 'Deep Space Noise', emoji: '🌌', description: 'Deep brown noise for laser-focus' },
  { id: 'cafe', name: 'Cozy Atmosphere', emoji: '☕', description: 'Warm coffeehouse murmur & ambient clinks' },
  { id: 'ocean', name: 'Ocean Waves', emoji: '🌊', description: 'Rhythmic surf & theta focus harmonics' },
];

class AmbientAudioService {
  private ctx: AudioContext | null = null;
  private currentType: AmbientSoundType | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private volume = 0.5;
  private activeNodes: (AudioNode | number)[] = [];

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
    this.initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private initContext(): AudioContext | null {
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
    const ctx = this.initContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('AmbientAudioContext resume error:', err);
      }
    }
    return ctx;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume * 0.75, this.ctx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getCurrentSound(): AmbientSoundType | null {
    return this.isPlaying ? this.currentType : null;
  }

  public async play(type: AmbientSoundType) {
    this.stop();
    const ctx = await this.ensureActive();
    if (!ctx) return;

    this.currentType = type;
    this.isPlaying = true;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.75, ctx.currentTime);
    this.gainNode.connect(ctx.destination);

    switch (type) {
      case 'noise':
        this.startBrownNoise();
        break;
      case 'rain':
        this.startRain();
        break;
      case 'ocean':
        this.startOcean();
        break;
      case 'forest':
        this.startForest();
        break;
      case 'cafe':
        this.startCafe();
        break;
    }
  }

  public stop() {
    this.isPlaying = false;
    this.currentType = null;

    this.activeNodes.forEach((node) => {
      if (typeof node === 'number') {
        clearInterval(node);
      } else {
        try {
          if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
            (node as AudioScheduledSourceNode).stop();
          }
          node.disconnect();
        } catch (_) {}
      }
    });

    this.activeNodes = [];

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (_) {}
      this.gainNode = null;
    }
  }

  /**
   * Helper: Generate a seamless stereo looping buffer with crossfaded boundaries
   * to eliminate clicking/popping artifacts when looping.
   */
  private createSeamlessNoiseBuffer(seconds = 6, kind: 'brown' | 'pink' | 'white' = 'brown'): AudioBuffer | null {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * seconds);
    const buffer = this.ctx.createBuffer(2, bufferSize, sampleRate);
    const fadeSamples = Math.floor(sampleRate * 0.3); // 300ms crossfade

    for (let ch = 0; ch < 2; ch++) {
      const channelData = buffer.getChannelData(ch);
      let lastOut = 0.0;
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === 'brown') {
          channelData[i] = (lastOut + 0.02 * white) / 1.02;
          lastOut = channelData[i];
          channelData[i] *= 3.5;
        } else if (kind === 'pink') {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          channelData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        } else {
          channelData[i] = white * 0.5;
        }
      }

      // Smooth crossfade end into beginning
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const endIdx = bufferSize - fadeSamples + i;
        channelData[endIdx] = channelData[endIdx] * (1 - t) + channelData[i] * t;
      }
    }

    return buffer;
  }

  // --- 1. DEEP BROWN NOISE ---
  private startBrownNoise() {
    if (!this.ctx || !this.gainNode) return;
    const noiseBuffer = this.createSeamlessNoiseBuffer(6, 'brown');
    if (!noiseBuffer) return;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, this.ctx.currentTime);

    noise.connect(filter);
    filter.connect(this.gainNode);
    noise.start();

    this.activeNodes.push(noise, filter);
  }

  // --- 2. RAIN ON GLASS ---
  private startRain() {
    if (!this.ctx || !this.gainNode) return;
    const rainBuffer = this.createSeamlessNoiseBuffer(6, 'pink');
    if (!rainBuffer) return;

    const rainSource = this.ctx.createBufferSource();
    rainSource.buffer = rainBuffer;
    rainSource.loop = true;

    // Body of the rain
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1100, this.ctx.currentTime);
    bandpass.Q.setValueAtTime(0.7, this.ctx.currentTime);

    // Air and mist filter
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(3600, this.ctx.currentTime);

    rainSource.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(this.gainNode);
    rainSource.start();

    // Secondary subtle droplet layer
    const brownBuffer = this.createSeamlessNoiseBuffer(6, 'brown');
    if (brownBuffer) {
      const brownSource = this.ctx.createBufferSource();
      brownSource.buffer = brownBuffer;
      brownSource.loop = true;

      const subFilter = this.ctx.createBiquadFilter();
      subFilter.type = 'lowpass';
      subFilter.frequency.setValueAtTime(320, this.ctx.currentTime);

      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.4, this.ctx.currentTime);

      brownSource.connect(subFilter);
      subFilter.connect(subGain);
      subGain.connect(this.gainNode);
      brownSource.start();
      this.activeNodes.push(brownSource, subFilter, subGain);
    }

    this.activeNodes.push(rainSource, bandpass, lowpass);
  }

  // --- 3. OCEAN WAVES ---
  private startOcean() {
    if (!this.ctx || !this.gainNode) return;
    const noiseBuffer = this.createSeamlessNoiseBuffer(8, 'brown');
    if (!noiseBuffer) return;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, this.ctx.currentTime);

    // LFO to modulate wave swell frequency (smooth 10-second swell)
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.1, this.ctx.currentTime); // 10 sec cycle

    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(260, this.ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    // Volume modulation for natural rolling swell
    const volGain = this.ctx.createGain();
    volGain.gain.setValueAtTime(0.65, this.ctx.currentTime);

    const volLfo = this.ctx.createOscillator();
    volLfo.type = 'sine';
    volLfo.frequency.setValueAtTime(0.1, this.ctx.currentTime);

    const volLfoGain = this.ctx.createGain();
    volLfoGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

    volLfo.connect(volLfoGain);
    volLfoGain.connect(volGain.gain);

    noise.connect(filter);
    filter.connect(volGain);
    volGain.connect(this.gainNode);

    noise.start();
    lfo.start();
    volLfo.start();

    this.activeNodes.push(noise, filter, lfo, lfoGain, volGain, volLfo, volLfoGain);
  }

  // --- 4. FOREST ZEN ---
  private startForest() {
    if (!this.ctx || !this.gainNode) return;
    this.startBrownNoise();

    // Calming Solfeggio 174Hz calm frequency
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(174, this.ctx.currentTime);

    const oscGain1 = this.ctx.createGain();
    oscGain1.gain.setValueAtTime(0.08, this.ctx.currentTime);

    // Harmonic fifth (261Hz)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(261, this.ctx.currentTime);

    const oscGain2 = this.ctx.createGain();
    oscGain2.gain.setValueAtTime(0.04, this.ctx.currentTime);

    osc1.connect(oscGain1);
    oscGain1.connect(this.gainNode);
    osc2.connect(oscGain2);
    oscGain2.connect(this.gainNode);

    osc1.start();
    osc2.start();

    this.activeNodes.push(osc1, oscGain1, osc2, oscGain2);
  }

  // --- 5. COZY CAFE ---
  private startCafe() {
    if (!this.ctx || !this.gainNode) return;
    const noiseBuffer = this.createSeamlessNoiseBuffer(6, 'pink');
    if (!noiseBuffer) return;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    // Warm room murmur bandpass
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(750, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2200, this.ctx.currentTime);

    noise.connect(filter);
    filter.connect(lowpass);
    lowpass.connect(this.gainNode);
    noise.start();

    this.activeNodes.push(noise, filter, lowpass);
  }
}

export const ambientAudio = new AmbientAudioService();
