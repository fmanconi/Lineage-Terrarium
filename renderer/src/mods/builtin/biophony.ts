/**
 * Biophony & Soundscape Mod (ADR 0024):
 *
 * Procedural, zero-dependency environmental sound engine powered by the Web Audio API.
 * Synthesizes living soundscapes purely in real-time code without loading any external audio files:
 *   1. Cozy Biome Drone: Warm, comforting harmonic sub-drone (open fifths / gentle chords) giving
 *      a peaceful, living presence to the terrarium without any harsh synthetic buzz.
 *   2. Ocean Surf & Breeze: Brownian low-frequency swell with organic breathing envelope and warm lowpass.
 *   3. Dynamic Weather: Gentle rain bed with procedural organic water plinks on leaves and rolling thunder.
 *   4. Emergent Biophony: Natural avian songbird glissandos and gentle night cricket trills scaling
 *      with animal population.
 *
 * Zero white-noise hiss: calibrated for cozy, relaxing ambient listening.
 * Runs cleanly in browser, kiosk and pywebview. Headless / test-safe fallback when AudioContext is absent.
 * Renderer-only: zero impact on `sim/` determinism.
 */
import type { StorageLike } from "../../settings";
import { MODS_STORAGE_KEY } from "../registry";
import type { Mod, ModContext, ModMetadata } from "../types";

export const BIOPHONY_STORAGE_KEY = "lineage_biophony_settings_v1";
/** Seconds between two thunder rumbles at least: a storm lasts many frames, one rumble each. */
export const THUNDER_COOLDOWN_S = 8;

export interface BiophonySettings {
  volume: number; // 0.0 to 1.0
  muted: boolean;
}

let biophonyActive = false;

export function isBiophonyActive(): boolean {
  return biophonyActive;
}

export function setBiophonyActive(active: boolean): void {
  biophonyActive = active;
}

/** Audio interface abstraction supporting both real Web Audio and mocks */
export interface AudioContextLike {
  readonly state: string;
  readonly sampleRate: number;
  readonly currentTime: number;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceLike;
  createOscillator(): OscillatorLike;
  destination: unknown;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  connect(dest: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface GainNodeLike {
  gain: {
    value: number;
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
    exponentialRampToValueAtTime(value: number, time: number): void;
  };
  connect(dest: unknown): void;
}

export interface BiquadFilterLike {
  type: string;
  frequency: {
    value: number;
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
  };
  Q: { value: number };
  connect(dest: unknown): void;
}

export interface OscillatorLike {
  type: string;
  frequency: {
    value: number;
    setValueAtTime(value: number, time: number): void;
    exponentialRampToValueAtTime(value: number, time: number): void;
  };
  connect(dest: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export class BiophonyEngine {
  private ctx: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private droneGain: GainNodeLike | null = null;
  private windGain: GainNodeLike | null = null;
  private windFilter: BiquadFilterLike | null = null;
  private rainGain: GainNodeLike | null = null;
  private rainFilter: BiquadFilterLike | null = null;
  private settings: BiophonySettings = { volume: 0.75, muted: false };
  private storage: StorageLike | null = null;
  private chirpCooldownS = 0;
  private dropCooldownS = 0;
  private swellPhase = 0;
  /** Seconds until the next thunder may rumble (0: it may now). */
  thunderCooldownS = 0;
  private isNight = false;
  private animalCount = 0;

  constructor(customContext: AudioContextLike | null = null) {
    this.ctx = customContext;
  }

  init(storage: StorageLike | null = null): void {
    this.storage = storage;
    this.loadSettings();

    // Auto-discover browser Web Audio if available and none injected
    if (this.ctx === null && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx() as unknown as AudioContextLike;
        } catch {
          // Audio blocked or headless
        }
      }
    }

    if (this.ctx) {
      this.setupNodes();
    }

    // Register user gesture unlocks for Web Audio autoplay policy
    if (typeof window !== "undefined") {
      const unlockAudio = (): void => {
        void this.resume();
      };
      window.addEventListener("pointerdown", unlockAudio, { passive: true });
      window.addEventListener("keydown", unlockAudio, { passive: true });
      window.addEventListener("click", unlockAudio, { passive: true });
      window.addEventListener("touchstart", unlockAudio, { passive: true });
    }
  }

  /** Resume the audio context if suspended by browser autoplay policy */
  async resume(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        // Autoplay policy awaiting next user gesture
      }
    }
  }

