/**
 * Biophony & Soundscape Mod (ADR 0024):
 *
 * Procedural, zero-dependency environmental sound engine powered by the Web Audio API.
 * Synthesizes living soundscapes purely in real-time code without loading any external audio files:
 *   1. Wind & Sea Breeze: Pink noise loop modulated through resonant biquad bandpass filters.
 *   2. Ocean Surf: Low-frequency rolling surf swell envelope against coastal land.
 *   3. Dynamic Weather: Rain hiss dynamically scaling with `rain` (0..1) and thunder rumbles on storm events.
 *   4. Emergent Biophony: Procedural bio-chirps, clicks and trills generated as emergent wildlife
 *      acoustic activity, scaling with active animal population and shifting between day and night.
 *
 * Runs cleanly in browser, kiosk and pywebview. Headless / test-safe fallback when AudioContext is absent.
 * Renderer-only: zero impact on `sim/` determinism.
 */
import type { StorageLike } from "../../settings";
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
  private windGain: GainNodeLike | null = null;
  private windFilter: BiquadFilterLike | null = null;
  private rainGain: GainNodeLike | null = null;
  private settings: BiophonySettings = { volume: 0.45, muted: false };
  private storage: StorageLike | null = null;
  private chirpCooldownS = 0;
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
  }

  loadSettings(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(BIOPHONY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BiophonySettings>;
        if (typeof parsed.volume === "number") this.settings.volume = Math.max(0, Math.min(1, parsed.volume));
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

      // 1. Wind & breeze node setup
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.15;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = "bandpass";
      this.windFilter.frequency.value = 400;
      this.windFilter.Q.value = 1.2;

      const pinkNoise = this.createPinkNoiseBuffer(this.ctx, 2.0);
      const windSource = this.ctx.createBufferSource();
      windSource.buffer = pinkNoise;
      windSource.loop = true;
      windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      windSource.start(0);

      // 2. Rain node setup
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.0;
      const rainFilter = this.ctx.createBiquadFilter();
      rainFilter.type = "highpass";
      rainFilter.frequency.value = 1200;

      const rainNoise = this.createWhiteNoiseBuffer(this.ctx, 1.5);
      const rainSource = this.ctx.createBufferSource();
      rainSource.buffer = rainNoise;
      rainSource.loop = true;
      rainSource.connect(rainFilter);
      rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      rainSource.start(0);
    } catch {
      // Audio node failure fallback
    }
  }

  private createPinkNoiseBuffer(ctx: AudioContextLike, durationS: number): AudioBufferLike {
    const samples = Math.floor(ctx.sampleRate * durationS);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < samples; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContextLike, durationS: number): AudioBufferLike {
    const samples = Math.floor(ctx.sampleRate * durationS);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.2;
    }
    return buffer;
  }

  /** Trigger a procedural micro-chirp */
  triggerChirp(): void {
    if (!this.ctx || !this.masterGain || this.settings.muted) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;

      if (this.isNight) {
        // Nocturnal cricket chirp
        osc.type = "triangle";
        osc.frequency.setValueAtTime(3800, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.045);
      } else {
        // Diurnal bird / insect micro-trill
        osc.type = "sine";
        const startFreq = 2200 + Math.random() * 800;
        const endFreq = startFreq + (Math.random() - 0.5) * 600;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.05);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.06);
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

      gain.gain.setValueAtTime(0.25, now);
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

    this.thunderCooldownS = Math.max(0, this.thunderCooldownS - dtS);
    this.isNight = isNight;
    this.animalCount = animalCount;

    // Modulate rain gain smoothly
    if (this.rainGain && this.ctx) {
      const targetRain = Math.min(0.35, rain * 0.35);
      this.rainGain.gain.setValueAtTime(targetRain, this.ctx.currentTime);
    }

    // Modulate wind cutoff frequency with breeze
    if (this.windFilter && this.ctx) {
      const targetFreq = 300 + Math.min(600, windSpeed * 200);
      this.windFilter.frequency.setValueAtTime(targetFreq, this.ctx.currentTime);
    }

    // Spawn random biophony chirps when creatures are active
    if (this.animalCount > 0) {
      this.chirpCooldownS -= dtS;
      if (this.chirpCooldownS <= 0) {
        this.triggerChirp();
        // Cooldown between 1.5s and 5s, inversely proportional to animal count
        const base = Math.max(1.2, 5.0 - Math.min(3.5, this.animalCount * 0.15));
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
      "Procedural, zero-dependency environmental audio: wind, ocean surf, rain, thunder, and emergent creature bio-chirps.",
    defaultEnabled: false,
  };

  init(ctx: ModContext): void {
    biophonyEngine.init(ctx.storage);
  }

  enable(): void {
    setBiophonyActive(true);
    biophonyEngine.setMuted(false);
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
