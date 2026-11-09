import { expect, test, type Page } from "@playwright/test";

/**
 * The atmosphere (R4): the light of each time of day, the glow pass, the weather of
 * events and the end of a world, as snapshots of fixed states. The light and events are
 * asked for (`?show=`, `atmosphere/demo.ts`) over the autumn recording's last day; with
 * `?still` the atmosphere moves only when the test moves it (`__advance`), so every
 * picture is the same every time. Regenerate with `npx playwright test --update-snapshots`
 * after a change to the look, and look at them first.
 */

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?recording=autumn&every=0&still&quiet&seed=7&${query}`);
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  return errors;
}

/** Move the atmosphere on by `seconds`, and wait for a frame to draw it. */
async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => window.__advance?.(s), seconds);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

/**
 * Each shot's query, how far it is moved on, and then how far again: an event's flash goes
 * off in the frame it strikes, so a shot of what it leaves moves on past it.
 */
const SHOTS: Record<string, { query: string; advance?: number; then?: number }> = {
  // The light of each time of day, on the map.
  "light-day": { query: "view=map&show=day" },
  "light-dusk": { query: "view=map&show=dusk" },
  "light-dawn": { query: "view=map&show=dawn" },
  "light-night": { query: "view=map&show=night" },
  "light-moon": { query: "view=map&show=moon" },
  // The weather of events, in the middle view.
  "fire-night": { query: "view=middle&x=120&y=60&show=night,fire", advance: 1.3 },
  "fire-local": { query: "view=local&x=120&y=60&show=night,fire", advance: 1.3 },
  rain: { query: "view=middle&x=120&y=60&show=day,rain", advance: 1 },
  "rain-local": { query: "view=local&x=120&y=60&show=day,rain", advance: 1 },
  storm: { query: "view=middle&x=120&y=60&show=day,storm", advance: 1 },
  "burnt-middle": { query: "view=middle&x=120&y=60&show=day,burnt" },
  "burnt-local": { query: "view=local&x=120&y=60&show=day,burnt" },
  "volcano-local": { query: "view=local&x=120&y=60&show=day,volcano", advance: 3 },
  volcano: { query: "view=middle&x=120&y=60&show=day,volcano", advance: 3 },
  meteor: { query: "view=middle&x=120&y=60&show=day,meteor", advance: 0.8 },
  "meteor-crater": { query: "view=middle&x=120&y=60&show=day,meteor", advance: 4, then: 1 },
  ark: { query: "view=middle&x=120&y=60&show=dusk,ark", advance: 2 },
  seed: { query: "view=middle&x=120&y=60&show=night,seed", advance: 2 },
  // The end of a world: the fire, the flood, and the land rising again.
  "end-fire": { query: "view=map&show=day,end", advance: 45 },
  "end-flood": { query: "view=map&show=day,end", advance: 85 },
  "end-rise": { query: "view=map&show=day,end", advance: 170 },
};

for (const [name, shot] of Object.entries(SHOTS)) {
  test(`the atmosphere: ${name}`, async ({ page }) => {
    const errors = await open(page, shot.query);
    if (shot.advance !== undefined) await advance(page, shot.advance);
    if (shot.then !== undefined) {
      // The landscape's own fades (plants going, the ground's cross-fade) run on the page's
      // clock, not the atmosphere's: let them finish.
      await page.waitForTimeout(4000);
      await advance(page, shot.then);
    }
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.002 });
  });
}

test("the light comes from the stream: the office recording ends in the dark", async ({ page }) => {
  // All of it at once: the last sky is midnight after two weeks of office hours.
  await page.goto("/?recording=office&every=0&still&quiet&view=map");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const state = await page.evaluate(() => window.__atmosphere?.());
  // Dark: night, or the moonlight floor of a long absence (it is 0.15 there).
  expect(state?.light).toBeLessThanOrEqual(0.15 + 1e-6);
  // Moonlit blue: more blue than red.
  const tint = state?.tint ?? 0;
  expect(tint & 0xff).toBeGreaterThan(tint >> 16);
});

test("an animal with the glow gene shines at night, not by day", async ({ page }) => {
  await page.goto("/?recording=office&every=0&still&quiet&seed=7&view=local&x=120&y=60&show=night");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const glowing = await page.evaluate(() => {
    // The fixture's world has no glowing animal: one is sent as the stream would.
    const genome = Array.from({ length: 32 }, () => 0.5);
    window.__receive?.({
      type: "creatures",
      protocol: 1,
      t_ms: 0,
      ids: [900001],
      positions: [[120, 60]],
      species: [1],
      born: [{ id: 900001, genome, slots: 128 }],
      torpid: [],
    });
    return true;
  });
  expect(glowing).toBe(true);
  await advance(page, 0.1);
  const night = await page.evaluate(() => window.__atmosphere?.().lights ?? 0);
  expect(night).toBeGreaterThan(0);
  await expect(page).toHaveScreenshot("glow-night.png", { maxDiffPixelRatio: 0.002 });
  await page.evaluate(() =>
    window.__receive?.({
      type: "sky",
      protocol: 1,
      t_ms: 1,
      light: 1,
      present: true,
      rain: "none",
      burning: [],
    }),
  );
  await advance(page, 0.1);
  expect(await page.evaluate(() => window.__atmosphere?.().lights ?? -1)).toBe(0);
});

test("a world ends on the map, the button waits, and the next world rises", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A sim-day in under five seconds: the herd starves at the start of the second.
  await page.goto("/?recording=end&speed=20000&seed=3");
  await page.waitForFunction(() => typeof window.__atmosphere?.().act === "string", null, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => window.__camera?.().view)).toBe("map");
  // The world's last lines are told as it ends (hunters landing on the starving herd first).
  // Each line stays open for its reading time, on the page's own clock; the end goes on.
  const told = Date.now();
  await page.waitForFunction(() => window.__captions?.().text?.includes("last creature"), null, {
    timeout: 45_000,
  });
  // The button does nothing while the world ends.
  await page.evaluate(() => window.__press?.());
  await advance(page, 1);
  expect(await page.evaluate(() => window.__camera?.().view)).toBe("map");
  await advance(page, Math.max(0, 124 - (Date.now() - told) / 1000));
  expect(await page.evaluate(() => window.__atmosphere?.().act)).toBe("dark");
  await advance(page, 60);
  expect(await page.evaluate(() => window.__atmosphere?.().act)).toBeNull();
  // And then it works again.
  await page.evaluate(() => window.__press?.());
  await page.waitForFunction(() => window.__camera?.().view === "middle", null, {
    timeout: 10_000,
  });
  expect(errors).toEqual([]);
});

test("a volcano raises its cone in the land, and the scene draws it", async ({ page }) => {
  const base = "/?recording=office&every=0&still&quiet&seed=7&view=middle&x=120&y=60";
  await page.goto(`${base}&show=day`);
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const flat = await page.evaluate(() => window.__landAt?.(120.5, 60.5)?.height ?? 0);
  await page.goto(`${base}&show=day,volcano`);
  await page.waitForFunction(() => (window.__landAt?.(120.5, 60.5)?.height ?? 0) > 0, null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (h) => (window.__landAt?.(120.5, 60.5)?.height ?? 0) > h + 0.05,
    flat,
    {
      timeout: 60_000,
    },
  );
  expect(await page.evaluate(() => window.__atmosphere?.().effects)).toContain("cone");
});

test("fire up close draws flames, and a thunderstorm its bolts", async ({ page }) => {
  await page.goto(
    "/?recording=autumn&every=0&still&quiet&seed=7&view=local&x=120&y=60&show=night,fire",
  );
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  await advance(page, 0.1);
  const fire = await page.evaluate(() => window.__atmosphere?.());
  expect(fire?.flames).toBeGreaterThan(20);
  expect(fire?.rain).toBe("storm");
  // The strike that set it: the biggest bolt, drawn in its first moments.
  expect(fire?.bolts).toBeGreaterThan(50);
  expect(fire?.ripples).toBeGreaterThanOrEqual(0);
});

test("the ark's newcomers come into being under its light", async ({ page }) => {
  const errors = await open(page, "view=local&x=120&y=60&show=day,ark");
  await advance(page, 1);
  await advance(page, 1);
  const arrivals = (await page.evaluate(() => window.__atmosphere?.().effects ?? [])).filter(
    (kind) => kind === "arrival",
  );
  expect(arrivals).toHaveLength(6); // the demo's ark brings six
  expect(errors).toEqual([]);
});

test("the seed's sprouts come up on the land it sowed", async ({ page }) => {
  const errors = await open(page, "view=middle&x=120&y=60&show=day,burnt,seed");
  expect(await page.evaluate(() => window.__atmosphere?.().sown)).toBe(0);
  for (let s = 0; s < 6; s++) await advance(page, 1);
  expect(await page.evaluate(() => window.__atmosphere?.().sown ?? 0)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("a meteor's crater shows in the land only once the meteor has struck", async ({ page }) => {
  const errors = await open(page, "view=middle&x=120&y=60&show=day");
  const before = await page.evaluate(() => window.__landAt?.(120.5, 60.5)?.height ?? -1);
  expect(before).toBeGreaterThan(0);
  // The stream's order: the crater's news, then the land it changed (here, all sea floor).
  await page.evaluate(async () => {
    const recording = (await (await fetch("/stream/recording.json")).json()) as {
      messages: { type: string; heights?: { data: string } }[];
    };
    const land = recording.messages.find((m) => m.type === "land");
    if (land?.heights === undefined) throw new Error("no land");
    const flat = {
      ...land,
      t_ms: 1,
      heights: { ...land.heights, data: btoa("\0".repeat(atob(land.heights.data).length)) },
    };
    window.__receive?.({
      type: "events",
      protocol: 1,
      t_ms: 1,
      events: [{ kind: "crater", t_ms: 1, x: 120, y: 60, radius_cells: 3 }],
    } as never);
    window.__receive?.(flat as never);
  });
  await advance(page, 0.5);
  expect(await page.evaluate(() => window.__landAt?.(120.5, 60.5)?.height)).toBe(before);
  await advance(page, 1);
  await page.waitForFunction(() => (window.__landAt?.(120.5, 60.5)?.height ?? 1) === 0, null, {
    timeout: 10_000,
  });
  expect(errors).toEqual([]);
});

test("cloud greys the world, more so rain; a clear day is not graded", async ({ page }) => {
  for (const [sky, graded] of [
    ["day", false],
    ["day,cloud", true],
    ["day,rain", true],
  ] as const) {
    await open(page, `view=middle&x=120&y=60&show=${sky}`);
    await advance(page, 4);
    expect(await page.evaluate(() => window.__atmosphere?.().graded)).toBe(graded);
  }
});

test("a view's fall is all snow where its land is snowy, all rain where it is not", async ({
  page,
}) => {
  // Round 7 (the owner): rain and snow mixed where snow lay in patches looked wrong.
  await page.goto(
    "/?recording=winter&every=0&still&quiet&seed=7&view=local&x=140.5&y=60.5&show=day,rain",
  );
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  await advance(page, 3);
  const winter = await page.evaluate(() => window.__atmosphere?.());
  expect(winter?.snowfall).toBe(1);
  expect(winter?.weather ?? 0).toBeGreaterThan(0);
  await expect(page).toHaveScreenshot("snow-local.png", { maxDiffPixelRatio: 0.002 });
  await open(page, "view=local&x=120&y=60&show=day,rain");
  await advance(page, 3);
  expect(await page.evaluate(() => window.__atmosphere?.().snowfall)).toBe(0);
});
