/**
 * Lineage: Terrarium screensaver preferences (persisted locally in the browser, never
 * altering the 1:1 sacred simulation clock).
 */

export type NightDimmer = "off" | "soft" | "dark";
export type KeyBarMode = "auto" | "always" | "hidden";
export type FpsSetting = 30 | 60;

export interface TerrariumSettings {
  /** Autonomous documentary camera cycling (map -> middle -> local) vs resting on map. */
  autoTour: boolean;
  /** Extra bedroom night-darkening veil when solar light falls low. */
  nightDimmer: NightDimmer;
  /** Instant super-dark bedroom sleep mode (`N` / Night button), active at any hour. */
  sleepMode: boolean;
  /** Whether notable chronicle scrolls unroll at the foot of the screen. */
  showCaptions: boolean;
  /** Bottom-right key hint strip visibility mode. */
  keyBarMode: KeyBarMode;
  /** Frame rate cap for silent bedroom kiosk operation. */
  fpsCap: FpsSetting;
}

export const SETTINGS_STORAGE_KEY = "lineage_terrarium_settings_v1";

/** The key used before the fork was named Terrarium (ADR 0025); read when the new one is empty. */
export const LEGACY_SETTINGS_STORAGE_KEY = "lineage_smerdino_settings_v1";

/** Veil alpha (0–1) when the manual Sleep / Night button is active: 90% super-dark for sleeping. */
export const SLEEP_VEIL_ALPHA = 0.9;

export const DEFAULT_SETTINGS: Readonly<TerrariumSettings> = {
  autoTour: false,
  nightDimmer: "off",
  sleepMode: false,
  showCaptions: true,
  keyBarMode: "auto",
  fpsCap: 30,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Where each write also goes, once the desktop app keeps its preferences on disk (`prefs.ts`). */
let mirror: ((key: string, value: string) => void) | null = null;

/** Send every write through `browserStorage()` to `write` as well (null: stop). */
export function mirrorStorage(write: ((key: string, value: string) => void) | null): void {
  mirror = write;
}

/** The browser's `localStorage`, or null where it is missing or refused (kiosk sandbox, tests). */
export function browserStorage(): StorageLike | null {
  let storage: Storage | null;
  try {
    storage = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
  if (storage === null || mirror === null) return storage;
  const local = storage;
  const write = mirror;
  return {
    getItem: (key) => local.getItem(key),
    setItem: (key, value) => {
      local.setItem(key, value);
      write(key, value);
    },
  };
}

const NIGHT_DIMMERS: readonly NightDimmer[] = ["off", "soft", "dark"];
const KEYBAR_MODES: readonly KeyBarMode[] = ["auto", "always", "hidden"];

/** Load validated settings from storage, falling back to defaults on missing/invalid fields. */
export function loadSettings(storage: StorageLike | null = browserStorage()): TerrariumSettings {
  if (storage === null) return { ...DEFAULT_SETTINGS };
  try {
    const raw =
      storage.getItem(SETTINGS_STORAGE_KEY) ?? storage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nightDimmer = NIGHT_DIMMERS.includes(parsed["nightDimmer"] as NightDimmer)
      ? (parsed["nightDimmer"] as NightDimmer)
      : DEFAULT_SETTINGS.nightDimmer;
    const keyBarMode = KEYBAR_MODES.includes(parsed["keyBarMode"] as KeyBarMode)
      ? (parsed["keyBarMode"] as KeyBarMode)
      : DEFAULT_SETTINGS.keyBarMode;
    const fpsCap: FpsSetting = parsed["fpsCap"] === 60 ? 60 : 30;
    return {
      autoTour:
        typeof parsed["autoTour"] === "boolean" ? parsed["autoTour"] : DEFAULT_SETTINGS.autoTour,
      nightDimmer,
      sleepMode:
        typeof parsed["sleepMode"] === "boolean" ? parsed["sleepMode"] : DEFAULT_SETTINGS.sleepMode,
      showCaptions:
        typeof parsed["showCaptions"] === "boolean"
          ? parsed["showCaptions"]
          : DEFAULT_SETTINGS.showCaptions,
      keyBarMode,
      fpsCap,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Save settings to storage, ignoring storage quota or sandbox errors. */
export function saveSettings(
  settings: TerrariumSettings,
  storage: StorageLike | null = browserStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore private-mode or read-only kiosk profile errors.
  }
}

/**
 * Extra darkening alpha (0–0.9) laid over the scene. When manual `sleepMode` is active,
 * immediately returns `SLEEP_VEIL_ALPHA` (0.9) regardless of daytime; otherwise smoothly
 * ramps in only once island light drops below 0.45.
 */
export function nightVeilAlpha(light: number, mode: NightDimmer, sleepMode = false): number {
  if (sleepMode) return SLEEP_VEIL_ALPHA;
  if (mode === "off") return 0;
  const ceiling = mode === "dark" ? 0.58 : 0.32;
  const threshold = 0.45;
  const floor = 0.05;
  if (light >= threshold) return 0;
  const t = Math.min(Math.max((threshold - light) / (threshold - floor), 0), 1);
  const smooth = t * t * (3 - 2 * t);
  return ceiling * smooth;
}

/** Step a setting option forward (`delta = 1`) or backward (`delta = -1`). */
export function stepSetting(
  current: TerrariumSettings,
  index: number,
  delta: -1 | 1,
): TerrariumSettings {
  const next = { ...current };
  if (index === 0) {
    next.autoTour = !current.autoTour;
  } else if (index === 1) {
    if (current.sleepMode) {
      next.sleepMode = false;
    } else {
      const at = NIGHT_DIMMERS.indexOf(current.nightDimmer);
      const moved = (at + delta + NIGHT_DIMMERS.length) % NIGHT_DIMMERS.length;
      next.nightDimmer = NIGHT_DIMMERS[moved] ?? "off";
    }
  } else if (index === 2) {
    const at = KEYBAR_MODES.indexOf(current.keyBarMode);
    const moved = (at + delta + KEYBAR_MODES.length) % KEYBAR_MODES.length;
    next.keyBarMode = KEYBAR_MODES[moved] ?? "auto";
  } else if (index === 3) {
    next.showCaptions = !current.showCaptions;
  } else if (index === 4) {
    next.fpsCap = current.fpsCap === 30 ? 60 : 30;
  }
  return next;
}
