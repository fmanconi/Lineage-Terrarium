import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Scene, Subject } from "../../src/director";
import {
  DramaticDirectorEngine,
  DramaticDirectorMod,
  dramaticDirector,
  isDramaticDirectorActive,
  setDramaticDirectorActive,
} from "../../src/mods/builtin/dramatic-director";
import { MODS_STORAGE_KEY, ModRegistry, memoryStorage } from "../../src/mods/registry";
import type { ModContext } from "../../src/mods/types";
import { fakeCanvas } from "../support/canvas";

const mockSubject = (id: number, x = 10, y = 10, torpid = false, species = 1): Subject => ({
  id,
  x,
  y,
  torpid,
  species,
});

const mockScene = (subjects: Subject[]): Scene => ({
  width: 100,
  height: 100,
  isLand: () => true,
  subjects,
  ready: true,
});

describe("DramaticDirectorMod", () => {
  let frame: HTMLElement;
  let children: { dataset?: { testid?: string } }[];
  let ctx: ModContext;

  beforeEach(() => {
    fakeCanvas();
    children = [];
    frame = {
      appendChild: (el: { dataset?: { testid?: string } }) => children.push(el),
      querySelector: (selector: string) =>
        children.find((c) => selector.includes(c.dataset?.testid ?? "")) ?? null,
    } as unknown as HTMLElement;
    ctx = {
      frame,
      width: 512,
      height: 300,
      storage: memoryStorage(),
    };
  });

  afterEach(() => {
    setDramaticDirectorActive(false);
  });

  it("declares metadata correctly with defaultEnabled=true", () => {
    const mod = new DramaticDirectorMod();
    expect(mod.meta.id).toBe("dramatic-director");
    expect(mod.meta.name).toBe("Event Camera");
    expect(mod.meta.version).toBe("1.0.0");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("switches active state via enable/disable", () => {
    const mod = new DramaticDirectorMod();
    expect(isDramaticDirectorActive()).toBe(false);
    mod.enable();
    expect(isDramaticDirectorActive()).toBe(true);
    expect(mod.isEnabled()).toBe(true);
    mod.disable();
    expect(isDramaticDirectorActive()).toBe(false);
    expect(mod.isEnabled()).toBe(false);
  });

  it("persists toggle state in ModRegistry", () => {
    const storage = memoryStorage();
    const registry = new ModRegistry(storage);
    const mod = new DramaticDirectorMod();
    registry.register(mod);
    registry.initAll(ctx);

    expect(isDramaticDirectorActive()).toBe(true);
    expect(registry.isModEnabled("dramatic-director")).toBe(true);

    expect(registry.toggleMod("dramatic-director")).toBe(false);
    expect(isDramaticDirectorActive()).toBe(false);
    expect(JSON.parse(storage.getItem(MODS_STORAGE_KEY) ?? "{}")).toEqual({
      "dramatic-director": false,
    });
  });

  it("appends badge to frame during init and updates it", () => {
    const mod = new DramaticDirectorMod();
    mod.init(ctx);
    const badge = frame.querySelector('[data-testid="dramatic-badge"]');
    expect(badge).not.toBeNull();

    mod.enable();
    dramaticDirector.recordBirth(42, undefined, 0, 1);
    const scene = mockScene([mockSubject(42)]);
    dramaticDirector.chooseNext(scene, null, () => 0.5);

    expect(dramaticDirector.currentLabel()).toBe("Nuova Creatura");
    mod.update(0.1);
    expect((badge as HTMLElement).style.display).toBe("block");
  });
});

describe("DramaticDirectorEngine", () => {
  let engine: DramaticDirectorEngine;

  beforeEach(() => {
    engine = new DramaticDirectorEngine();
    engine.setActive(true);
  });

  afterEach(() => {
    engine.setActive(false);
  });

  it("prioritizes rare mutations (score 100) over normal births (score 85)", () => {
    engine.recordBirth(10, 1, 0, 1); // standard birth (score 85)
    engine.recordBirth(20, 2, 2, 1); // mutation (score 100)

    const scene = mockScene([mockSubject(10), mockSubject(20)]);
    const chosen = engine.chooseNext(scene, null, () => 0.5);

    expect(chosen).not.toBeNull();
    expect(chosen?.id).toBe(20);
    expect(engine.currentLabel()).toContain("Mutazione");
  });

  it("prioritizes disasters (score 95) over hunts (score 82)", () => {
    engine.recordHunt(5, 6, 20, 20); // score 82
    engine.recordDisaster("volcano", 100, 100); // score 95

    const scene = mockScene([mockSubject(5), mockSubject(50, 95, 95)]);
    const chosen = engine.chooseNext(scene, null, () => 0.5);

    expect(chosen).not.toBeNull();
    expect(chosen?.id).toBe(50); // nearest creature to the volcano (100, 100)
    expect(engine.currentLabel()).toBe("Eruzione Vulcanica");
  });

  it("records and chooses clashes and courtships", () => {
    engine.recordCourtship(7, 8, 30, 30);
    const scene = mockScene([mockSubject(7, 30, 30), mockSubject(8, 31, 30)]);
    const chosen = engine.chooseNext(scene, null, () => 0.5);

    expect(chosen).not.toBeNull();
    expect(chosen?.id).toBe(7);
    expect(engine.currentLabel()).toBe("Corteggiamento");
  });

  it("identifies urgent pending events with peekUrgent", () => {
    const scene = mockScene([mockSubject(1), mockSubject(2)]);
    expect(engine.peekUrgent(scene, 1)).toBeNull();

    // Normal death score 60 is not urgent (< 85)
    engine.recordDeath(2, "age");
    expect(engine.peekUrgent(scene, 1)).toBeNull();

    // Rare mutation score 100 is urgent
    engine.recordBirth(2, 1, 1, 1);
    const urgent = engine.peekUrgent(scene, 1);
    expect(urgent).not.toBeNull();
    expect(urgent?.type).toBe("mutation");
    expect(urgent?.subjectId).toBe(2);

    // If currently following subject 2, it is not urgent for switching
    expect(engine.peekUrgent(scene, 2)).toBeNull();
  });

  it("shortens follow time on torpid (sleeping) subjects", () => {
    const active = mockSubject(1, 0, 0, false);
    const torpid = mockSubject(2, 0, 0, true);

    const timeActive = engine.currentFollowTime(active, () => 0.5);
    const timeTorpid = engine.currentFollowTime(torpid, () => 0.5);

    expect(timeTorpid).toBeLessThan(timeActive);
    expect(timeTorpid).toBeLessThanOrEqual(16);
  });

  it("falls back to active lively creatures when no events are queued", () => {
    const sleeping = mockSubject(1, 0, 0, true);
    const active = mockSubject(2, 0, 0, false);
    const scene = mockScene([sleeping, active]);

    const chosen = engine.chooseNext(scene, null, () => 0);
    expect(chosen?.id).toBe(2);
  });
});
