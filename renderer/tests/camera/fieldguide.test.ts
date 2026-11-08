import { readFileSync } from "node:fs";
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { CANDLE, DAYLIGHT, lampKey } from "../../src/captions";
import { PORTRAIT_SIZE } from "../../src/creatures/portrait";
import {
  AUTO_TOUR_S,
  DIP_IN_S,
  DIP_OUT_S,
  Director,
  type Scene,
  type Subject,
} from "../../src/director";
import {
  FieldGuide,
  GUIDE_HEIGHT,
  GUIDE_IDLE_S,
  GUIDE_IN_S,
  GUIDE_OUT_S,
  GUIDE_WIDTH,
  buildLineageRows,
  fitText,
  formatCooldown,
  paintFieldGuide,
} from "../../src/fieldguide";
import { Herd, type SpeciesGuideSnapshot } from "../../src/herd";
import {
  KEYBAR_IDLE_S,
  KEYBAR_SLIDE_S,
  KeyBar,
  hintsForState,
  paintKeyBar,
} from "../../src/keybar";
import { measure } from "../../src/pixelfont";
import type { ClockMessage, Message } from "../../src/protocol";
import { mulberry32 } from "../../src/rng";
import {
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SLEEP_VEIL_ALPHA,
  loadSettings,
  nightVeilAlpha,
  saveSettings,
  stepSetting,
  type StorageLike,
} from "../../src/settings";
import { landOf } from "../../src/stream";
import type { Land } from "../../src/terrain/land";
import type { Pixels } from "../../src/terrain/pixels";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

const SIZES = {
  map: { width: 256, height: 150 },
  middle: { width: 64, height: 37.5 },
  local: { width: 16, height: 9.375 },
};

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function sampleGuide(): SpeciesGuideSnapshot {
  return {
    totalCreatures: 42,
    livingSpeciesCount: 2,
    extinctSpeciesCount: 1,
    grazers: 30,
    omnivores: 8,
    hunters: 4,
    living: [
      {
        id: 2,
        name: "Malebi",
        parent: 1,
        members: 30,
        young: 6,
        torpid: 4,
        grazing: 12,
        feeding: 0,
        body: 0xc47a44,
        mark: 0x3f2618,
        representativeId: 101,
        meanGenome: Array.from({ length: 14 }, () => 0.4),
        traits: "mid-sized armoured grazer",
        dietClass: "grazer",
        icons: ["water", "coat"],
        rareCounts: [{ signature: "coat", name: "winter coat", count: 14 }],
        bars: { size: 0.45, diet: 0.15, speed: 0.4, armour: 0.72, aquatic: 0.5, sense: 0.5 },
      },
      {
        id: 3,
        name: "Vekora",
        parent: 1,
        members: 12,
        young: 2,
        torpid: 0,
        grazing: 0,
        feeding: 3,
        body: 0x9e3d52,
        mark: 0xf0d27a,
        representativeId: 202,
        meanGenome: Array.from({ length: 14 }, () => 0.7),
        traits: "large swift hunter",
        dietClass: "hunter",
        icons: ["venom"],
        rareCounts: [{ signature: "venom", name: "venom", count: 9 }],
        bars: { size: 0.8, diet: 0.85, speed: 0.88, armour: 0.2, aquatic: 0.1, sense: 0.78 },
      },
    ],
    lineage: [
      { id: 1, name: "Orim", parent: null, extinct: true, members: 0, body: null, mark: null },
      {
        id: 2,
        name: "Malebi",
        parent: 1,
        extinct: false,
        members: 30,
        body: 0xc47a44,
        mark: 0x3f2618,
      },
      {
        id: 3,
        name: "Vekora",
        parent: 1,
        extinct: false,
        members: 12,
        body: 0x9e3d52,
        mark: 0xf0d27a,
      },
    ],
  };
}

