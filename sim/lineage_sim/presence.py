"""Presence and daylight: the owner's presence is the island's sun. And the god powers.

`PresenceChanged` events (hold logic is upstream) say whether the owner is at the desk.
Light follows: it rises toward full day when they are present (dawn) and falls toward a
night level when they leave (dusk). After a long absence it settles on a moonlight floor
instead, so a holiday is dim, not black. A world that never hears of the owner stays
fully lit. Holidays need no calendar: they are long absences (ADR 0016).

The subsystem is registered first, so it ticks before the others when ticks coincide.
Every tick it hands the creatures the light of the moment (sight, photosynthesis,
torpor). It integrates light over each sim-day and keeps a running mean of the days over
about a week; at midnight it hands the plants their growth factor from that mean, so a
weekend's Long Night slows them little and a long holiday a lot.

God powers: a button (`GodPower`) fires one, at most once per cooldown. The island draws
which, weighted by config and by what it needs (`needs`): a meteor, rain, seed or an ark.
Their draws come from this subsystem's stream. The light and rain hooks of the other
subsystems are not saved; this subsystem pushes them again after a restore.
"""

from __future__ import annotations

import datetime as dt
import math
from enum import Enum

import numpy as np
from numpy.random import Generator

from lineage_sim.clock import MS_PER_DAY, Instant
from lineage_sim.config import PresenceConfig
from lineage_sim.events import (
    GodPower,
    GodPowerReady,
    GodPowerRefused,
    GodPowerUsed,
    InputEvent,
    OutputEvent,
    PresenceChanged,
)
from lineage_sim.fauna.population import Fauna
from lineage_sim.flora import Flora, Wildfire
from lineage_sim.rng import PRESENCE
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context
from lineage_sim.terrain import Terrain

_SECONDS_PER_HOUR = 3600.0
_MS_PER_HOUR = 3_600_000


class Power(Enum):
    METEOR = "meteor"
    RAIN = "rain"
    SEED = "seed"
    ARK = "ark"


POWERS = tuple(Power)


def target_light(cfg: PresenceConfig, present: bool, absent_h: float) -> float:
    """The light the island moves toward: day while the owner is present, night once
    they left, moonlight once they have been away long enough."""
    if present:
        return 1.0
    return cfg.moonlight if absent_h >= cfg.moonlight_after_hours else cfg.night_light


# Pisa, Italy coordinates (Europe/Rome approximate reference)
PISA_LATITUDE = 43.7228
PISA_LONGITUDE = 10.4017


def solar_elevation(
    unix_ms: int, lat: float = PISA_LATITUDE, lon: float = PISA_LONGITUDE
) -> float:
    """Astronomical solar elevation in degrees above horizon for given UTC unix_ms."""
    utc_dt = dt.datetime(1970, 1, 1, tzinfo=dt.UTC) + dt.timedelta(milliseconds=unix_ms)
    day_of_year = utc_dt.timetuple().tm_yday
    hour_utc = utc_dt.hour + utc_dt.minute / 60.0 + utc_dt.second / 3600.0
    gamma = 2.0 * math.pi / 365.25 * (day_of_year - 1 + (hour_utc - 12.0) / 24.0)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    time_offset = eqtime + 4.0 * lon
    tst = (hour_utc * 60.0 + time_offset) % 1440.0
    ha = math.radians((tst / 4.0) - 180.0)
    lat_rad = math.radians(lat)
    cos_zenith = math.sin(lat_rad) * math.sin(decl) + math.cos(lat_rad) * math.cos(decl) * math.cos(
        ha
    )
    cos_zenith = max(-1.0, min(1.0, cos_zenith))
    return 90.0 - math.degrees(math.acos(cos_zenith))