  isSuspended(): boolean {
    return this.ctx?.state === "suspended";
  }

  loadSettings(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(BIOPHONY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BiophonySettings>;
        if (typeof parsed.volume === "number")
          this.settings.volume = Math.max(0, Math.min(1, parsed.volume));
        if (typeof parsed.muted === "boolean") this.settings.muted = parsed.muted;
      }
    } catch {
      // Fallback to defaults
    }
  }

  saveSettings(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(BIOPHONY_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable
    }
  }

  getSettings(): Readonly<BiophonySettings> {
    return this.settings;
  }

  setVolume(vol: number): void {
    this.settings.volume = Math.max(0, Math.min(1, vol));
    this.applyMasterGain();
    this.saveSettings();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyMasterGain();
    this.saveSettings();
  }

  private applyMasterGain(): void {
    if (!this.masterGain || !this.ctx) return;
    const target = this.settings.muted ? 0 : this.settings.volume;
    try {
      this.masterGain.gain.setValueAtTime(target, this.ctx.currentTime);
    } catch {
      this.masterGain.gain.value = target;
    }
  }

  private setupNodes(): void {
    if (!this.ctx) return;
    try {
      this.masterGain = this.ctx.createGain();
      this.applyMasterGain();
      this.masterGain.connect(this.ctx.destination);

      // 1. Cozy Biome Drone (warm, continuous ambient chord in D)
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0.16;
      const droneBuffer = this.createWarmDroneBuffer(this.ctx, 4.0);
      const droneSource = this.ctx.createBufferSource();
      droneSource.buffer = droneBuffer;
      droneSource.loop = true;
      droneSource.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);
      droneSource.start(0);

      // 2. Gentle Wind & Surf Swell (warm brownian noise with lowpass filter)
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.10;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = "lowpass";
      this.windFilter.frequency.value = 260;
      this.windFilter.Q.value = 0.8;

      const brownNoise = this.createBrownNoiseBuffer(this.ctx, 3.0);
      const windSource = this.ctx.createBufferSource();
      windSource.buffer = brownNoise;
      windSource.loop = true;
      windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      windSource.start(0);

      // 3. Gentle Rain (soft bandpassed rainfall texture)
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.0;
      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = "bandpass";
      this.rainFilter.frequency.value = 750;
      this.rainFilter.Q.value = 0.9;

      const rainNoise = this.createPinkNoiseBuffer(this.ctx, 2.0);
      const rainSource = this.ctx.createBufferSource();
      rainSource.buffer = rainNoise;
      rainSource.loop = true;
      rainSource.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      rainSource.start(0);
    } catch {
      // Audio node failure fallback
    }
  }

  /**
   * Generates a warm, zero-hiss procedural chord in open D (D3, A3, D4, F#4, A4, D5).
   * Exact integer multiples of 0.25 Hz guarantee seamless, click-free 4.0s looping.
   * Rich middle frequencies provide crystal clarity across laptop speakers and headphones.
   */
  private createWarmDroneBuffer(ctx: AudioContextLike, durationS: number): AudioBufferLike {
    const samples = Math.floor(ctx.sampleRate * durationS);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const twoPi = Math.PI * 2;
    const invRate = 1.0 / ctx.sampleRate;

    // Harmonic frequencies in warm open D (clearly audible on standard speakers)
    const f1 = 147.0; // D3 (warm body fundamental)
    const f2 = 220.5; // A3 (open fifth, airy presence)
    const f3 = 294.0; // D4 (middle octave clarity)
    const f4 = 367.5; // F#4 (bright, soothing major third)
    const f5 = 441.0; // A4 (upper fifth shimmer)
    const f6 = 588.0; // D5 (gentle top sparkle)

    for (let i = 0; i < samples; i++) {
      const t = i * invRate;
      // Gentle wave modulation for living organic movement
      const a1 = 0.32 + 0.04 * Math.sin(twoPi * 0.25 * t);
      const a2 = 0.26 + 0.03 * Math.sin(twoPi * 0.5 * t + 1.2);
      const a3 = 0.20 + 0.03 * Math.sin(twoPi * 0.25 * t + 2.4);
      const a4 = 0.14 + 0.02 * Math.sin(twoPi * 0.75 * t + 0.8);
      const a5 = 0.08 + 0.01 * Math.sin(twoPi * 0.5 * t + 3.1);
      const a6 = 0.04 + 0.01 * Math.sin(twoPi * 0.25 * t + 4.2);

      data[i] =
        (a1 * Math.sin(twoPi * f1 * t) +
          a2 * Math.sin(twoPi * f2 * t) +
          a3 * Math.sin(twoPi * f3 * t) +
          a4 * Math.sin(twoPi * f4 * t) +
          a5 * Math.sin(twoPi * f5 * t) +
          a6 * Math.sin(twoPi * f6 * t)) *
        0.32;
    }
    return buffer;
  }

  /**
   * Generates soft Brownian (red) noise via leaky integration.
   * Deep and smooth without high-frequency harshness, simulating organic wind and sea surf.
   */
  private createBrownNoiseBuffer(ctx: AudioContextLike, durationS: number): AudioBufferLike {
    const samples = Math.floor(ctx.sampleRate * durationS);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < samples; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.0;
    }

    // Smooth boundary crossfade to avoid loop seams
    const fadeSamples = Math.min(2048, Math.floor(samples / 4));
    for (let i = 0; i < fadeSamples; i++) {
      const alpha = i / fadeSamples;
      const startVal = data[i] ?? 0;
      const endVal = data[samples - 1 - (fadeSamples - 1 - i)] ?? 0;
      data[i] = startVal * alpha + endVal * (1 - alpha);
    }
    return buffer;
  }

  /**
   * Pink noise buffer (1/f) for rainfall texture.
   */
  private createPinkNoiseBuffer(ctx: AudioContextLike, durationS: number): AudioBufferLike {
    const samples = Math.floor(ctx.sampleRate * durationS);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;

    for (let i = 0; i < samples; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.12;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  /**
   * Trigger a gentle water droplet plink when raining on foliage or sea.
   */
  private triggerWaterDrop(): void {
    if (!this.ctx || !this.masterGain || this.settings.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      osc.type = "sine";
      const startFreq = 1050 + Math.random() * 400;
      const endFreq = startFreq * 0.65;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + 0.035);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch {
      // Audio safety
    }
  }

  /** Trigger an emergent, melodic bird chirp or cozy nocturnal cricket trill */
  triggerChirp(): void {
    if (!this.ctx || !this.masterGain || this.settings.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;

      if (this.isNight) {
        // Nocturnal cricket / katydid soft trill
        osc.type = "triangle";
        osc.frequency.setValueAtTime(4200, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.05);
      } else {
        // Diurnal songbird melodious chirp (smooth melodic sweep without clicks)
        osc.type = "sine";
        const startFreq = 2200 + Math.random() * 500;
        const peakFreq = startFreq + 350 + Math.random() * 200;
        const endFreq = startFreq - 150;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(peakFreq, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(Math.max(100, endFreq), now + 0.15);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.17);
      }
    } catch {
      // Audio error safety
    }
  }

  /**
   * Rumble for a storm if the last rumble is at least `THUNDER_COOLDOWN_S` old; returns
   * whether it rumbled.
   */
  requestThunder(): boolean {
    if (this.thunderCooldownS > 0) return false;
    this.thunderCooldownS = THUNDER_COOLDOWN_S;
    this.triggerThunder();
    return true;
  }

  /** Trigger thunder sub-bass rumble on storm lightning */
  triggerThunder(): void {
    if (!this.ctx || !this.masterGain || this.settings.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      osc.type = "sine";
      osc.frequency.setValueAtTime(65, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 1.2);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.5);
    } catch {
      // Audio safety
    }
  }

  update(dtS: number, rain = 0, windSpeed = 1.0, isNight = false, animalCount = 0): void {
    if (!biophonyActive || dtS <= 0) return;

    if (this.isSuspended()) {
      void this.resume();
    }

    this.thunderCooldownS = Math.max(0, this.thunderCooldownS - dtS);
    this.isNight = isNight;
    this.animalCount = animalCount;
    this.swellPhase += dtS * 0.35;

    // Organic ocean surf / breeze swell cycle (approx 18-second breathing period)
    const swell = 0.75 + 0.25 * Math.sin(this.swellPhase);

    // Modulate wind gain and lowpass filter naturally
    if (this.windGain && this.windFilter && this.ctx) {
      const targetGain = Math.min(0.18, (0.05 + 0.05 * windSpeed) * swell);
      this.windGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
      const targetFreq = 180 + Math.min(260, windSpeed * 80);
      this.windFilter.frequency.setValueAtTime(targetFreq, this.ctx.currentTime);
    }

    // Modulate soft rain gain and spawn gentle droplets
    if (this.rainGain && this.ctx) {
      const targetRain = Math.min(0.22, rain * 0.22);
      this.rainGain.gain.setValueAtTime(targetRain, this.ctx.currentTime);

      if (rain > 0.05 && !this.settings.muted) {
        this.dropCooldownS -= dtS;
        if (this.dropCooldownS <= 0) {
          this.triggerWaterDrop();
          this.dropCooldownS = Math.max(0.12, 0.45 - rain * 0.3) + Math.random() * 0.18;
        }
      }
    }

    // Spawn random biophony chirps when creatures are active
    if (this.animalCount > 0) {
      this.chirpCooldownS -= dtS;
      if (this.chirpCooldownS <= 0) {
        this.triggerChirp();
        // Cooldown between 1.5s and 5.0s, inversely proportional to animal count
        const base = Math.max(1.5, 5.0 - Math.min(3.5, this.animalCount * 0.15));
        this.chirpCooldownS = base + Math.random() * 2.0;
      }
    }
  }
}

