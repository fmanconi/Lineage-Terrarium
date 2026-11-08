/**
 * The desktop app's preferences kept on disk, not only in the browser's storage.
 *
 * `localStorage` belongs to the page's origin, port included: when the desktop app's port
 * changed (8080 taken, a random one instead) the sound, the mods and the settings were all
 * back to their defaults (seven ports in `data/desktop.log`, 08/11/2026). So on the
 * desktop the app keeps them in a file of its own (`DesktopApi.prefs_get`/`prefs_set`):
 * at the start they are put back into `localStorage` before anything reads it, and each
 * write through `browserStorage()` goes to the file too. In a plain browser nothing
 * changes.
 */
import { browserStorage, mirrorStorage } from "./settings";

/** Only the game's own keys travel to the file. */
export const PREFS_PREFIX = "lineage_";
/** How long the page waits for the desktop bridge before going on without it (ms). */
const BRIDGE_WAIT_MS = 2500;

export interface PrefsBridge {
  prefs_get(): Promise<Record<string, string>>;
  prefs_set(key: string, value: string): Promise<unknown>;
}

interface BridgeWindow {
  pywebview?: { api?: Partial<PrefsBridge> };
}

function bridgeOf(w: BridgeWindow): PrefsBridge | null {
  const api = w.pywebview?.api;
  return api?.prefs_get !== undefined && api.prefs_set !== undefined ? (api as PrefsBridge) : null;
}

/** The desktop bridge, once pywebview has put it on the page; null if it never comes. */
function waitForBridge(): Promise<PrefsBridge | null> {
  const w = window as unknown as BridgeWindow;
  const now = bridgeOf(w);
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener("pywebviewready", done);
      resolve(bridgeOf(w));
    };
    const timer = window.setTimeout(done, BRIDGE_WAIT_MS);
    window.addEventListener("pywebviewready", done);
  });
}

/**
 * Bring the saved preferences back and keep them saved from now on. The file wins over
 * what this origin's storage holds; a file still empty is filled from that storage, so
 * what was set before this came is kept.
 */
export async function restoreDesktopPrefs(bridge?: PrefsBridge | null): Promise<boolean> {
  const api = bridge === undefined ? await waitForBridge() : bridge;
  const storage = browserStorage();
  if (api === null || storage === null) return false;
  let saved: Record<string, string> = {};
  try {
    saved = (await api.prefs_get()) ?? {};
  } catch {
    return false;
  }
  const keys = Object.keys(saved).filter((key) => key.startsWith(PREFS_PREFIX));
  if (keys.length > 0) {
    for (const key of keys) {
      const value = saved[key];
      if (typeof value === "string") storage.setItem(key, value);
    }
  } else if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(PREFS_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) void api.prefs_set(key, value).catch(() => undefined);
    }
  }
  mirrorStorage((key, value) => {
    if (key.startsWith(PREFS_PREFIX)) void api.prefs_set(key, value).catch(() => undefined);
  });
  return true;
}