def solar_target_light(
    cfg: PresenceConfig,
    unix_ms: int,
    lat: float = PISA_LATITUDE,
    lon: float = PISA_LONGITUDE,
    twilight_low_deg: float = -6.0,
    twilight_high_deg: float = 6.0,
) -> float:
    """Target light mapped from real solar elevation: night_light at night, 1.0 in day."""
    el = solar_elevation(unix_ms, lat=lat, lon=lon)
    span = twilight_high_deg - twilight_low_deg
    frac = max(0.0, min(1.0, (el - twilight_low_deg) / span))
    smooth = frac * frac * (3.0 - 2.0 * frac)
    return cfg.night_light + (1.0 - cfg.night_light) * smooth


def next_light(cfg: PresenceConfig, light: float, target: float, hours: float) -> float:
    """Light after ``hours`` of moving toward ``target``: up over ``dawn_hours`` from
    darkness to full day, down over ``dusk_hours``."""
    if target > light:
        return min(target, light + hours / cfg.dawn_hours)
    return max(target, light - hours / cfg.dusk_hours)


def plant_light(cfg: PresenceConfig, mean_light: float) -> float:
    """Plants' growth factor from the recent mean light: full from ``plant_full_light``."""
    return min(mean_light / cfg.plant_full_light, 1.0)


def recent_light(cfg: PresenceConfig, recent: float, day_light: float, days: float) -> float:
    """The running mean of light after ``days`` more at ``day_light`` (it forgets over
    ``plant_light_days``)."""
    return recent + (day_light - recent) * (1.0 - math.exp(-days / cfg.plant_light_days))


def weights(
    cfg: PresenceConfig, needs: dict[Power, float], closed: frozenset[Power] = frozenset()
) -> list[float]:
    """Each power's weight in the draw, in ``POWERS`` order: its base weight raised by
    what the island needs; 0 for the ``closed`` ones (not available now)."""
    base = {
        Power.METEOR: cfg.god_weight_meteor,
        Power.RAIN: cfg.god_weight_rain,
        Power.SEED: cfg.god_weight_seed,
        Power.ARK: cfg.god_weight_ark,
    }
    return [
        0.0 if p in closed else base[p] * (1.0 + cfg.god_need_gain * needs.get(p, 0.0))
        for p in POWERS
    ]


def choose(
    rng: Generator,
    cfg: PresenceConfig,
    needs: dict[Power, float],
    closed: frozenset[Power] = frozenset(),
) -> Power:
    """Draw a power (one uniform draw, whatever the weights)."""
    w = weights(cfg, needs, closed)
    pick = rng.random() * sum(w)
    for power, weight in zip(POWERS, w, strict=True):
        if pick < weight:
            return power
        pick -= weight
    return next(p for p, weight in zip(POWERS, w, strict=True) if weight > 0)


