import { describe, expect, it, beforeEach } from "vitest";
import {
  BiophonyMod,
  BiophonyEngine,
  isBiophonyActive,
  setBiophonyActive,
  BIOPHONY_STORAGE_KEY,
  type AudioContextLike,
} from "../../src/mods/builtin/biophony";
import { memoryStorage } from "../../src/mods/registry";

function createMockAudioContext(): AudioContextLike & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    state: "running",
    sampleRate: 44100,
    currentTime: 10,
    destination: {},
    async resume() {
      logs.push("resume");
    },
    async close() {
      logs.push("close");
    },
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime(v: number) {
            logs.push(`gain.setValueAtTime ${v}`);
          },
          linearRampToValueAtTime(v: number) {
            logs.push(`gain.linearRampToValueAtTime ${v}`);
          },
          exponentialRampToValueAtTime(v: number) {
            logs.push(`gain.exponentialRampToValueAtTime ${v}`);
          },
        },
        connect() {},
      };
    },
    createBiquadFilter() {
      return {
        type: "bandpass",
        frequency: {
          value: 400,
          setValueAtTime(v: number) {
            logs.push(`filter.setValueAtTime ${v}`);
          },
          linearRampToValueAtTime() {},
        },
        Q: { value: 1 },
        connect() {},
      };
    },
    createBuffer(channels: number, length: number) {
      const data = new Float32Array(length);
      return {
        getChannelData: () => data,
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        connect() {},
        start() {
          logs.push("bufferSource.start");
        },
        stop() {},
      };
    },
    createOscillator() {
      return {
        type: "sine",
        frequency: {
          value: 440,
          setValueAtTime(v: number) {
            logs.push(`osc.frequency.setValueAtTime ${v}`);
          },
          exponentialRampToValueAtTime(v: number) {
            logs.push(`osc.frequency.exponentialRampToValueAtTime ${v}`);
          },
        },
        connect() {},
        start() {
          logs.push("osc.start");
        },
        stop() {
          logs.push("osc.stop");
        },
      };
    },
  };
}

describe("Biophony & Soundscape Mod", () => {
  beforeEach(() => {
    setBiophonyActive(false);
  });

  it("registers metadata correctly", () => {
    const mod = new BiophonyMod();
    expect(mod.meta.id).toBe("biophony-soundscape");
    expect(mod.meta.name).toBe("Biophony & Soundscape");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("enables and disables cleanly", () => {
    const mod = new BiophonyMod();
    expect(mod.isEnabled()).toBe(false);

    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isBiophonyActive()).toBe(true);

    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isBiophonyActive()).toBe(false);
  });

  it("persists volume and mute settings in storage", () => {
    const storage = memoryStorage();
    const engine = new BiophonyEngine();
    engine.init(storage);

    engine.setVolume(0.8);
    engine.setMuted(true);

    const saved = JSON.parse(storage.getItem(BIOPHONY_STORAGE_KEY) ?? "{}");
    expect(saved.volume).toBeCloseTo(0.8, 2);
    expect(saved.muted).toBe(true);

    // Second engine loading from the same storage
    const engine2 = new BiophonyEngine();
    engine2.init(storage);
    expect(engine2.getSettings().volume).toBeCloseTo(0.8, 2);
    expect(engine2.getSettings().muted).toBe(true);
  });

  it("triggers procedural sound nodes through mock audio context", () => {
    const mockAudio = createMockAudioContext();
    const engine = new BiophonyEngine(mockAudio);
    engine.init();

    expect(mockAudio.logs).toContain("bufferSource.start");

    // Trigger chirps and thunder
    engine.triggerChirp();
    expect(mockAudio.logs).toContain("osc.start");

    engine.triggerThunder();
    expect(mockAudio.logs).toContain("osc.frequency.exponentialRampToValueAtTime 30");
  });
});
