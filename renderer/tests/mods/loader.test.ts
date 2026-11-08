import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MODS_PATH, loadUserMods } from "../../src/mods/loader";
import type { ModRegistry } from "../../src/mods/registry";
import type { Mod, ModMetadata } from "../../src/mods/types";

/** A user mod as `mods/client/<id>/index.js` would export it. */
function modClass(id: string): new () => Mod {
  return class implements Mod {
    readonly meta: ModMetadata = {
      id,
      name: id,
      version: "1.0.0",
      description: `The ${id} mod.`,
      defaultEnabled: false,
    };
    init(): void {}
    enable(): void {}
    disable(): void {}
    isEnabled(): boolean {
      return false;
    }
  };
}

/** The registry's one method the loader calls, refusing ids it has seen, as the real one. */
function mockRegistry(): { registry: ModRegistry; registered: Mod[] } {
  const registered: Mod[] = [];
  const registry = {
    register: vi.fn((mod: Mod) => {
      if (registered.some((seen) => seen.meta.id === mod.meta.id)) {
        throw new Error(`Mod "${mod.meta.id}" is already registered`);
      }
      registered.push(mod);
    }),
  } as unknown as ModRegistry;
  return { registry, registered };
}

function answering(body: unknown, ok = true): typeof globalThis.fetch {
  return vi.fn(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof globalThis.fetch;
}

const client = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: id,
  kind: "client",
  entry: `/user-mods/${id}/index.js`,
  ...extra,
});

describe("loadUserMods", () => {
  const realFetch = globalThis.fetch;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    warn.mockRestore();
  });

  it("imports each client mod's entry and registers its default export", async () => {
    globalThis.fetch = answering([
      client("sample-banner"),
      { id: "rainmaker", kind: "sim" },
      client("second"),
    ]);
    const modules: Record<string, unknown> = {
      "/user-mods/sample-banner/index.js": { default: modClass("sample-banner") },
      "/user-mods/second/index.js": { Mod: modClass("second") },
    };
    const importModule = vi.fn((url: string) => Promise.resolve(modules[url]));
    const { registry, registered } = mockRegistry();

    expect(await loadUserMods(registry, { importModule })).toBe(2);
    expect(globalThis.fetch).toHaveBeenCalledWith(USER_MODS_PATH);
    expect(importModule.mock.calls.map(([url]) => url)).toEqual([
      "/user-mods/sample-banner/index.js",
      "/user-mods/second/index.js",
    ]);
    expect(registered.map((mod) => mod.meta.id)).toEqual(["sample-banner", "second"]);
  });

  it("takes a factory function as well as a class", async () => {
    globalThis.fetch = answering([client("factory")]);
    const made = new (modClass("factory"))();
    const importModule = () => Promise.resolve({ default: () => made });
    const { registry, registered } = mockRegistry();

    expect(await loadUserMods(registry, { importModule })).toBe(1);
    expect(registered).toEqual([made]);
  });

  it("skips mods switched off in mod.json, and those with no entry", async () => {
    globalThis.fetch = answering([
      client("off", { enabled: false }),
      client("bare", { entry: undefined }),
    ]);
    const importModule = vi.fn(() => Promise.resolve({ default: modClass("off") }));
    const { registry, registered } = mockRegistry();

    expect(await loadUserMods(registry, { importModule })).toBe(0);
    expect(importModule).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
  });

  it("goes on past a mod that fails, a wrong export or a mismatched id", async () => {
    globalThis.fetch = answering([
      client("broken"),
      client("not-a-mod"),
      client("liar"),
      client("taken"),
      client("good"),
    ]);
    const modules: Record<string, unknown> = {
      "/user-mods/not-a-mod/index.js": { default: { hello: "world" } },
      "/user-mods/liar/index.js": { default: modClass("someone-else") },
      "/user-mods/taken/index.js": { default: modClass("taken") },
      "/user-mods/good/index.js": { default: modClass("good") },
    };
    const importModule = (url: string): Promise<unknown> =>
      url in modules ? Promise.resolve(modules[url]) : Promise.reject(new Error("404"));
    const { registry, registered } = mockRegistry();
    registry.register(new (modClass("taken"))());

    expect(await loadUserMods(registry, { importModule })).toBe(1);
    expect(registered.map((mod) => mod.meta.id)).toEqual(["taken", "good"]);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("loads nothing, quietly, when there is no server to ask", async () => {
    const importModule = vi.fn();
    const { registry, registered } = mockRegistry();

    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("offline")));
    expect(await loadUserMods(registry, { importModule })).toBe(0);
    globalThis.fetch = answering(null, false);
    expect(await loadUserMods(registry, { importModule })).toBe(0);
    // `vite dev` answers every path with the page: not JSON.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("<")) } as Response),
    ) as unknown as typeof globalThis.fetch;
    expect(await loadUserMods(registry, { importModule })).toBe(0);
    globalThis.fetch = answering({ mods: [] });
    expect(await loadUserMods(registry, { importModule })).toBe(0);

    expect(importModule).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
