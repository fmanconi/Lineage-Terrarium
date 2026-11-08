import { describe, expect, it, beforeEach } from "vitest";
import {
  SeasonalFlairMod,
  seasonalFlairSystem,
  isSeasonalFlairActive,
  setSeasonalFlairActive,
} from "../../src/mods/builtin/seasons-flair";

describe("Seasonal Foliage & Blossoms Mod", () => {
  beforeEach(() => {
    seasonalFlairSystem.reset();
    setSeasonalFlairActive(false);
    seasonalFlairSystem.setForcedSeason(null);
  });

  it("registers metadata correctly", () => {
    const mod = new SeasonalFlairMod();
    expect(mod.meta.id).toBe("seasons-flair");
    expect(mod.meta.name).toBe("Seasonal Foliage & Blossoms");
    expect(mod.meta.defaultEnabled).toBe(true);
  });

  it("enables and disables cleanly", () => {
    const mod = new SeasonalFlairMod();
    expect(mod.isEnabled()).toBe(false);

    mod.enable();
    expect(mod.isEnabled()).toBe(true);
    expect(isSeasonalFlairActive()).toBe(true);

    mod.disable();
    expect(mod.isEnabled()).toBe(false);
    expect(isSeasonalFlairActive()).toBe(false);
  });

  it("updates season from clock and adjusts spawn rates", () => {
    seasonalFlairSystem.setClock("spring", 0.3);
    expect(seasonalFlairSystem.getActiveSeason()).toBe("spring");
    expect(seasonalFlairSystem.getSeasonProgress()).toBe(0.3);
    expect(seasonalFlairSystem.spawnRate()).toBe(12);

    seasonalFlairSystem.setClock("autumn", 0.7);
    expect(seasonalFlairSystem.getActiveSeason()).toBe("autumn");
    expect(seasonalFlairSystem.spawnRate()).toBe(20);
  });

  it("spawns seasonal particles during update when active", () => {
    const mod = new SeasonalFlairMod();
    mod.enable();
    seasonalFlairSystem.setClock("autumn", 0.5);

    expect(seasonalFlairSystem.getParticles().length).toBe(0);

    // Update 1.0 second: should spawn several autumn leaves
    mod.update(1.0, { season: "autumn", seasonProgress: 0.5 });
    const particles = seasonalFlairSystem.getParticles();
    expect(particles.length).toBeGreaterThan(0);
    expect(particles[0]!.kind).toBe("leaf");
    expect(particles[0]!.alpha).toBeGreaterThan(0);
  });

  it("simulates particle movement and aging", () => {
    const mod = new SeasonalFlairMod();
    mod.enable();
    seasonalFlairSystem.setClock("spring", 0.5);

    seasonalFlairSystem.spawnParticle(512, 300, 1.0, 0.2);
    const initial = seasonalFlairSystem.getParticles()[0]!;
    const initialY = initial.y;

    // Advance 0.5s
    seasonalFlairSystem.update(0.5, 512, 300, 1.0, 0.2);
    expect(initial.y).toBeGreaterThan(initialY);
    expect(initial.ageS).toBeCloseTo(0.5, 1);
  });
});
