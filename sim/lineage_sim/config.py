"""Typed configuration, parsed from TOML text.

The caller reads the file (the sim does no I/O) and passes its text to `parse_config`.
Unknown sections or keys are errors so a typo cannot silently fall back to a default.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import MISSING, dataclass, fields
from enum import Enum
from types import MappingProxyType
from typing import Any, TypeVar, cast

CONFIG_VERSION = 1

_T = TypeVar("_T")


class ConfigError(ValueError):
    """The configuration text is malformed or has invalid values."""


class Hemisphere(Enum):
    NORTH = "north"
    SOUTH = "south"


@dataclass(frozen=True, order=True)
class MonthDay:
    month: int
    day: int

    @classmethod
    def parse(cls, text: str) -> MonthDay:
        parts = text.split("-")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            raise ConfigError(f"expected 'MM-DD', got {text!r}")
        month, day = int(parts[0]), int(parts[1])
        # Feb 29 is rejected: a season must start every year.
        days_in_month = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        if not 1 <= month <= 12 or not 1 <= day <= days_in_month[month - 1]:
            raise ConfigError(f"invalid month-day {text!r}")
        return cls(month, day)


@dataclass(frozen=True)
class CalendarConfig:
    hemisphere: Hemisphere
    spring_start: MonthDay
    summer_start: MonthDay
    autumn_start: MonthDay
    winter_start: MonthDay


@dataclass(frozen=True)
class TerrainConfig:
    """``[terrain]``; units and intent of every key are documented in default.toml."""

    grid_width: int
    grid_height: int
    edge_margin_cells: float
    edge_depth: float
    sea_base: float
    initial_land_fraction: float
    noise_wavelength_cells: float
    noise_large_octaves: int
    noise_detail_octaves: int
    noise_detail_share: float
    drift_period_years: float
    noise_persistence: float
    falloff_strength: float
    falloff_exponent: float
    relief_scale: float
    fertility_min: float
    fertility_max: float
    fertility_wavelength_cells: float
    fertility_elevation_decay: float
    sea_cycle_period_years: float
    sea_cycle_amplitude: float
    sea_slow_period_years: float
    sea_slow_amplitude: float
    hotspot_count: int
    hotspot_radius_min_cells: float
    hotspot_radius_max_cells: float
    hotspot_rate_max_per_year: float
    hotspot_speed_max_cells_per_year: float
    hotspot_lifetime_min_years: float
    hotspot_lifetime_max_years: float
    hotspot_ruggedness: float
    relax_time_years: float
    relax_blur_cells: int
    creep_rate_per_year: float
    thermal_rate_per_year: float
    talus_slope: float
    vegetation_protection: float
    erosion_fertility_exchange: float
    marine_sediment_rate_per_year: float
    leaching_rate_per_year: float
    volcano_rate_per_year: float
    volcano_radius_min_cells: float
    volcano_radius_max_cells: float
    volcano_height_min: float
    volcano_height_max: float
    volcano_lava_fertility: float
    volcano_ash_fertility: float
    earthquake_rate_per_year: float
    earthquake_radius_min_cells: float
    earthquake_radius_max_cells: float
    earthquake_throw_min: float
    earthquake_throw_max: float
    crater_rate_per_year: float
    crater_radius_min_cells: float
    crater_radius_max_cells: float
    crater_depth_min: float
    crater_depth_max: float
    crater_rim_fraction: float
    crater_fertility_factor: float
    landmass_min_cells: int

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[terrain] {message}")

        unit = (
            "sea_base", "initial_land_fraction", "noise_persistence", "noise_detail_share",
            "fertility_min", "fertility_max", "hotspot_ruggedness", "vegetation_protection",
            "volcano_lava_fertility", "volcano_ash_fertility", "crater_fertility_factor",
        )  # fmt: skip
        for key in unit:
            check(0.0 <= getattr(self, key) <= 1.0, f"{key} must be within [0, 1]")
        for key, value in vars(self).items():
            check(value >= 0, f"{key} must not be negative")
        positive = (
            "grid_width", "grid_height", "edge_margin_cells", "noise_wavelength_cells",
            "noise_large_octaves", "relief_scale", "drift_period_years",
            "fertility_wavelength_cells",
            "sea_cycle_period_years", "sea_slow_period_years", "hotspot_radius_min_cells",
            "hotspot_lifetime_min_years", "relax_time_years", "relax_blur_cells",
            "talus_slope", "volcano_radius_min_cells", "earthquake_radius_min_cells",
            "crater_radius_min_cells", "landmass_min_cells",
        )  # fmt: skip
        for key in positive:
            check(getattr(self, key) > 0, f"{key} must be positive")
        check(self.grid_width >= 16 and self.grid_height >= 16, "grid must be at least 16×16")
        check(self.fertility_min <= self.fertility_max, "fertility_min exceeds fertility_max")
        ranges = (
            ("hotspot_radius_min_cells", "hotspot_radius_max_cells"),
            ("hotspot_lifetime_min_years", "hotspot_lifetime_max_years"),
            ("volcano_radius_min_cells", "volcano_radius_max_cells"),
            ("volcano_height_min", "volcano_height_max"),
            ("earthquake_radius_min_cells", "earthquake_radius_max_cells"),
            ("earthquake_throw_min", "earthquake_throw_max"),
            ("crater_radius_min_cells", "crater_radius_max_cells"),
            ("crater_depth_min", "crater_depth_max"),
        )
        for low, high in ranges:
            check(getattr(self, low) <= getattr(self, high), f"{low} exceeds {high}")


@dataclass(frozen=True)
class FloraConfig:
    """``[flora]``; units and intent of every key are documented in default.toml."""

    cover_min_biomass: float
    closed_canopy_biomass: float
    form_grass_max_height: float
    form_shrub_max_height: float
    form_lichen_max_height: float
    form_lichen_min_frugality: float
    form_conifer_min_evergreen: float
    temperature_mean: float
    temperature_season_amplitude: float
    temperature_lapse_per_height: float
    optimum_warm: float
    optimum_cold: float
    temperature_tolerance: float
    snow_below_temperature: float
    snow_depth_span: float
    growth_rate_max_per_year: float
    growth_rate_min_share: float
    stature_slowdown: float
    cost_frugality: float
    cost_shade: float
    cost_defence: float
    cost_evergreen: float
    mortality_base_per_year: float
    mortality_growth_per_year: float
    mortality_stature_relief: float
    shore_span: float
    treeline_height: float
    treeline_span: float
    exposure_per_year: float
    winter_dieback_per_year: float
    winter_reserve_biomass: float
    need_base: float
    need_height: float
    need_frugality: float
    need_floor: float
    need_sharpness: float
    soil_build_rate_per_year: float
    soil_cap_base: float
    soil_cap_height: float
    seed_rate_per_year: float
    seed_min_biomass: float
    near_weight_wind: float
    far_offsets_per_tick: int
    wind_range_cells: float
    fruit_establishment_bonus: float
    seedling_biomass: float
    takeover_keep: float
    establishment_sharpness: float
    canopy_base: float
    competition_base: float
    competition_softness: float
    competition_margin: float
    mutation_sigma: float
    seed_rain_per_year: float
    rare_gain_probability: float
    rare_loss_probability: float
    fire_pine_survival: float
    fire_pine_growth_cost: float
    nitrogen_fixer_need_relief: float
    nitrogen_fixer_soil_boost: float
    nitrogen_fixer_growth_cost: float
    mangrove_max_depth: float
    mangrove_growth_cost: float
    poisonous_toxicity: float
    poisonous_refusal: float
    poisonous_growth_cost: float
    fruiting_meal_bonus: float
    fruiting_growth_cost: float
    fruit_by_wind: bool
    emergent_height_bonus: float
    emergent_need_factor: float
    emergent_growth_cost: float
    emergent_wind_factor: float
    defence_strength: float
    grazing_reserve_biomass: float
    algae_max_depth: float
    algae_capacity: float
    algae_growth_per_year: float
    algae_seed: float
    algae_winter_share: float
    algae_meal_share: float
    fire_strikes_per_storm_hour: float
    fire_dry_temperature: float
    fire_dry_span: float
    fire_spread_per_hour: float
    fire_wet_spread: float
    fire_burn_hours: float
    fire_min_fuel: float
    flammability_lichen: float
    flammability_grass: float
    flammability_shrub: float
    flammability_broadleaf: float
    flammability_conifer: float
    fire_loss_low: float
    fire_loss_tree: float
    fire_fertility_loss: float
    scorch_days: float
    barren_reach: float
    barren_days: float
    species_min_cells: int

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[flora] {message}")

        for key, value in vars(self).items():
            check(value >= 0, f"{key} must not be negative")
        unit = (
            "cover_min_biomass",
            "closed_canopy_biomass",
            "form_grass_max_height",
            "form_shrub_max_height",
            "form_lichen_max_height",
            "form_lichen_min_frugality",
            "form_conifer_min_evergreen",
            "growth_rate_min_share",
            "cost_frugality",
            "cost_shade",
            "cost_defence",
            "cost_evergreen",
            "mortality_stature_relief",
            "need_floor",
            "soil_cap_base",
            "seed_min_biomass",
            "near_weight_wind",
            "seedling_biomass",
            "winter_reserve_biomass",
            "takeover_keep",
            "canopy_base",
            "rare_gain_probability",
            "rare_loss_probability",
            "fire_pine_survival",
            "fire_pine_growth_cost",
            "nitrogen_fixer_need_relief",
            "nitrogen_fixer_growth_cost",
            "mangrove_growth_cost",
            "poisonous_refusal",
            "poisonous_growth_cost",
            "fruiting_growth_cost",
            "emergent_growth_cost",
            "defence_strength",
            "grazing_reserve_biomass",
            "algae_capacity",
            "algae_winter_share",
            "fire_wet_spread",
            "fire_min_fuel",
            "flammability_lichen",
            "flammability_grass",
            "flammability_shrub",
            "flammability_broadleaf",
            "flammability_conifer",
            "fire_loss_low",
            "fire_loss_tree",
            "fire_fertility_loss",
        )
        for key in unit:
            check(getattr(self, key) <= 1.0, f"{key} must be within [0, 1]")
        positive = (
            "temperature_tolerance",
            "snow_depth_span",
            "growth_rate_max_per_year",
            "need_sharpness",
            "establishment_sharpness",
            "competition_softness",
            "treeline_span",
            "shore_span",
            "fire_dry_span",
            "fire_burn_hours",
            "wind_range_cells",
            "scorch_days",
            "barren_reach",
            "barren_days",
            "species_min_cells",
        )
        for key in positive:
            check(getattr(self, key) > 0, f"{key} must be positive")
        check(
            self.form_lichen_max_height <= self.form_grass_max_height <= self.form_shrub_max_height,
            "form height thresholds must be in order lichen <= grass <= shrub",
        )
        check(self.optimum_cold < self.optimum_warm, "optimum_cold must be below optimum_warm")
        check(self.soil_cap_base + self.soil_cap_height <= 1.0, "soil cap exceeds 1")


@dataclass(frozen=True)
class FaunaConfig:
    """``[fauna]``; units and intent of every key are documented in default.toml."""

    population_cap: int
    predator_cap: int
    founder_min_plant_cover: float
    arrival_delay_days: float
    founder_count: int
    founder_diet_max: float
    founder_size_max: float
    founder_spread: float
    founder_radius_cells: float
    immigrant_groups_per_year: float
    immigrant_group_size: int
    immigrant_hunter_share: float
    hunter_wave_herd: int
    hunter_wave_count: int
    hunter_landing_cells: float
    hunter_size_margin: float
    prey_diet_gap: float
    mass_min: float
    mass_max: float
    limb_pairs_max: int
    speed_base: float
    speed_floor: float
    speed_mass_exponent: float
    limbless_speed: float
    extra_limb_drag: float
    armour_slowdown: float
    armour_limb_relief: float
    aquatic_land_slowdown: float
    swim_speed: float
    swim_floor: float
    swim_limb_drag: float
    sense_base: float
    sense_gain: float
    lifespan_base: float
    lifespan_mass_exponent: float
    maturity_share: float
    basal_rate: float
    metabolic_exponent: float
    cost_speed: float
    cost_sense: float
    cost_armour: float
    cost_jaw: float
    cost_limb_pair: float
    cost_aquatic: float
    move_cost: float
    capacity_per_mass: float
    hunter_rest_share: float
    founder_energy_share: float
    water_stress: float
    wading_depth: float
    graze_rate: float
    graze_jaw_floor: float
    reach_at_unit_mass: float
    browse_floor: float
    plant_energy: float
    meat_energy: float
    diet_exponent: float
    meat_diet_exponent: float
    attack_min_diet: float
    carcass_share: float
    carrion_decay_hours: float
    dung_fertility: float
    carrion_fertility: float
    gut_seeds_per_hour: float
    gut_passage_hours: float
    fire_damage_per_hour: float
    blast_kill_reach: float
    scavenge_rate: float
    carrion_scent_cells: int
    instinct_scavenge: float
    defence_toxicity: float
    hunt_below_energy_share: float
    reach_cells: float
    attack_rate: float
    attack_jaw_floor: float
    armour_strength: float
    attack_softness: float
    attack_cost: float
    cover_protection: float
    compat_distance: float
    repro_energy_share: float
    repro_cooldown_days: float
    crowding_wait_days: float
    crowding_exponent: float
    repro_investment_share: float
    birth_efficiency: float
    brood_max: int
    asexual_after_days: float
    asexual_cost_factor: float
    mutation_sigma_body: float
    mutation_sigma_brain: float
    rare_gain_probability: float
    rare_loss_probability: float
    rare_slots: int
    venom_attack_factor: float
    venom_burn_cost: float
    toxic_kill_factor: float
    toxic_burn_cost: float
    giant_mass_factor: float
    giant_maturity_factor: float
    giant_burn_cost: float
    longevity_factor: float
    longevity_brood_factor: float
    longevity_burn_cost: float
    longevity_cooldown_factor: float
    amphibious_burn_cost: float
    hibernation_burn_cost: float
    hibernation_daylight: float
    hibernation_wake_share: float
    hibernation_burn_share: float
    hibernation_ageing_share: float
    photosynthesis_rate: float
    photosynthesis_burn_cost: float
    photosynthesis_land_speed: float
    glow_burn_cost: float
    night_sight: float
    wander_noise: float
    wander_turn: float
    instinct_food: float
    instinct_prey: float
    instinct_flee: float
    instinct_mate: float
    instinct_land: float
    instinct_space: float
    founder_brain_sigma: float
    learning: bool
    learning_rate_max: float
    exploration_max: float
    trace_hours: float
    exploration_hours: float
    exploration_fade_hours: float
    exploration_floor: float
    baseline_hours: float
    learned_max: float
    forget_hours: float
    meal_learning_gain: float
    social_copy_max: float
    perturbation_gain: float
    meal_memory_hours: float
    cost_learning: float
    competence_hours: float
    herbivore_max_diet: float
    predator_min_diet: float

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[fauna] {message}")

        for key, value in vars(self).items():
            check(value >= 0, f"{key} must not be negative")
        positive = (
            "population_cap",
            "crowding_exponent",
            "founder_count",
            "mass_min",
            "limb_pairs_max",
            "speed_base",
            "sense_base",
            "lifespan_base",
            "basal_rate",
            "capacity_per_mass",
            "plant_energy",
            "meat_energy",
            "diet_exponent",
            "meat_diet_exponent",
            "reach_cells",
            "attack_softness",
            "compat_distance",
            "brood_max",
            "rare_slots",
            "immigrant_group_size",
            "exploration_max",
            "trace_hours",
            "exploration_hours",
            "exploration_fade_hours",
            "carrion_decay_hours",
            "fire_damage_per_hour",
            "blast_kill_reach",
            "baseline_hours",
            "learned_max",
            "forget_hours",
            "meal_memory_hours",
            "competence_hours",
            "gut_passage_hours",
        )
        for key in positive:
            check(getattr(self, key) > 0, f"{key} must be positive")
        unit = (
            "cover_protection",
            "founder_min_plant_cover",
            "immigrant_hunter_share",
            "founder_diet_max",
            "founder_size_max",
            "speed_floor",
            "limbless_speed",
            "armour_slowdown",
            "aquatic_land_slowdown",
            "swim_floor",
            "swim_limb_drag",
            "maturity_share",
            "founder_energy_share",
            "graze_jaw_floor",
            "browse_floor",
            "attack_min_diet",
            "hunt_below_energy_share",
            "repro_energy_share",
            "birth_efficiency",
            "rare_gain_probability",
            "exploration_floor",
            "carcass_share",
            "social_copy_max",
            "rare_loss_probability",
            "toxic_kill_factor",
            "longevity_brood_factor",
            "hibernation_daylight",
            "hibernation_wake_share",
            "hibernation_burn_share",
            "hibernation_ageing_share",
            "photosynthesis_land_speed",
            "night_sight",
            "herbivore_max_diet",
            "predator_min_diet",
        )
        for key in unit:
            check(getattr(self, key) <= 1.0, f"{key} must be within [0, 1]")
        check(self.mass_min < self.mass_max, "mass_min must be below mass_max")
        check(self.rare_slots <= 16, "rare_slots must fit in 16 bits")
        for key in ("venom_attack_factor", "giant_mass_factor", "giant_maturity_factor",
                    "longevity_factor", "longevity_cooldown_factor"):  # fmt: skip
            check(getattr(self, key) >= 1.0, f"{key} must be at least 1")
        check(self.herbivore_max_diet < self.predator_min_diet, "diet classes overlap")
        check(self.hunter_rest_share <= 1.0, "hunter_rest_share above 1")
        check(
            self.repro_investment_share < self.repro_energy_share,
            "breeding would starve the parent",
        )
        check(self.founder_count <= self.population_cap, "more founders than the cap")
        check(self.hunter_wave_count <= self.predator_cap, "more hunters than their cap")


@dataclass(frozen=True)
class SpeciesConfig:
    """``[species]``; units and intent of every key are documented in default.toml."""

    link_distance: float
    min_members: int
    predator_min_members: int
    split_days: float

    def __post_init__(self) -> None:
        if not 0 < self.link_distance <= 1:
            raise ConfigError("[species] link_distance must be within (0, 1]")
        if self.min_members < 1 or self.predator_min_members < 1:
            raise ConfigError("[species] min_members must be at least 1")
        if self.split_days < 0:
            raise ConfigError("[species] split_days must not be negative")


@dataclass(frozen=True)
class PresenceConfig:
    """``[presence]``; units and intent of every key are documented in default.toml."""

    dawn_hours: float
    dusk_hours: float
    night_light: float
    moonlight: float
    moonlight_after_hours: float
    plant_full_light: float
    plant_light_days: float
    god_cooldown_days: float
    god_need_gain: float
    god_weight_meteor: float
    god_weight_rain: float
    god_weight_seed: float
    god_weight_ark: float
    ark_need_creatures: int
    meteor_radius_cells: float
    meteor_depth: float
    meteor_blast_factor: float
    rain_days: float
    rain_growth_boost: float
    rain_fertility: float
    seed_count: int
    seed_rare_chance: float
    ark_count: int
    solar_cycle: bool = False
    latitude: float = 43.7228
    longitude: float = 10.4017

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[presence] {message}")

        for key in ("dawn_hours", "dusk_hours", "plant_full_light", "plant_light_days",
                    "meteor_radius_cells",
                    "meteor_depth", "ark_need_creatures"):  # fmt: skip
            check(getattr(self, key) > 0, f"{key} must be positive")
        for key in ("night_light", "moonlight", "plant_full_light", "rain_fertility",
                    "seed_rare_chance", "meteor_depth"):  # fmt: skip
            check(0 <= getattr(self, key) <= 1, f"{key} must be within [0, 1]")
        for key in ("moonlight_after_hours", "god_cooldown_days", "god_need_gain",
                    "god_weight_meteor", "god_weight_rain", "god_weight_seed", "god_weight_ark",
                    "rain_days", "rain_growth_boost", "seed_count", "ark_count"):  # fmt: skip
            check(getattr(self, key) >= 0, f"{key} must not be negative")
        weights = (self.god_weight_meteor, self.god_weight_rain, self.god_weight_seed,
                   self.god_weight_ark)  # fmt: skip
        check(sum(weights) > 0, "at least one god power needs a weight")
        check(self.meteor_blast_factor >= 1, "meteor_blast_factor must be at least 1")
        check(-90 <= self.latitude <= 90, "latitude must be within [-90, 90]")
        check(-180 <= self.longitude <= 180, "longitude must be within [-180, 180]")


@dataclass(frozen=True)
class WeatherConfig:
    """``[weather]``; units and intent of every key are documented in default.toml."""

    rain_spells_per_month_spring: float
    rain_spells_per_month_summer: float
    rain_spells_per_month_autumn: float
    rain_spells_per_month_winter: float
    rain_hours_min: float
    rain_hours_max: float
    thunder_share: float
    storm_share: float
    storm_hours_min: float
    storm_hours_max: float
    cloud_spells_per_month: float
    cloud_hours_min: float
    cloud_hours_max: float

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[weather] {message}")

        check(self.cloud_spells_per_month >= 0, "cloud_spells_per_month must not be negative")
        check(self.cloud_hours_min > 0, "cloud_hours_min must be positive")
        check(self.cloud_hours_max >= self.cloud_hours_min, "cloud_hours_max below cloud_hours_min")

        for key in ("rain_spells_per_month_spring", "rain_spells_per_month_summer",
                    "rain_spells_per_month_autumn", "rain_spells_per_month_winter"):  # fmt: skip
            check(getattr(self, key) >= 0, f"{key} must not be negative")
        for key in ("rain_hours_min", "storm_hours_min"):
            check(getattr(self, key) > 0, f"{key} must be positive")
        check(self.rain_hours_max >= self.rain_hours_min, "rain_hours_max below rain_hours_min")
        check(self.storm_hours_max >= self.storm_hours_min, "storm_hours_max below storm_hours_min")
        for key in ("thunder_share", "storm_share"):
            check(0 <= getattr(self, key) <= 1, f"{key} must be within [0, 1]")
        check(self.thunder_share + self.storm_share <= 1, "thunder_share + storm_share above 1")


@dataclass(frozen=True)
class ChronicleConfig:
    """``[chronicle]``; units and intent of every key are documented in default.toml."""

    notable_importance: int
    major_importance: int
    daily_cap: int
    dedup_days: float
    importance_first_life: int
    importance_last_creature: int
    importance_world_end: int
    importance_world_begin: int
    importance_first: int
    importance_god_power: int
    importance_volcano: int
    importance_meteor: int
    importance_earthquake: int
    importance_split: int
    importance_rejoin: int
    importance_arrival: int
    importance_speciation: int
    importance_extinction: int
    importance_minor_extinction: int
    importance_record: int
    importance_boom: int
    importance_crash: int
    importance_migration: int
    importance_fire: int
    importance_huge_fire: int
    importance_anniversary: int
    importance_dark_age: int
    importance_dawn: int
    importance_season: int
    notable_species_days: float
    notable_species_peak: int
    fire_cells: int
    huge_fire_cells: int
    record_after_days: float
    record_margin: float
    record_gap_days: float
    swing_days: int
    boom_factor: float
    crash_factor: float
    swing_min_members: int
    migration_min_members: int
    migration_gap_days: float
    swimmer_min_aquatic: float
    dark_age_hours: float
    species_anniversary_days: float

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[chronicle] {message}")

        for f in fields(self):
            if f.name.startswith("importance_") or f.name.endswith("_importance"):
                check(1 <= getattr(self, f.name) <= 5, f"{f.name} must be within [1, 5]")
        check(self.notable_importance <= self.major_importance, "notable above major")
        for key in ("daily_cap", "notable_species_peak", "fire_cells", "swing_days",
                    "swing_min_members", "migration_min_members", "dark_age_hours",
                    "species_anniversary_days"):  # fmt: skip
            check(getattr(self, key) > 0, f"{key} must be positive")
        for key in ("dedup_days", "notable_species_days", "record_after_days", "record_margin",
                    "record_gap_days", "migration_gap_days"):  # fmt: skip
            check(getattr(self, key) >= 0, f"{key} must not be negative")
        check(self.huge_fire_cells >= self.fire_cells, "huge_fire_cells below fire_cells")
        check(self.boom_factor > 1 and self.crash_factor > 1, "swing factors must exceed 1")
        check(0 <= self.swimmer_min_aquatic <= 1, "swimmer_min_aquatic must be within [0, 1]")


@dataclass(frozen=True)
class ApocalypseConfig:
    """``[apocalypse]``; units and intent of every key are documented in default.toml."""

    established_days: float

    def __post_init__(self) -> None:
        if self.established_days < 0:
            raise ConfigError("[apocalypse] established_days must not be negative")


@dataclass(frozen=True)
class Config:
    config_version: int
    calendar: CalendarConfig
    terrain: TerrainConfig
    flora: FloraConfig
    fauna: FaunaConfig
    species: SpeciesConfig
    presence: PresenceConfig
    weather: WeatherConfig
    chronicle: ChronicleConfig
    apocalypse: ApocalypseConfig
    # Subsystem name -> tick period in sim seconds.
    schedule: Mapping[str, float]

    def period_ms(self, subsystem: str) -> int:
        try:
            return round(self.schedule[subsystem] * 1000)
        except KeyError:
            raise ConfigError(f"no [schedule] period for subsystem {subsystem!r}") from None


def _section(raw: Mapping[str, Any], name: str, keys: frozenset[str]) -> dict[str, Any]:
    value = raw.get(name)
    if not isinstance(value, dict):
        raise ConfigError(f"missing section [{name}]")
    section = cast(dict[str, Any], value)
    unknown = set(section) - keys
    missing = keys - set(section)
    if unknown:
        raise ConfigError(f"unknown keys in [{name}]: {sorted(unknown)}")
    if missing:
        raise ConfigError(f"missing keys in [{name}]: {sorted(missing)}")
    return section


def _calendar(raw: Mapping[str, Any]) -> CalendarConfig:
    keys = frozenset({"hemisphere", "spring_start", "summer_start", "autumn_start", "winter_start"})
    section = _section(raw, "calendar", keys)
    try:
        hemisphere = Hemisphere(section["hemisphere"])
    except ValueError:
        raise ConfigError(f"invalid hemisphere {section['hemisphere']!r}") from None
    spring = MonthDay.parse(str(section["spring_start"]))
    summer = MonthDay.parse(str(section["summer_start"]))
    autumn = MonthDay.parse(str(section["autumn_start"]))
    winter = MonthDay.parse(str(section["winter_start"]))
    if not spring < summer < autumn < winter:
        raise ConfigError("season starts must be in order spring < summer < autumn < winter")
    return CalendarConfig(hemisphere, spring, summer, autumn, winter)


def _numeric_section(raw: Mapping[str, Any], name: str, cls: type[_T]) -> _T:
    """Build a dataclass of int/float/bool fields from section ``[name]``, checking every
    key."""
    all_fields = fields(cast(Any, cls))
    types = {f.name: str(f.type) for f in all_fields}
    required = {f.name for f in all_fields if f.default is MISSING}
    defaults = {f.name: f.default for f in all_fields if f.default is not MISSING}
    section_val = raw.get(name)
    if not isinstance(section_val, dict):
        raise ConfigError(f"missing section [{name}]")
    section = cast(dict[str, Any], section_val)
    unknown = set(section) - set(types)
    missing = required - set(section)
    if unknown:
        raise ConfigError(f"unknown keys in [{name}]: {sorted(unknown)}")
    if missing:
        raise ConfigError(f"missing keys in [{name}]: {sorted(missing)}")
    values: dict[str, int | float | bool] = {}
    for key, kind in types.items():
        if key in section:
            value = section[key]
        else:
            values[key] = defaults[key]
            continue
        if kind == "bool":
            if not isinstance(value, bool):
                raise ConfigError(f"[{name}] {key} must be true or false")
            values[key] = value
            continue
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ConfigError(f"[{name}] {key} must be a number")
        if kind == "int":
            if not isinstance(value, int):
                raise ConfigError(f"[{name}] {key} must be an integer")
            values[key] = value
        else:
            values[key] = float(value)
    return cls(**values)


def _schedule(raw: Mapping[str, Any]) -> Mapping[str, float]:
    if not isinstance(raw.get("schedule"), dict):
        raise ConfigError("missing section [schedule]")
    section = cast(dict[str, Any], raw["schedule"])
    schedule: dict[str, float] = {}
    for name, value in sorted(section.items()):
        if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
            raise ConfigError(f"[schedule] {name} must be a positive number of seconds")
        if round(value * 1000) < 1:
            raise ConfigError(f"[schedule] {name} is shorter than 1 ms")
        schedule[name] = float(value)
    return MappingProxyType(schedule)


def parse_config(text: str) -> Config:
    """Parse and validate configuration TOML text."""
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"invalid TOML: {exc}") from None
    unknown = set(raw) - {
        "meta",
        "calendar",
        "schedule",
        "terrain",
        "flora",
        "fauna",
        "species",
        "presence",
        "weather",
        "chronicle",
        "apocalypse",
    }
    if unknown:
        raise ConfigError(f"unknown sections: {sorted(unknown)}")
    meta = _section(raw, "meta", frozenset({"config_version"}))
    if meta["config_version"] != CONFIG_VERSION:
        raise ConfigError(f"unsupported config_version {meta['config_version']!r}")
    return Config(
        CONFIG_VERSION,
        _calendar(raw),
        _numeric_section(raw, "terrain", TerrainConfig),
        _numeric_section(raw, "flora", FloraConfig),
        _numeric_section(raw, "fauna", FaunaConfig),
        _numeric_section(raw, "species", SpeciesConfig),
        _numeric_section(raw, "presence", PresenceConfig),
        _numeric_section(raw, "weather", WeatherConfig),
        _numeric_section(raw, "chronicle", ChronicleConfig),
        _numeric_section(raw, "apocalypse", ApocalypseConfig),
        _schedule(raw),
    )