describe("Terrarium screensaver settings", () => {
  it("persists and validates settings, falling back safely on corrupt JSON", () => {
    const store = memoryStorage();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);

    const custom = {
      ...DEFAULT_SETTINGS,
      autoTour: true,
      nightDimmer: "dark" as const,
      fpsCap: 60 as const,
    };
    saveSettings(custom, store);
    expect(loadSettings(store)).toEqual(custom);

    store.setItem(SETTINGS_STORAGE_KEY, "{not-valid-json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("reads settings saved under the pre-Terrarium key when the new key is empty", () => {
    const store = memoryStorage();
    const legacy = { ...DEFAULT_SETTINGS, sleepMode: true, keyBarMode: "hidden" as const };
    store.setItem(LEGACY_SETTINGS_STORAGE_KEY, JSON.stringify(legacy));
    expect(loadSettings(store)).toEqual(legacy);

    saveSettings(DEFAULT_SETTINGS, store);
    expect(store.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("cycles each setting option cleanly in both directions", () => {
    let s = { ...DEFAULT_SETTINGS };
    s = stepSetting(s, 0, 1);
    expect(s.autoTour).toBe(true);
    s = stepSetting(s, 1, 1);
    expect(s.nightDimmer).toBe("soft");
    s = stepSetting(s, 1, 1);
    expect(s.nightDimmer).toBe("dark");
    s = stepSetting(s, 1, 1);
    expect(s.nightDimmer).toBe("off");
    s = stepSetting(s, 2, -1);
    expect(s.keyBarMode).toBe("hidden");
    s = stepSetting(s, 3, 1);
    expect(s.showCaptions).toBe(false);
    s = stepSetting(s, 4, 1);
    expect(s.fpsCap).toBe(60);
  });

  it("applies bedroom night veil only when solar light drops below twilight, or anytime in sleepMode", () => {
    expect(nightVeilAlpha(1, "dark")).toBe(0);
    expect(nightVeilAlpha(1, "off", true)).toBe(SLEEP_VEIL_ALPHA);
    expect(nightVeilAlpha(0.5, "dark")).toBe(0);
    expect(nightVeilAlpha(0.05, "off")).toBe(0);
    expect(nightVeilAlpha(0.05, "soft")).toBeCloseTo(0.32, 3);
    expect(nightVeilAlpha(0.05, "dark")).toBeCloseTo(0.58, 3);
    expect(nightVeilAlpha(0.25, "dark")).toBeGreaterThan(0.1);
    expect(nightVeilAlpha(0.25, "dark")).toBeLessThan(0.5);
  });
});

describe("Director species follow & autonomous tour", () => {
  const subjects: Subject[] = [
    { id: 10, species: 1, x: 90, y: 60, torpid: false },
    { id: 20, species: 2, x: 140, y: 80, torpid: true },
    { id: 21, species: 2, x: 145, y: 82, torpid: false },
  ];
  const scene: Scene = {
    width: 256,
    height: 150,
    isLand: (x) => x >= 50,
    subjects,
    ready: true,
  };

  it("dips into local view following an awake member of the chosen species", () => {
    const director = new Director(SIZES, mulberry32(4));
    director.followSpecies(2);
    let shot = director.update(0, scene);
    const totalS = DIP_OUT_S + DIP_IN_S + 0.3;
    for (let t = 0; t < totalS; t += 1 / 30) shot = director.update(1 / 30, scene);
    expect(shot.view).toBe("local");
    expect(shot.subject).toBe(21);
  });

  it("cycles map -> middle -> local -> map autonomously when autoTour is enabled", () => {
    const director = new Director(SIZES, mulberry32(9));
    director.autoTour = true;
    const step = (seconds: number): ReturnType<Director["update"]> => {
      let shot = director.update(0, scene);
      for (let t = 0; t < seconds; t += 0.5) shot = director.update(0.5, scene);
      return shot;
    };
    expect(director.state.view).toBe("map");
    expect(step(AUTO_TOUR_S.map + 5).view).toBe("middle");
    expect(step(AUTO_TOUR_S.middle + 5).view).toBe("local");
    expect(step(AUTO_TOUR_S.local + 5).view).toBe("map");
  });
});

describe("Herd speciesGuide census on recorded island", () => {
  it("aggregates living populations, traits, rare counts and evolutionary lineage", () => {
    const office = JSON.parse(
      readFileSync(new URL("../../public/stream/office.json", import.meta.url), "utf-8"),
    ) as { messages: Message[] };
    let land: Land | null = null;
    let clock: ClockMessage | null = null;
    const atlas = {
      plants: new Map<string, Texture>(),
      disc: Texture.WHITE,
      white: Texture.WHITE,
      wedge: Texture.WHITE,
    };
    const herd = new Herd(atlas, mulberry32(3), () => land);
    for (const msg of office.messages.slice(0, 12)) {
      if (msg.type === "clock") clock = msg;
      if (msg.type === "land") land = landOf(msg, clock);
      herd.receive(msg);
    }
    const snap = herd.speciesGuide();
    expect(snap.totalCreatures).toBeGreaterThan(0);
    expect(snap.grazers + snap.omnivores + snap.hunters).toBe(snap.totalCreatures);
    expect(snap.living.length).toBeGreaterThan(0);
    for (let i = 1; i < snap.living.length; i++) {
      expect(snap.living[i - 1]?.members ?? 0).toBeGreaterThanOrEqual(snap.living[i]?.members ?? 0);
    }
    expect(snap.lineage.length).toBeGreaterThanOrEqual(snap.living.length);
  });
});

describe("Bottom-right KeyBar", () => {
  it("paints crisp keycaps and adapts hints to open guide tabs", () => {
    const closed = hintsForState(false, "species", "ready", true, true, true);
    expect(closed.map((h) => h.id)).toEqual([
      "guide",
      "view",
      "miracle",
      "night",
      "mods",
      "fullscreen",
      "pip",
    ]);
    expect(closed.find((h) => h.id === "night")?.dot).toBe("moon-on");
    expect(closed.find((h) => h.id === "fullscreen")?.dot).toBe("full-on");
    expect(closed.find((h) => h.id === "pip")?.dot).toBe("pip-on");
    const painted = paintKeyBar(closed);
    // Fullscreen and PiP by their glyphs alone: the bar fits in 321 of the scene's 512.
    expect(painted.picture.width).toBeLessThan(330);
    expect(painted.picture.height).toBeLessThan(24);
    expect(painted.boxes).toHaveLength(7);
  });

  it("auto-hides after 10s of stillness and wakes on activity", () => {
    const bar = new KeyBar(512, 300);
    bar.update(0.1, {
      mode: "auto",
      guideOpen: false,
      tab: "species",
      scrollShowing: false,
      lamp: DAYLIGHT,
    });
    expect(bar.visible).toBe(true);
    expect(bar.element.style.display).toBe("block");

    for (let t = 0; t < KEYBAR_IDLE_S + KEYBAR_SLIDE_S + 0.5; t += 0.25) {
      bar.update(0.25, {
        mode: "auto",
        guideOpen: false,
        tab: "species",
        scrollShowing: false,
        lamp: CANDLE,
      });
    }
    expect(bar.visible).toBe(false);
    expect(bar.element.style.display).toBe("none");

    bar.wake();
    for (let t = 0; t < KEYBAR_SLIDE_S + 0.1; t += 0.1) {
      bar.update(0.1, {
        mode: "auto",
        guideOpen: false,
        tab: "species",
        scrollShowing: false,
        lamp: CANDLE,
      });
    }
    expect(bar.visible).toBe(true);
  });
});

describe("Naturalist's FieldGuide", () => {
  const portrait: Pixels = (() => {
    const rgba = new Uint8ClampedArray(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    for (let y = 8; y < 28; y++) {
      for (let x = 8; x < 28; x++) rgba.set([0x24, 0x8a, 0xc8, 255], (y * PORTRAIT_SIZE + x) * 4);
    }
    return { width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, rgba };
  })();

  it("formats cooldown durations and truncates long labels cleanly", () => {
    expect(formatCooldown(0)).toBe("Ready");
    expect(formatCooldown(5 * 86_400_000 + 3 * 3_600_000)).toBe("5d 3h");
    expect(formatCooldown(45 * 60_000)).toBe("45m");
    const fitted = fitText("ExtremelyLongGeneratedSpeciesName", 60);
    expect(measure(fitted)).toBeLessThanOrEqual(60);
  });

  it("orders cladogram rows from founders down to daughter branches", () => {
    const { rows, founders, maxDepth } = buildLineageRows(sampleGuide().lineage);
    expect(founders).toBe(1);
    expect(maxDepth).toBe(2);
    expect(rows.map((r) => r.name)).toEqual(["Orim", "Malebi", "Vekora"]);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[2]?.isLast).toBe(true);
  });

  it("paints all three spreads within 482x266 art pixels and blits the creature portrait", () => {
    const guide = sampleGuide();
    for (const tab of ["species", "lineage", "island"] as const) {
      const { picture, zones } = paintFieldGuide({
        tab,
        guide,
        selectedSpeciesId: 2,
        lineageIndex: 0,
        settingIndex: 0,
        settings: DEFAULT_SETTINGS,
        portrait: tab === "species" ? portrait : null,
        clock: {
          type: "clock",
          protocol: 1,
          t_ms: 1000,
          date: "2026-11-07",
          season: "autumn",
          season_progress: 0.5,
          day_of_year: 311,
          days_in_year: 365,
        },
        sky: {
          type: "sky",
          protocol: 1,
          t_ms: 1000,
          light: 0.8,
          present: true,
          rain: "none",
          burning: [],
        },
        miracle: {
          ready: true,
          remaining_ms: 0,
          cooldown_days: 7,
          needs: { rain: 0.2, seed: 0.5, ark: 0.1 },
          closed: [],
          solar_cycle: true,
          solar_elevation_deg: 24.5,
          light: 0.8,
        },
        miracleNote: null,
      });
      expect(picture.width).toBe(GUIDE_WIDTH);
      expect(picture.height).toBe(GUIDE_HEIGHT);
      expect(zones.length).toBeGreaterThanOrEqual(3);
      if (tab === "species") {
        let portraitPixels = 0;
        for (let at = 0; at < picture.rgba.length; at += 4) {
          if (
            picture.rgba[at] === 0x24 &&
            picture.rgba[at + 1] === 0x8a &&
            picture.rgba[at + 2] === 0xc8
          ) {
            portraitPixels += 1;
          }
        }
        expect(portraitPixels).toBe(20 * 20);
      }
    }
  });

  it("navigates tabs, follows a species on Enter, adjusts settings, and auto-closes after 15m", () => {
    const fg = new FieldGuide(512, 300);
    const guide = sampleGuide();
    let followed: number | null = null;
    let currentSettings = { ...DEFAULT_SETTINGS };
    let miracleCalls = 0;
    const callbacks = {
      onFollowSpecies: (id: number) => {
        followed = id;
      },
      onChangeSettings: (next: typeof currentSettings) => {
        currentSettings = next;
      },
      onInvokeMiracle: () => {
        miracleCalls += 1;
      },
    };

    fg.toggle();
    expect(fg.open).toBe(true);
    for (let t = 0; t < GUIDE_IN_S + 0.1; t += 0.05) {
      fg.update(0.05, {
        guide,
        settings: currentSettings,
        portrait: null,
        clock: null,
        sky: null,
        lamp: CANDLE,
      });
    }
    expect(fg.showing).toBe(true);
    expect(lampKey(CANDLE)).toBeGreaterThan(0);

    // Select second species (Vekora, id 3) and press Enter to follow it.
    fg.handleKey("ArrowDown", guide, currentSettings, callbacks);
    fg.handleKey("Enter", guide, currentSettings, callbacks);
    expect(followed).toBe(3);
    expect(fg.open).toBe(false);

    // Reopen on Island settings tab, toggle autoTour, and invoke miracle.
    fg.toggle();
    fg.handleKey("3", guide, currentSettings, callbacks);
    expect(fg.tab).toBe("island");
    fg.handleKey("ArrowRight", guide, currentSettings, callbacks);
    expect(currentSettings.autoTour).toBe(true);
    fg.handleKey("g", guide, currentSettings, callbacks);
    expect(miracleCalls).toBe(1);

    // Auto-closes after 15 minutes of inactivity.
    fg.update(GUIDE_IDLE_S + 1, {
      guide,
      settings: currentSettings,
      portrait: null,
      clock: null,
      sky: null,
    });
    expect(fg.open).toBe(false);
    for (let t = 0; t < GUIDE_OUT_S + 0.1; t += 0.05) {
      fg.update(0.05, {
        guide,
        settings: currentSettings,
        portrait: null,
        clock: null,
        sky: null,
      });
    }
    expect(fg.showing).toBe(false);
  });
});
