import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MINIATURE_SETTINGS,
  MINIATURE_PRESETS,
  MINIATURE_STORAGE_KEY,
  MiniatureBadge,
  MiniatureManager,
  MiniatureToolbar,
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

describe("MiniatureToolbar", () => {
  beforeEach(() => {
    fakeCanvas();
  });

  afterEach(() => {
    delete (globalThis as unknown as { pywebview?: unknown }).pywebview;
  });

  it("stays hidden while miniature mode is inactive", () => {
    const storage = memoryStorage();
    const manager = new MiniatureManager(storage);
    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    const toolbar = new MiniatureToolbar(manager, canvas, 512, 300);

    toolbar.update(0.1);
    expect(toolbar.element.style.display).toBe("none");
    expect(toolbar.visible).toBe(false);
  });

  it("becomes visible when active and responds to clicks", async () => {
    const storage = memoryStorage();
    const manager = new MiniatureManager(storage);
    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    const toolbar = new MiniatureToolbar(manager, canvas, 512, 300);

    // Mock active state
    const mockApi: DesktopPywebviewApi = {
      toggle_miniature: vi.fn(async (w, h, op) => ({
        active: true,
        width: w,
        height: h,
        opacity: op,
      })),
      resize_window: vi.fn(async (w, h) => ({ width: w, height: h })),
      set_opacity: vi.fn(async (alpha) => alpha),
    };
    (globalThis as unknown as { pywebview: { api: DesktopPywebviewApi } }).pywebview = {
      api: mockApi,
    };

    await manager.toggle(canvas);
    expect(manager.isActive()).toBe(true);

    // Update toolbar
    toolbar.wake();
    toolbar.update(0.1);
    expect(toolbar.element.style.display).toBe("block");
    expect(toolbar.visible).toBe(true);

    // Toolbar is centered: left = Math.round((512 - 211) / 2) = 150, top = 6
    const left = 150;
    const top = 6;

    // Click [-] (size-down): box at x: 4..14, y: 2..12 -> artX = 150 + 8 = 158, artY = 6 + 6 = 12
    const handledSizeDown = toolbar.handlePointer(left + 8, top + 6);
    expect(handledSizeDown).toBe(true);
    expect(manager.getPreset().id).toBe("micro");

    // Click [+] (size-up): box at x: 49..59 -> artX = 150 + 54 = 204
    const handledSizeUp = toolbar.handlePointer(left + 54, top + 6);
    expect(handledSizeUp).toBe(true);
    expect(manager.getPreset().id).toBe("small");

    // Click opacity-down '[': box at x: 75..85 -> artX = 150 + 80 = 230
    const handledOpacDown = toolbar.handlePointer(left + 80, top + 6);
    expect(handledOpacDown).toBe(true);
    expect(manager.getOpacity()).toBeCloseTo(0.75, 2);

    // Click opacity-up ']': box at x: 114..124 -> artX = 150 + 118 = 268
    const handledOpacUp = toolbar.handlePointer(left + 118, top + 6);
    expect(handledOpacUp).toBe(true);
    expect(manager.getOpacity()).toBeCloseTo(0.85, 2);

    // Click reset-opacity [100]: box at x: 140..165 -> artX = 150 + 152 = 302
    const handledReset = toolbar.handlePointer(left + 152, top + 6);
    expect(handledReset).toBe(true);
    expect(manager.getOpacity()).toBe(1.0);

    // Click dock [Dock]: box at x: 181..206 -> artX = 150 + 193 = 343
    const handledDock = toolbar.handlePointer(left + 193, top + 6);
    expect(handledDock).toBe(true);
    // Miniature toggles off
    expect(mockApi.toggle_miniature).toHaveBeenCalledTimes(2);
  });

  it("handles mouse wheel gestures for size and opacity", async () => {
    const storage = memoryStorage();
    const manager = new MiniatureManager(storage);
    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    const toolbar = new MiniatureToolbar(manager, canvas, 512, 300);

    const mockApi: DesktopPywebviewApi = {
      toggle_miniature: vi.fn(async (w, h, op) => ({
        active: true,
        width: w,
        height: h,
        opacity: op,
      })),
      resize_window: vi.fn(async (w, h) => ({ width: w, height: h })),
      set_opacity: vi.fn(async (alpha) => alpha),
    };
    (globalThis as unknown as { pywebview: { api: DesktopPywebviewApi } }).pywebview = {
      api: mockApi,
    };

    await manager.toggle(canvas);
    toolbar.wake();
    toolbar.update(0.1);

    // Ctrl + Wheel up: scales size up
    const ctrlWheelUp = { ctrlKey: true, shiftKey: false, altKey: false, deltaY: -100 } as WheelEvent;
    const handled1 = toolbar.handleWheel(ctrlWheelUp, 0, 0);
    expect(handled1).toBe(true);
    expect(manager.getPreset().id).toBe("medium");

    // Shift + Wheel down: decreases opacity
    const shiftWheelDown = { ctrlKey: false, shiftKey: true, altKey: false, deltaY: 100 } as WheelEvent;
    const handled2 = toolbar.handleWheel(shiftWheelDown, 0, 0);
    expect(handled2).toBe(true);
    expect(manager.getOpacity()).toBeCloseTo(0.80, 2);
  });

  it("fades out when idle and wakes on interaction", async () => {
    const storage = memoryStorage();
    const manager = new MiniatureManager(storage);
    const canvas = { style: {} } as unknown as HTMLCanvasElement;
    const toolbar = new MiniatureToolbar(manager, canvas, 512, 300);

    const mockApi: DesktopPywebviewApi = {
      toggle_miniature: vi.fn(async (w, h, op) => ({ active: true, width: w, height: h, opacity: op })),
    };
    (globalThis as unknown as { pywebview: { api: DesktopPywebviewApi } }).pywebview = {
      api: mockApi,
    };

    await manager.toggle(canvas);
    toolbar.wake();
    toolbar.update(0.1);
    expect(toolbar.visible).toBe(true);

    // Idle for 4 seconds
    toolbar.update(4.0);
    expect(toolbar.element.style.display).toBe("none");

    // Wake up
    toolbar.wake();
    toolbar.update(0.2);
    expect(toolbar.element.style.display).toBe("block");
    expect(toolbar.visible).toBe(true);
  });
});
