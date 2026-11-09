"""Presence (M8): the owner's presence is the sun, and the god-power button."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import replace
from pathlib import Path
from typing import TypeVar

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim.clock import MS_PER_DAY
from lineage_sim.config import Config, ConfigError, parse_config
from lineage_sim.events import (
    ChronicleEntry,
    CraterFormed,
    CreaturesArrived,
    FireEnded,
    GodPower,
    GodPowerReady,
    GodPowerRefused,
    GodPowerUsed,
    OutputEvent,
    PresenceChanged,
    VolcanoErupted,
)
from lineage_sim.fauna.genome import Gene
from lineage_sim.presence import (
    POWERS,
    Power,
    choose,
    next_light,
    plant_light,
    recent_light,
    target_light,
)
from lineage_sim.presence import weights as power_weights
from lineage_sim.state import io
from lineage_sim.world import World, default_subsystems
from numpy.random import PCG64, Generator

DAY_S = 86_400
HOUR_S = 3600
EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
_DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "default.toml"
_PRESENCE = parse_config(_DEFAULT_CONFIG.read_text(encoding="utf-8")).presence
# A 520-day world with plants and about 200 creatures, its owner just gone home (v8).
FIXTURE = Path(__file__).parent / "fixtures" / "saves" / "v8.lzma"


def _world(config: Config) -> World:
    return World.restore(config, io.loads(FIXTURE.read_bytes()))


_T = TypeVar("_T", bound=OutputEvent)


def _of(outputs: list[OutputEvent], kind: type[_T]) -> list[_T]:
    return [o for o in outputs if isinstance(o, kind)]


# --- light ----------------------------------------------------------------------------


def test_light_targets(config: Config) -> None:
    cfg = config.presence
    assert target_light(cfg, True, 0.0) == 1.0
    assert target_light(cfg, False, 1.0) == cfg.night_light
    assert target_light(cfg, False, cfg.moonlight_after_hours) == cfg.moonlight
    assert cfg.night_light < cfg.moonlight < 1.0


def test_dawn_and_dusk_ramps(config: Config) -> None:
    cfg = config.presence
    half_dusk = next_light(cfg, 1.0, 0.0, cfg.dusk_hours / 2)
    assert half_dusk == pytest.approx(0.5)
    assert next_light(cfg, 1.0, cfg.night_light, 10 * cfg.dusk_hours) == cfg.night_light
    assert next_light(cfg, 0.0, 1.0, cfg.dawn_hours) == 1.0
    assert next_light(cfg, 0.4, 0.4, 5.0) == 0.4


def test_plants_grow_fully_from_an_office_day(config: Config) -> None:
    cfg = config.presence
    assert plant_light(cfg, cfg.plant_full_light) == 1.0
    assert plant_light(cfg, 1.0) == 1.0
    assert plant_light(cfg, cfg.plant_full_light / 2) == pytest.approx(0.5)


def test_a_world_without_events_stays_lit(config: Config) -> None:
    world, _ = World.create(config, 3, EPOCH_UNIX_MS)
    world.step(3 * DAY_S)
    assert world.presence.light == 1.0
    assert world.fauna.daylight == 1.0


def test_leaving_brings_dusk_then_night_then_moonlight(config: Config) -> None:
    cfg = config.presence
    world = _world(config)
    assert not world.presence.present
    world.apply(PresenceChanged(True))
    world.step(cfg.dawn_hours * HOUR_S + 600)
    assert world.presence.light == 1.0
    assert world.fauna.daylight == 1.0
    world.apply(PresenceChanged(False))
    world.step(HOUR_S)
    assert cfg.night_light < world.fauna.daylight < 1.0  # dusk
    world.step(cfg.dusk_hours * HOUR_S)
    assert world.fauna.daylight == cfg.night_light  # night
    world.step(cfg.moonlight_after_hours * HOUR_S)
    assert world.fauna.daylight == cfg.moonlight  # a holiday: moonlight


def test_plants_remember_about_a_week_of_light(config: Config) -> None:
    cfg = config.presence
    week = cfg.plant_light_days
    assert recent_light(cfg, 1.0, 0.0, week) == pytest.approx(math.exp(-1))
    assert recent_light(cfg, 0.3, 0.3, 5.0) == pytest.approx(0.3)
    # Two days split equal one whole.
    two = recent_light(cfg, recent_light(cfg, 0.8, 0.1, 1.0), 0.1, 1.0)
    assert two == pytest.approx(recent_light(cfg, 0.8, 0.1, 2.0))


def test_an_office_week_keeps_plants_growing_and_a_holiday_slows_them(config: Config) -> None:
    cfg = config.presence
    recent, lowest = 1.0, 1.0
    for day in range(10 * 7):
        weekday_light = 0.4 if day % 7 < 5 else cfg.night_light
        recent = recent_light(cfg, recent, weekday_light, 1.0)
        lowest = min(lowest, plant_light(cfg, recent)) if day > 21 else lowest
    assert lowest > 0.9
    for _ in range(21):
        recent = recent_light(cfg, recent, cfg.moonlight, 1.0)
    assert 0.5 < plant_light(cfg, recent) < 0.8


def test_plants_get_the_recent_light(config: Config) -> None:
    world = _world(config)  # absent since 18:00 of the last day, now midnight
    before = world.flora.daylight
    world.step(10 * DAY_S)  # ten whole days away: night, then moonlight
    after = world.flora.daylight
    assert after < before
    assert after > plant_light(config.presence, config.presence.night_light)


@settings(max_examples=40, deadline=None)
@given(st.lists(st.tuples(st.booleans(), st.floats(0.0, 200.0)), max_size=12))
def test_light_stays_in_range(changes: list[tuple[bool, float]]) -> None:
    cfg = _PRESENCE
    light, present, absent = 1.0, True, 0.0
    for now_present, hours in changes:
        if now_present != present:
            present, absent = now_present, 0.0
        for _ in range(int(hours * 6)):
            light = next_light(cfg, light, target_light(cfg, present, absent), 1 / 6)
            absent = 0.0 if present else absent + 1 / 6
            assert 0.0 <= light <= 1.0


# --- god powers -----------------------------------------------------------------------


def test_needs_raise_a_powers_weight(config: Config) -> None:
    cfg = config.presence
    calm = power_weights(cfg, {})
    assert calm == [cfg.god_weight_meteor, cfg.god_weight_rain, cfg.god_weight_seed,
                    cfg.god_weight_ark]  # fmt: skip
    empty = power_weights(cfg, {Power.ARK: 1.0})
    assert empty[POWERS.index(Power.ARK)] == cfg.god_weight_ark * (1 + cfg.god_need_gain)
    rng = Generator(PCG64(5))
    drawn = [choose(rng, cfg, {Power.ARK: 1.0}) for _ in range(2000)]
    share = drawn.count(Power.ARK) / len(drawn)
    expected = empty[POWERS.index(Power.ARK)] / sum(empty)
    assert share == pytest.approx(expected, abs=0.04)
    assert set(drawn) == set(POWERS)  # random, never certain


def test_a_power_without_weight_never_fires(config: Config) -> None:
    cfg = replace(config.presence, god_weight_meteor=0.0)
    rng = Generator(PCG64(6))
    assert Power.METEOR not in {choose(rng, cfg, {}) for _ in range(500)}


def test_the_button_cools_down_for_a_week(config: Config) -> None:
    world = _world(config)  # rain was used the day before the save
    cooldown_ms = round(config.presence.god_cooldown_days * MS_PER_DAY)
    refused = _of(world.apply(GodPower()), GodPowerRefused)
    assert len(refused) == 1
    assert refused[0].ready_t_ms == world.presence.ready_t_ms > world.t_ms
    outputs = world.advance_to(world.presence.ready_t_ms + DAY_S * 1000)
    assert len(_of(outputs, GodPowerReady)) == 1
    used = _of(world.apply(GodPower()), GodPowerUsed)
    assert len(used) == 1
    assert world.presence.ready_t_ms == world.t_ms + cooldown_ms
    assert _of(world.apply(GodPower()), GodPowerRefused)


def _ready_world(config: Config) -> World:
    world = _world(config)
    world.advance_to(world.presence.ready_t_ms)
    return world


def test_meteor_digs_a_crater_and_kills_in_the_blast(config: Config) -> None:
    world = _ready_world(config)
    cfg = config.presence
    before = world.fauna.count
    outputs = world.apply(GodPower(Power.METEOR.value))
    (used,) = _of(outputs, GodPowerUsed)
    (crater,) = _of(outputs, CraterFormed)
    assert (crater.x, crater.y) == (used.x, used.y)
    assert crater.radius_cells == cfg.meteor_radius_cells
    yy, xx = np.indices(world.flora.biomass.shape)
    bowl = np.hypot(xx - used.x, yy - used.y) < cfg.meteor_radius_cells
    assert not world.flora.biomass[bowl].any()
    reach = cfg.meteor_radius_cells * cfg.meteor_blast_factor
    offset = world.fauna.positions - np.array([used.x, used.y], dtype=np.float32)
    assert (np.hypot(offset[:, 0], offset[:, 1]) > reach).all()
    assert world.fauna.count <= before


def test_meteor_kills_the_creatures_it_hits(config: Config) -> None:
    world = _ready_world(config)
    fauna = world.fauna
    x, y = (float(v) for v in fauna.positions[0])
    before = fauna.count
    fauna.strike(x, y, 3.0, world.t_ms)
    assert fauna.count < before
    assert fauna.tally.killed > 0


def test_rain_puts_out_fires_and_wets_the_land(config: Config) -> None:
    world = _ready_world(config)
    fire = world.wildfire
    ys, xs = np.nonzero(world.flora.biomass >= config.flora.fire_min_fuel)
    fire.ignite(int(ys[0]), int(xs[0]), world.t_ms)
    assert fire.burning.any()
    fertility = world.terrain.fertility.copy()
    outputs = world.apply(GodPower(Power.RAIN.value))
    assert _of(outputs, FireEnded)
    assert not fire.burning.any()
    land = world.terrain.land
    assert (world.terrain.fertility[land] >= fertility[land]).all()
    assert world.terrain.fertility[land].mean() > fertility[land].mean()
    assert fire.dryness(world.instant) == 0.0
    assert world.presence.raining  # what the scene draws (R4)
    world.step(config.presence.rain_days * DAY_S + HOUR_S)
    assert not world.snapshot().subsystems["presence"]["wet"]
    assert not world.presence.raining


def test_rain_makes_plants_grow_faster(config: Config) -> None:
    dry = _ready_world(config)
    wet = _ready_world(config)
    wet.apply(GodPower(Power.RAIN.value))
    dry.step(DAY_S)
    wet.step(DAY_S)
    assert wet.flora.biomass.sum() > dry.flora.biomass.sum()


def test_seed_sows_bare_land(config: Config) -> None:
    world = _ready_world(config)
    land = world.terrain.land
    bare = land & (world.flora.biomass <= 0)
    assert bare.any()
    world.apply(GodPower(Power.SEED.value))
    assert np.count_nonzero(land & (world.flora.biomass <= 0)) < np.count_nonzero(bare)


def _without_hunters(config: Config, herd: int) -> Config:
    """No hunters land by themselves; the ark brings them once the herd reaches ``herd``."""
    fauna = replace(config.fauna, hunter_wave_count=0, hunter_wave_herd=herd)
    return replace(config, fauna=fauna)


def test_the_ark_brings_plant_eaters(config: Config) -> None:
    world = _ready_world(_without_hunters(config, config.fauna.population_cap + 1))
    assert not world.fauna.lacks_hunters()
    before = world.fauna.count
    outputs = world.apply(GodPower(Power.ARK.value))
    (arrived,) = _of(outputs, CreaturesArrived)
    assert arrived.founders
    assert world.fauna.count == before + arrived.count > before
    new = world.fauna.genes[-arrived.count :, Gene.DIET]
    assert (new < config.fauna.predator_min_diet).all()


def test_the_ark_brings_hunters_to_a_herd_without_them(config: Config) -> None:
    world = _ready_world(_without_hunters(config, 50))
    assert world.fauna.diet_counts()[2] == 0
    assert world.fauna.lacks_hunters()
    assert world.presence.needs(world.instant)[Power.ARK] == 1.0
    outputs = world.apply(GodPower(Power.ARK.value))
    (arrived,) = _of(outputs, CreaturesArrived)
    assert arrived.founders
    assert arrived.count == config.presence.ark_count
    new = world.fauna.genes[-arrived.count :, Gene.DIET]
    assert (new >= config.fauna.predator_min_diet).all()
    assert not world.fauna.lacks_hunters()


def test_the_island_asks_for_the_ark_when_empty(config: Config) -> None:
    world = _ready_world(config)
    cfg = config.presence
    full = world.presence.needs(world.instant)
    assert full[Power.ARK] == max(0.0, 1 - world.fauna.count / cfg.ark_need_creatures)
    x, y = (float(v) for v in world.fauna.positions.mean(axis=0))
    world.fauna.strike(x, y, 1e6, world.t_ms)
    assert world.fauna.count == 0
    assert world.presence.needs(world.instant)[Power.ARK] == 1.0


def test_the_ark_waits_for_an_island_green_enough_for_founders(config: Config) -> None:
    bare, _ = World.create(config, 3, EPOCH_UNIX_MS)  # bare rock, nobody yet
    assert bare.fauna.count == 0
    assert not bare.fauna.green_enough()
    assert bare.presence.closed() == frozenset({Power.ARK})
    drawn = {
        choose(Generator(PCG64(k)), config.presence, {Power.ARK: 1.0}, bare.presence.closed())
        for k in range(200)
    }
    assert drawn
    assert Power.ARK not in drawn  # the island never draws it
    closed = power_weights(config.presence, {}, frozenset({Power.ARK}))
    assert closed[POWERS.index(Power.ARK)] == 0
    # An inhabited island may draw it whatever its plants; an emptied one once green.
    world = _ready_world(config)
    assert world.presence.closed() == frozenset()
    x, y = (float(v) for v in world.fauna.positions.mean(axis=0))
    world.fauna.strike(x, y, 1e6, world.t_ms)
    expected: frozenset[Power] = (
        frozenset() if world.fauna.green_enough() else frozenset({Power.ARK})
    )
    assert world.presence.closed() == expected


def test_a_power_is_drawn_from_the_presence_stream(config: Config) -> None:
    a, b = _ready_world(config), _ready_world(config)
    assert a.apply(GodPower()) == b.apply(GodPower())
    assert a.snapshot().rng["terrain"] == b.snapshot().rng["terrain"]


def test_restore_mid_rain_continues_identically(config: Config) -> None:
    world = _ready_world(config)
    world.apply(GodPower(Power.RAIN.value))
    world.step(HOUR_S * 30 + 123)
    copy = World.restore(config, io.loads(io.dumps(world.snapshot())))
    for w in (world, copy):
        w.apply(PresenceChanged(True))
        w.step(HOUR_S * 5)
        w.advance_to(w.presence.ready_t_ms)
        w.apply(GodPower())
        w.step(DAY_S)
    assert world.state_hash() == copy.state_hash()


def test_presence_is_registered_first(config: Config) -> None:
    assert default_subsystems(config)[0].name == "presence"


def test_presence_config_is_checked(config: Config) -> None:
    with pytest.raises(ConfigError, match="moonlight"):
        replace(config.presence, moonlight=1.5)
    with pytest.raises(ConfigError, match="weight"):
        replace(config.presence, god_weight_meteor=0.0, god_weight_rain=0.0,
                god_weight_seed=0.0, god_weight_ark=0.0)  # fmt: skip


def test_witnessed_events_are_seen_as_a_steps_own(config: Config) -> None:
    """``World.witness`` (R4): a cone staged outside a step (as ``tools/stream.py`` does) bares
    the land round it, kills the creatures on it and is written in the chronicle."""
    world = _ready_world(config)
    x, y = (float(v) for v in world.fauna.positions[0])
    radius = 3.0
    witnessed = world.witness([VolcanoErupted(world.t_ms, x, y, radius, 0.1)])
    assert _of(witnessed, ChronicleEntry)
    yy, xx = np.indices(world.flora.biomass.shape)
    bare = np.hypot(xx - x, yy - y) <= config.flora.barren_reach * radius
    assert not world.flora.biomass[bare].any()
    offset = world.fauna.positions - np.array([x, y], dtype=np.float32)
    reach = config.fauna.blast_kill_reach * radius
    assert (np.hypot(offset[:, 0], offset[:, 1]) > reach).all()
    assert world.witness([]) == []


def test_solar_elevation_pisa() -> None:
    from lineage_sim.presence import PISA_LATITUDE, PISA_LONGITUDE, solar_elevation

    # Summer solstice noon UTC (June 21, 2026, 12:00 UTC)
    summer_noon = int(dt.datetime(2026, 6, 21, 12, 0, tzinfo=dt.UTC).timestamp() * 1000)
    el_summer = solar_elevation(summer_noon, PISA_LATITUDE, PISA_LONGITUDE)
    assert el_summer > 65.0  # high summer sun in Pisa

    # Winter solstice midnight UTC (Dec 21, 2026, 00:00 UTC)
    winter_mid = int(dt.datetime(2026, 12, 21, 0, 0, tzinfo=dt.UTC).timestamp() * 1000)
    el_winter = solar_elevation(winter_mid, PISA_LATITUDE, PISA_LONGITUDE)
    assert el_winter < -60.0  # deep night


def test_solar_target_light(config: Config) -> None:
    from lineage_sim.presence import solar_target_light

    noon = int(dt.datetime(2026, 6, 21, 12, 0, tzinfo=dt.UTC).timestamp() * 1000)
    light_noon = solar_target_light(config.presence, noon)
    assert light_noon == 1.0

    midnight = int(dt.datetime(2026, 6, 21, 0, 0, tzinfo=dt.UTC).timestamp() * 1000)
    light_mid = solar_target_light(config.presence, midnight)
    assert light_mid == config.presence.night_light


def test_presence_solar_cycle_world(config: Config) -> None:
    from lineage_sim.world import World

    solar_cfg = replace(config.presence, solar_cycle=True)
    full_cfg = replace(config, presence=solar_cfg)
    # Start at midnight
    midnight_ms = int(dt.datetime(2026, 6, 21, 0, 0, tzinfo=dt.UTC).timestamp() * 1000)
    world, _ = World.create(full_cfg, seed=1, epoch_unix_ms=midnight_ms)
    assert world.presence.light <= config.presence.night_light + 0.05
    assert not world.presence.present

    # Step to solar noon (12 hours later)
    world.step(12 * 3600)
    assert world.presence.light >= 0.95
    assert world.presence.present


def test_presence_alternating_uniform_cycle(config: Config) -> None:
    from lineage_sim.world import World

    # Default worlds must not emit phase_end_ms into state snapshots.
    plain, _ = World.create(config, seed=7, epoch_unix_ms=0)
    assert "phase_end_ms" not in plain.presence.get_state()

    alt_cfg = replace(
        config.presence,
        alternating_cycle=True,
        cycle_min_hours=75.0,
        cycle_max_hours=105.0,
        dawn_hours=4.5,
        dusk_hours=6.0,
        night_light=0.07,
    )
    full_cfg = replace(config, presence=alt_cfg)
    world, _ = World.create(full_cfg, seed=42, epoch_unix_ms=0)
    assert world.presence.present
    first_span_h = world.presence.phase_end_ms / 3_600_000.0
    assert 75.0 <= first_span_h <= 105.0

    # Step across the first phase boundary into night and verify dusk -> night_light.
    world.advance_to(world.presence.phase_end_ms + 7 * 3_600_000)
    assert not world.presence.present
    assert world.presence.light == pytest.approx(0.07, abs=0.01)

    # Save/restore determinism across subsequent alternating phases.
    copy = World.restore(full_cfg, io.loads(io.dumps(world.snapshot())))
    world.step(120 * 3600)
    copy.step(120 * 3600)
    assert world.state_hash() == copy.state_hash()
