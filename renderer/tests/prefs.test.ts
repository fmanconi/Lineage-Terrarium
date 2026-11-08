import { afterEach, describe, expect, it } from "vitest";
import { restoreDesktopPrefs, type PrefsBridge } from "../src/prefs";
import { browserStorage, mirrorStorage } from "../src/settings";

/** A page's localStorage, in memory. */
function fakeLocalStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
  };
}

function fakeBridge(file: Record<string, string>): PrefsBridge & { file: Record<string, string> } {
  return {
    file,
    prefs_get: () => Promise.resolve({ ...file }),
    prefs_set: (k, v) => {
      file[k] = v;
      return Promise.resolve(true);
    },
  };
}

const g = globalThis as { localStorage?: Storage };

afterEach(() => {
  mirrorStorage(null);
  delete g.localStorage;
});

describe("the desktop's preferences on disk", () => {
  it("puts the saved ones back into a fresh page's storage (a new port)", async () => {
    g.localStorage = fakeLocalStorage();
    const bridge = fakeBridge({ lineage_biophony_settings_v1: '{"muted":true}', other: "x" });
    expect(await restoreDesktopPrefs(bridge)).toBe(true);
    expect(g.localStorage.getItem("lineage_biophony_settings_v1")).toBe('{"muted":true}');
    expect(g.localStorage.getItem("other")).toBeNull();
  });

  it("saves each write through browserStorage to the file", async () => {
    g.localStorage = fakeLocalStorage();
    const bridge = fakeBridge({ lineage_x: "1" });
    await restoreDesktopPrefs(bridge);
    browserStorage()?.setItem("lineage_mods_state_v1", '{"health-bars":false}');
    browserStorage()?.setItem("not_ours", "y");
    expect(bridge.file.lineage_mods_state_v1).toBe('{"health-bars":false}');
    expect(bridge.file.not_ours).toBeUndefined();
  });

  it("fills an empty file from what the page already had", async () => {
    g.localStorage = fakeLocalStorage({ lineage_terrarium_settings_v1: "{}", junk: "z" });
    const bridge = fakeBridge({});
    await restoreDesktopPrefs(bridge);
    expect(bridge.file).toEqual({ lineage_terrarium_settings_v1: "{}" });
  });

  it("does nothing without the desktop bridge", async () => {
    g.localStorage = fakeLocalStorage();
    expect(await restoreDesktopPrefs(null)).toBe(false);
    expect(browserStorage()).toBe(g.localStorage);
  });
});
