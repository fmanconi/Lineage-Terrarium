import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Each worktree can run its own: two on one machine must not share (and reuse) a server.
const port = Number(process.env["PLAYWRIGHT_PORT"] ?? 4173);

// The snapshots are of the island itself: every built-in mod (src/mods/builtin, most of them
// on by default) starts switched off, as the mod menu (M) would leave it in the page's
// storage. Read from the sources, so a new mod is off here too.
const BUILTIN_MODS = join(import.meta.dirname, "src", "mods", "builtin");
const builtinModIds = readdirSync(BUILTIN_MODS)
  .filter((file) => file.endsWith(".ts"))
  .flatMap((file) =>
    [...readFileSync(join(BUILTIN_MODS, file), "utf8").matchAll(/^\s+id: "([a-z0-9-]+)"/gm)].map(
      (match) => match[1],
    ),
  );
const modsOff = JSON.stringify(Object.fromEntries(builtinModIds.map((id) => [id, false])));

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${port}`,
          localStorage: [{ name: "lineage_mods_state_v1", value: modsOff }],
        },
      ],
    },
  },
  projects: [
    {
      name: "desk",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 600 } },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
