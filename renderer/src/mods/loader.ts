/**
 * The user's mods (`mods/README.md`): after the built-in mods, the scene asks the server
 * which mods sit in `mods/` (`GET /api/mods`), imports each client mod's entry module at
 * run time and registers what it exports. From then on it is a mod like the others.
 *
 * Nothing here may stop the scene: with no server (the demo's pages, `vite dev`, offline),
 * a list that is not JSON, or a mod that fails to load, the scene goes on without it.
 */
import type { ModRegistry } from "./registry";
import type { Mod } from "./types";

export const USER_MODS_PATH = "/api/mods";

/** One entry of `/api/mods`: a mod's `mod.json`, its kind, and a client mod's entry URL. */
export interface UserModInfo {
  id: string;
  kind: "client" | "sim";
  /** The URL of a client mod's ES module (`/user-mods/<id>/<entry>`). */
  entry?: string;
  /** `false` keeps the mod out of the scene entirely. */
  enabled?: boolean;
}

export interface LoaderOptions {
  fetch?: typeof globalThis.fetch;
  /** Imports a module by URL; tests hand in their own. */
  importModule?: (url: string) => Promise<unknown>;
}

const importByUrl = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

function isUserModInfo(value: unknown): value is UserModInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Record<string, unknown>;
  return typeof info.id === "string" && (info.kind === "client" || info.kind === "sim");
}

function isMod(value: unknown): value is Mod {
  if (typeof value !== "object" || value === null) return false;
  const mod = value as Record<string, unknown>;
  const meta = mod.meta as Record<string, unknown> | undefined;
  return (
    typeof meta === "object" &&
    meta !== null &&
    typeof meta.id === "string" &&
    ["init", "enable", "disable", "isEnabled"].every((name) => typeof mod[name] === "function")
  );
}

/** The mod a module exports: its default (or `Mod`) export, a class or a factory. */
function instantiate(module: unknown): unknown {
  if (typeof module !== "object" || module === null) return null;
  const exports = module as Record<string, unknown>;
  const made = exports.default ?? exports.Mod;
  if (typeof made !== "function") return made;
  // Classes and plain functions have a prototype and are constructed; arrow factories are
  // called.
  const maker = made as (new () => unknown) & (() => unknown);
  return typeof maker.prototype === "object" ? new maker() : maker();
}

/** Load and register the client mods the server lists; returns how many were registered. */
export async function loadUserMods(
  registry: ModRegistry,
  options: LoaderOptions = {},
): Promise<number> {
  const fetchList = options.fetch ?? globalThis.fetch;
  const importModule = options.importModule ?? importByUrl;
  let listed: unknown;
  try {
    const response = await fetchList(USER_MODS_PATH);
    if (!response.ok) return 0;
    listed = await response.json();
  } catch {
    // No server behind the page: there are no user mods to load.
    return 0;
  }
  if (!Array.isArray(listed)) return 0;
  let registered = 0;
  for (const info of listed) {
    if (!isUserModInfo(info) || info.kind !== "client" || info.enabled === false) continue;
    if (typeof info.entry !== "string") continue;
    try {
      const mod = instantiate(await importModule(info.entry));
      if (!isMod(mod)) throw new Error("its entry does not export a mod");
      if (mod.meta.id !== info.id) {
        throw new Error(`its meta.id "${mod.meta.id}" is not its mod.json's id`);
      }
      registry.register(mod);
      registered += 1;
    } catch (error) {
      console.warn(`User mod "${info.id}" was not loaded:`, error);
    }
  }
  return registered;
}
