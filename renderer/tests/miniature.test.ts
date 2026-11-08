import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MINIATURE_SETTINGS,
  MINIATURE_PRESETS,
  MINIATURE_STORAGE_KEY,
  MiniatureBadge,
  MiniatureManager,
  type DesktopPywebviewApi,
} from "../src/miniature";
import { memoryStorage } from "../src/mods/registry";
import { fakeCanvas } from "./support/canvas";

describe("MiniatureManager", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let manager: MiniatureManager;

  beforeEach(() => {
    storage = memoryStorage();
    manager = new MiniatureManager(storage);
  });

  afterEach(() => {
    delete (globalThis as unknown as { pywebview?: unknown }).pywebview;
  });

  it("initializes with default settings", () => {
    expect(manager.isActive()).toBe(false);
    expect(manager.getOpacity()).toBe(DEFAULT_MINIATURE_SETTINGS.opacity);
    expect(manager.getPresetIndex()).toBe(DEFAULT_MINIATURE_SETTINGS.presetIndex);
    expect(manager.getPreset().id).toBe("small");
  });

  it("adjusts opacity and clamps between 0.15 and 1.0", async () => {
    await manager.adjustOpacity(-0.1);
    expect(manager.getOpacity()).toBeCloseTo(0.75, 2);

    await manager.adjustOpacity(-0.7);
    expect(manager.getOpacity()).toBe(0.15); // Min clamp

    await manager.adjustOpacity(+1.5);
    expect(manager.getOpacity()).toBe(1.0); // Max clamp

    expect(manager.currentToast()).toContain("Trasparenza: 100%");
  });

  it("cycles size presets and clamps to valid indices", async () => {
    expect(manager.getPreset().id).toBe("small"); // index 1

    await manager.adjustSize(1);
    expect(manager.getPreset().id).toBe("medium"); // index 2

    await manager.adjustSize(10);
    expect(manager.getPreset().id).toBe("xl"); // max preset (index 4)

    await manager.adjustSize(-10);
    expect(manager.getPreset().id).toBe("micro"); // min preset (index 0)

    expect(manager.currentToast()).toContain("Micro (280x165)");
  });

  it("persists settings in storage", async () => {
    await manager.setOpacity(0.5);
    await manager.setSizeIndex(3);

    const saved = JSON.parse(storage.getItem(MINIATURE_STORAGE_KEY) ?? "{}");
    expect(saved.opacity).toBe(0.5);
    expect(saved.presetIndex).toBe(3);

    // New instance loads persisted settings
    const restored = new MiniatureManager(storage);
    expect(restored.getOpacity()).toBe(0.5);
    expect(restored.getPresetIndex()).toBe(3);
    expect(restored.getPreset().id).toBe("large");
  });

  it("handles keyboard shortcuts [ ] 0 - +", async () => {
    // Opacity down [
    const handled1 = await manager.handleKey({ key: "[" } as KeyboardEvent);
    expect(handled1).toBe(true);
    expect(manager.getOpacity()).toBeCloseTo(0.75, 2);

    // Opacity up ]
    const handled2 = await manager.handleKey({ key: "]" } as KeyboardEvent);
    expect(handled2).toBe(true);
    expect(manager.getOpacity()).toBeCloseTo(0.85, 2);

    // Reset to 100% with 0
    await manager.setOpacity(0.4);
    const handled0 = await manager.handleKey({ key: "0" } as KeyboardEvent);
    expect(handled0).toBe(true);
    expect(manager.getOpacity()).toBe(1.0);
  });

  it("interacts with pywebview desktop API when available", async () => {
    const mockApi: DesktopPywebviewApi = {
      toggle_miniature: vi.fn(async (w, h, op) => ({
        active: true,
        width: w,
        height: h,
        opacity: op,
      })),
      set_opacity: vi.fn(async (alpha) => alpha),
      resize_window: vi.fn(async (w, h) => ({ width: w, height: h })),
    };

    (globalThis as unknown as { pywebview: { api: DesktopPywebviewApi } }).pywebview = {
      api: mockApi,
    };

    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    const active = await manager.toggle(canvas);
    expect(active).toBe(true);
    expect(mockApi.toggle_miniature).toHaveBeenCalledWith(384, 225, 0.85);

    // While active, adjusting size calls resize_window
    await manager.adjustSize(1, canvas);
    expect(mockApi.resize_window).toHaveBeenCalledWith(512, 300);

    // Adjusting opacity calls set_opacity
    await manager.adjustOpacity(-0.1, canvas);
    expect(mockApi.set_opacity).toHaveBeenCalledWith(0.75);
  });
});

describe("MiniatureBadge", () => {
  beforeEach(() => {
    fakeCanvas();
  });

  it("renders toast when message is active and fades out", () => {
    const storage = memoryStorage();
    const manager = new MiniatureManager(storage);
    const badge = new MiniatureBadge(manager, 512, 300);

    expect(badge.element.style.display).toBe("none");

    manager.showToast("Test Miniature Toast");
    badge.update(0.1);

    expect(badge.element.style.display).toBe("block");
    expect(parseFloat(badge.element.style.opacity)).toBeGreaterThan(0);

    // Advance time past toast duration (2.8s)
    manager.update(3.0);
    badge.update(0.5);

    expect(badge.element.style.display).toBe("none");
  });
});