export const biophonyEngine = new BiophonyEngine();

export class BiophonyMod implements Mod {
  readonly meta: ModMetadata = {
    id: "biophony-soundscape",
    name: "Biophony & Soundscape",
    version: "1.0.0",
    description:
      "Procedural, zero-dependency environmental audio: warm ambient terrarium drone, ocean surf, rain, and bird chirps.",
    defaultEnabled: true,
  };

  init(ctx: ModContext): void {
    biophonyEngine.init(ctx.storage);

    // One-time migration: ensure mod is activated even if older storage defaulted to false
    const migrationKey = "lineage_biophony_enabled_v2";
    if (ctx.storage.getItem(migrationKey) !== "1") {
      try {
        ctx.storage.setItem(migrationKey, "1");
        const raw = ctx.storage.getItem(MODS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (parsed["biophony-soundscape"] !== true) {
          parsed["biophony-soundscape"] = true;
          ctx.storage.setItem(MODS_STORAGE_KEY, JSON.stringify(parsed));
        }
      } catch {
        // Storage safety
      }
    }
  }

  enable(): void {
    setBiophonyActive(true);
    biophonyEngine.setMuted(false);
    void biophonyEngine.resume();
  }

  disable(): void {
    setBiophonyActive(false);
    biophonyEngine.setMuted(true);
  }

  isEnabled(): boolean {
    return isBiophonyActive();
  }

  update(dtS: number, options: Record<string, unknown>): void {
    if (!biophonyActive) return;

    const rain = typeof options.rain === "number" ? options.rain : 0;
    const windSpeed = typeof options.windSpeed === "number" ? options.windSpeed : 1.0;
    const isNight = options.isNight === true;
    const animals = Array.isArray(options.animals) ? options.animals.length : 0;

    biophonyEngine.update(dtS, rain, windSpeed, isNight, animals);

    if (options.thunder === true) {
      biophonyEngine.requestThunder();
    }
  }
}
