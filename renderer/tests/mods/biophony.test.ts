import { describe, expect, it, beforeEach } from "vitest";
import {
  BiophonyMod,
  BiophonyEngine,
  isBiophonyActive,
  setBiophonyActive,
  BIOPHONY_STORAGE_KEY,
  THUNDER_COOLDOWN_S,
  biophonyEngine,
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

describe("Ambient Sound Mod", () => {
  beforeEach(() => {
    setBiophonyActive(false);
  });

  it("registers metadata correctly", () => {
    const mod = new BiophonyMod();
    expect(mod.meta.id).toBe("biophony-soundscape");
    expect(mod.meta.name).toBe("Ambient Sound");
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

  it("rumbles at most once every THUNDER_COOLDOWN_S through a storm", () => {
    const mockAudio = createMockAudioContext();
    const engine = new BiophonyEngine(mockAudio);
    engine.init();
    setBiophonyActive(true);
    const rumbles = (): number =>
      mockAudio.logs.filter((line) => line === "osc.frequency.exponentialRampToValueAtTime 30")
        .length;

    let heard = 0;
    // 20 s of storm at 30 fps, asking for thunder every frame.
    for (let frame = 0; frame < 600; frame++) {
      engine.update(1 / 30, 1, 1, false, 0);
      if (engine.requestThunder()) heard++;
    }
    expect(heard).toBe(Math.ceil(20 / THUNDER_COOLDOWN_S));
    expect(rumbles()).toBe(heard);
    expect(engine.thunderCooldownS).toBeGreaterThan(0);
    expect(engine.thunderCooldownS).toBeLessThanOrEqual(THUNDER_COOLDOWN_S);
  });

  it("the mod turns a storm's every frame into one rumble per cooldown", () => {
    const mod = new BiophonyMod();
    mod.enable();
    biophonyEngine.thunderCooldownS = 0;
    for (let frame = 0; frame < 30; frame++) mod.update(1 / 30, { thunder: true });
    // One rumble at the first frame; the cooldown then runs for a second only.
    expect(biophonyEngine.thunderCooldownS).toBeCloseTo(THUNDER_COOLDOWN_S - 29 / 30, 5);
    mod.disable();
  });

  it("handles keyboard audio controls (mute, volume adjustments, reset)", () => {
    const mod = new BiophonyMod();
    mod.init({ frame: {} as HTMLElement, width: 512, height: 300, storage: memoryStorage() });
    mod.enable();

    biophonyEngine.setVolume(0.7);
    biophonyEngine.setMuted(false);

    // Mute toggle [U]
    expect(mod.onKey({ key: "u" } as KeyboardEvent)).toBe(true);
    expect(biophonyEngine.getSettings().muted).toBe(true);
    expect(mod.onKey({ key: "U" } as KeyboardEvent)).toBe(true);
    expect(biophonyEngine.getSettings().muted).toBe(false);

    // Volume up [+]
    expect(mod.onKey({ key: "+" } as KeyboardEvent)).toBe(true);
    expect(biophonyEngine.getSettings().volume).toBeCloseTo(0.8, 2);

    // Volume down [-]
    expect(mod.onKey({ key: "-" } as KeyboardEvent)).toBe(true);
    expect(biophonyEngine.getSettings().volume).toBeCloseTo(0.7, 2);

    // Volume reset [0]
    expect(mod.onKey({ key: "0" } as KeyboardEvent)).toBe(true);
    expect(biophonyEngine.getSettings().volume).toBeCloseTo(0.75, 2);

    // Unrelated key
    expect(mod.onKey({ key: "x" } as KeyboardEvent)).toBe(false);

    // Toggle mute and toast method
    expect(mod.toggleMuteAndToast()).toBe(true);
    expect(biophonyEngine.getSettings().muted).toBe(true);
    expect(mod.toggleMuteAndToast()).toBe(false);
    expect(biophonyEngine.getSettings().muted).toBe(false);

    mod.disable();
  });
});