class Presence:
    """The presence subsystem. ``light`` is the light of the moment, in [0, 1]."""

    def __init__(
        self,
        cfg: PresenceConfig,
        terrain: Terrain,
        flora: Flora,
        fire: Wildfire,
        fauna: Fauna,
    ) -> None:
        self._cfg = cfg
        self._terrain = terrain
        self._flora = flora
        self._fire = fire
        self._fauna = fauna
        self._present = True  # a new world starts lit, and stays lit without events
        self._light = 1.0
        self._absent_h = 0.0  # hours since the owner left (0 while present)
        self._light_hours = 0.0  # light × hours since the last midnight
        self._hours = 0.0  # hours since the last midnight
        self._recent_light = 1.0  # running mean of daily light, over about a week
        self._ready_ms = 0  # sim time from which the button works again
        self._ready_told = True  # GodPowerReady already sent for this cooldown
        self._rain_until_ms = 0  # the land is wet until then
        self._wet = False  # what the plants and fires were last told
        self._phase_end_ms = 0  # sim time when the current day/night phase ends

    @property
    def name(self) -> str:
        return PRESENCE

    @property
    def present(self) -> bool:
        return self._present

    @property
    def light(self) -> float:
        return self._light

    @property
    def raining(self) -> bool:
        """Whether the rain god power's rain still falls (the land is wet; R4 draws it)."""
        return self._wet

    @property
    def absent_hours(self) -> float:
        """Sim-hours since the owner left (0 while present)."""
        return 0.0 if self._present else self._absent_h

    @property
    def config(self) -> PresenceConfig:
        return self._cfg

    @property
    def ready_t_ms(self) -> int:
        """Sim time from which the button works (the LED is lit before it)."""
        return self._ready_ms

    @property
    def phase_end_ms(self) -> int:
        """Sim time when the current alternating day/night phase ends (0 when inactive)."""
        return self._phase_end_ms

    def closed(self) -> frozenset[Power]:
        """Powers the island cannot draw now: the ark, on an empty island whose plants
        could not yet feed founders (the owner, 2026-10-22: early arks starved)."""
        if self._fauna.count == 0 and not self._fauna.green_enough():
            return frozenset({Power.ARK})
        return frozenset()

    def needs(self, instant: Instant) -> dict[Power, float]:
        """What the island needs, each in [0, 1]: rain against fire and dry weather, seed
        on bare land, the ark when creatures are few or a large herd has no hunters."""
        cfg, land = self._cfg, self._terrain.land
        land_cells = int(np.count_nonzero(land))
        bare = int(np.count_nonzero(land & (self._flora.biomass <= 0)))
        fire = 1.0 if self._fire.burning.any() else self._fire.dryness(instant)
        few = 1.0 - min(self._fauna.count / cfg.ark_need_creatures, 1.0)
        return {
            Power.RAIN: fire,
            Power.SEED: bare / land_cells if land_cells else 0.0,
            Power.ARK: 1.0 if self._fauna.lacks_hunters() else few,
        }

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        if self._cfg.alternating_cycle and self._phase_end_ms <= 0:
            self._phase_end_ms = ctx.t_ms + self._draw_phase_ms(ctx.rng)
            self._push()
            return []
        if self._cfg.solar_cycle and self._hours == 0.0:
            target = solar_target_light(
                self._cfg,
                ctx.instant.unix_ms,
                lat=self._cfg.latitude,
                lon=self._cfg.longitude,
            )
            self._light = target
            self._present = target > (self._cfg.night_light + 0.1)
            self._push()
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        hours = ctx.dt_s / _SECONDS_PER_HOUR
        if self._cfg.alternating_cycle:
            if self._phase_end_ms <= 0:
                self._phase_end_ms = ctx.t_ms + self._draw_phase_ms(ctx.rng)
            while ctx.t_ms >= self._phase_end_ms:
                self._present = not self._present
                self._absent_h = 0.0
                self._phase_end_ms += self._draw_phase_ms(ctx.rng)
            target = 1.0 if self._present else self._cfg.night_light
        elif self._cfg.solar_cycle:
            target = solar_target_light(
                self._cfg,
                ctx.instant.unix_ms,
                lat=self._cfg.latitude,
                lon=self._cfg.longitude,
            )
            self._present = target > (self._cfg.night_light + 0.1)
        else:
            target = target_light(self._cfg, self._present, self._absent_h)
        self._light = next_light(self._cfg, self._light, target, hours)
        self._light_hours += self._light * hours
        self._hours += hours
        if not self._present:
            self._absent_h += hours
        if ctx.t_ms % MS_PER_DAY == 0 and self._hours > 0:
            # Registered first, this runs before the plants' midnight tick.
            day = self._light_hours / self._hours
            self._recent_light = recent_light(self._cfg, self._recent_light, day, self._hours / 24)
            self._light_hours = self._hours = 0.0
        self._wet = ctx.t_ms < self._rain_until_ms
        self._push()
        if not self._ready_told and ctx.t_ms >= self._ready_ms:
            self._ready_told = True
            return [GodPowerReady(ctx.t_ms)]
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        if (
            isinstance(event, PresenceChanged)
            and event.present != self._present
            and not self._cfg.solar_cycle
            and not self._cfg.alternating_cycle
        ):
            self._present = event.present
            self._absent_h = 0.0
        if isinstance(event, GodPower):
            return self._god_power(event, ctx)
        return []

    def get_state(self) -> Tree:
        state: Tree = {
            "present": self._present,
            "light": self._light,
            "absent_h": self._absent_h,
            "light_hours": self._light_hours,
            "hours": self._hours,
            "recent_light": self._recent_light,
            "ready_ms": self._ready_ms,
            "ready_told": self._ready_told,
            "rain_until_ms": self._rain_until_ms,
            "wet": self._wet,
        }
        if self._cfg.alternating_cycle or self._phase_end_ms > 0:
            state["phase_end_ms"] = self._phase_end_ms
        return state

    def set_state(self, tree: Tree) -> None:
        self._present = bool(tree["present"])
        self._light = float(tree["light"])
        self._absent_h = float(tree["absent_h"])
        self._light_hours = float(tree["light_hours"])
        self._hours = float(tree["hours"])
        self._recent_light = float(tree["recent_light"])
        self._ready_ms = int(tree["ready_ms"])
        self._ready_told = bool(tree["ready_told"])
        self._rain_until_ms = int(tree["rain_until_ms"])
        self._wet = bool(tree["wet"])
        self._phase_end_ms = int(tree.get("phase_end_ms", 0))
        self._push()

    # -- internals --

    def _draw_phase_ms(self, rng: Generator) -> int:
        """Draw the next day or night phase length uniformly in
        ``[cycle_min_hours, cycle_max_hours]``.
        """
        hours = float(rng.uniform(self._cfg.cycle_min_hours, self._cfg.cycle_max_hours))
        return max(1, round(hours * _SECONDS_PER_HOUR * 1000.0))

    def _push(self) -> None:
        """Hand the other subsystems the light and the weather (their hooks are not
        saved, so a restore pushes them again)."""
        wet = self._wet
        self._fauna.set_daylight(self._light)
        self._flora.set_daylight(plant_light(self._cfg, self._recent_light))
        self._flora.set_rain(1.0 + self._cfg.rain_growth_boost if wet else 1.0)
        self._fire.set_wet(wet)

    def _god_power(self, event: GodPower, ctx: Context) -> list[OutputEvent]:
        cfg, rng, t_ms = self._cfg, ctx.rng, ctx.t_ms
        if t_ms < self._ready_ms:
            return [GodPowerRefused(t_ms, self._ready_ms)]
        power = (
            Power(event.power)
            if event.power
            else choose(rng, cfg, self.needs(ctx.instant), self.closed())
        )
        self._ready_ms = t_ms + round(cfg.god_cooldown_days * MS_PER_DAY)
        self._ready_told = False
        x, y = self._site(rng)
        outputs: list[OutputEvent] = [GodPowerUsed(t_ms, power.value, x, y)]
        if power is Power.METEOR:
            radius = cfg.meteor_radius_cells
            outputs += self._terrain.strike(x, y, radius, cfg.meteor_depth, t_ms)
            geo_y, geo_x = np.indices(self._terrain.height.shape)
            bowl = np.nonzero(np.hypot(geo_x - x, geo_y - y) < radius)
            self._flora.clear(bowl[0], bowl[1])
            outputs += self._fauna.strike(x, y, radius * cfg.meteor_blast_factor, t_ms)
        elif power is Power.RAIN:
            outputs += self._fire.extinguish(t_ms)
            room = (1.0 - self._terrain.fertility) * self._terrain.land
            self._terrain.adjust_fertility((cfg.rain_fertility * room).astype(np.float32))
            self._rain_until_ms = t_ms + round(cfg.rain_days * MS_PER_DAY)
            self._wet = self._rain_until_ms > t_ms
            self._push()
        elif power is Power.SEED:
            self._flora.sow(rng, cfg.seed_count, cfg.seed_rare_chance, ctx.instant)
        else:
            hunters = self._fauna.lacks_hunters()
            outputs += self._fauna.arrive(rng, t_ms, cfg.ark_count, hunters=hunters)
        return outputs

    def _site(self, rng: Generator) -> tuple[float, float]:
        """A random land cell (any cell on a drowned world), where the power is aimed."""
        land = self._terrain.land
        ys, xs = np.nonzero(land) if land.any() else np.nonzero(np.ones_like(land))
        k = int(rng.integers(0, ys.size))
        return float(xs[k]), float(ys[k])
