"""Build the state stream's messages from a world (``schema.json`` defines them).

Pure functions of the world: no I/O, no clock. The server sends them over the WebSocket
(S1); ``tools/stream.py`` writes them to files for the renderer to draw without a server.
"""

from __future__ import annotations

import base64
import importlib
from collections.abc import Iterable, Sequence
from typing import Any

import numpy as np
from lineage_sim.events import (
    ChronicleEntry,
    CraterFormed,
    CreaturesArrived,
    CreaturesBorn,
    CreaturesDied,
    EarthquakeStruck,
    FireEnded,
    FireStarted,
    GodPowerUsed,
    OutputEvent,
    VolcanoErupted,
    WorldBegan,
    WorldEnded,
)
from lineage_sim.fauna import phenotype
from lineage_sim.fauna.genome import Gene as CreatureGene
from lineage_sim.flora import RARE_GENES, Cover
from lineage_sim.flora import Gene as PlantGene
from lineage_sim.weather import Rain
from lineage_sim.world import World

PROTOCOL = 1
Message = dict[str, Any]

# Whole numbers per unit of a grid's values.
HEIGHT_STEPS = 65535
SHARE_STEPS = 255


def grid(values: np.ndarray, encoding: str = "u8", scale: float = 1) -> dict[str, Any]:
    """A grid of the world's cells, row by row, as the schema's ``Grid``."""
    dtype = "<u2" if encoding == "u16le" else "u1"
    top = 65535 if encoding == "u16le" else 255
    numbers = np.clip(np.rint(np.asarray(values, dtype=np.float64) * scale), 0, top)
    data = np.ascontiguousarray(numbers.astype(dtype)).tobytes()
    return {"encoding": encoding, "scale": scale, "data": base64.b64encode(data).decode("ascii")}


def clock_message(world: World) -> Message:
    instant = world.instant
    return {
        "type": "clock",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "date": instant.date.isoformat(),
        "season": instant.season.value,
        "season_progress": round(float(instant.season_progress), 6),
        "day_of_year": instant.day_of_year,
        "days_in_year": instant.days_in_year,
    }


def land_message(world: World) -> Message:
    terrain, flora = world.terrain, world.flora
    rows, columns = terrain.height.shape
    growing = flora.biomass > 0
    genome = flora.genome.astype(np.float64) / 255.0

    def gene(which: PlantGene) -> dict[str, Any]:
        return grid(np.where(growing, genome[which], 0.0), scale=SHARE_STEPS)

    return {
        "type": "land",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "world": {"seed": world.seed},
        "width": int(columns),
        "height": int(rows),
        "sea_level": round(float(terrain.sea_level), 6),
        "cover_classes": [cover.name for cover in Cover],
        "heights": grid(terrain.height, "u16le", HEIGHT_STEPS),
        "cover": grid(flora.cover()),
        "biomass": grid(flora.biomass, scale=SHARE_STEPS),
        "snow": grid(flora.snow(world.instant), scale=SHARE_STEPS),
        # How recently each cell burnt (R4): 1 just burnt, fading to 0 over scorch_days.
        "scorch": grid(flora.scorch, scale=SHARE_STEPS),
        # Algae on the shallow sea (M11), biomass 0 to [flora] algae_capacity.
        "algae": grid(flora.algae, scale=SHARE_STEPS),
        "plant_height": gene(PlantGene.HEIGHT),
        "plant_evergreen": gene(PlantGene.EVERGREEN),
        "plant_rare": grid(np.where(growing, flora.rare, 0)),
        "rare_genes": [rare.name for rare in RARE_GENES if rare.name is not None],
    }


def fauna_message(world: World) -> Message:
    """What bodies are derived from. ``phenotype_config`` holds the keys R2's port reads,
    once the sim names them (``phenotype.CONFIG_KEYS``); ``rare_config`` those for drawing
    rare genes (``rare.render_config``)."""
    config = world.fauna.config
    keys: Iterable[str] = getattr(phenotype, "CONFIG_KEYS", ())
    rare = importlib.import_module("lineage_sim.rare")
    render_config = getattr(rare, "render_config", None)
    return {
        "type": "fauna",
        "protocol": PROTOCOL,
        "genes": [gene.name for gene in CreatureGene],
        "phenotype_config": {key: getattr(config, key) for key in keys},
        # What drawing rare genes needs (M7, R2), once the sim names it.
        "rare_config": {} if render_config is None else dict(render_config(config)),
    }


# How finely a young creature's growth is sent: sixteenths of the way to coming of age.
YOUNG_STEPS = 16
# Energy comes in sixteenths of a full reserve (`energy` on the wire).
ENERGY_STEPS = 16


def creatures_message(
    world: World, sent: set[int] | None = None, news: Sequence[OutputEvent] = ()
) -> Message:
    """Where every creature is; genomes of those not in ``sent``, which is then updated.
    ``news`` are the world's outputs since the last creatures message: who of those sent
    died of what (and by which hunter), who landed from the sea, and to whom each newborn
    was born (R5)."""
    fauna = world.fauna
    ids = [int(value) for value in fauna.ids]
    known = sent if sent is not None else set()
    died: list[dict[str, Any]] = []
    for output in news:
        if not isinstance(output, CreaturesDied):
            continue
        # Who killed each victim of a hunter (R5), when the sim says.
        killers = output.killers or (-1,) * len(output.ids)
        for ident, cause, killer in zip(output.ids, output.causes, killers, strict=True):
            if ident not in known:
                continue
            death: dict[str, Any] = {"id": int(ident), "cause": str(cause)}
            if cause == "killed" and killer >= 0:
                death["by"] = int(killer)
            died.append(death)
    # The mother of each born on the island since the last message (R5).
    mothers = {
        ident: parent
        for output in news
        if isinstance(output, CreaturesBorn)
        for ident, parent in zip(output.ids, output.parents, strict=True)
    }
    alive = set(ids)
    landed = [
        ident
        for output in news
        if isinstance(output, CreaturesArrived)
        for ident in range(output.first_id, output.first_id + output.count)
        if ident in alive
    ]
    genes = fauna.genes
    # Rare genes (M7): the slots of each creature, and who is torpid, once the sim has them.
    slots = getattr(fauna, "slots", None)
    torpid = getattr(fauna, "torpid", None)
    born: list[dict[str, Any]] = []
    for row, ident in enumerate(ids):
        if ident in known:
            continue
        entry: dict[str, Any] = {
            "id": ident,
            "genome": [round(float(value), 6) for value in genes[row]],
        }
        if slots is not None:
            entry["slots"] = int(slots[row])
        if ident in mothers:
            entry["parent"] = int(mothers[ident])
        born.append(entry)
    known.update(ids)
    message: Message = {
        "type": "creatures",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "ids": ids,
        "positions": np.round(fauna.positions.astype(np.float64), 3).tolist(),
        "born": born,
    }
    species = getattr(world, "species", None)
    if species is not None:
        message["species"] = [int(label) for label in species.labels_now()]
    if torpid is not None:
        message["torpid"] = [ident for row, ident in enumerate(ids) if bool(torpid[row])]
    # What each is eating (R5): plants or algae, or meat, as of the last tick.
    eating = getattr(fauna, "eating", None)
    if eating is not None:
        food = np.asarray(eating)
        message["grazing"] = [ident for row, ident in enumerate(ids) if int(food[row]) == 1]
        message["feeding"] = [ident for row, ident in enumerate(ids) if int(food[row]) == 2]
    # The young (R5): how far each has grown toward coming of age, in sixteenths.
    maturity = getattr(fauna, "maturity", None)
    if maturity is not None:
        steps = np.floor(np.asarray(maturity, dtype=np.float64) * YOUNG_STEPS).astype(int)
        message["young"] = [
            [ident, int(steps[row])] for row, ident in enumerate(ids) if steps[row] < YOUNG_STEPS
        ]
    # How full each is (the Health Bars mod): energy over its body's capacity, in sixteenths,
    # one per id (0: nearly starved, 15: full).
    energy = getattr(fauna, "energy", None)
    capacity = getattr(getattr(fauna, "body", None), "capacity", None)
    if energy is not None and capacity is not None:
        share = np.asarray(energy, dtype=np.float64) / np.maximum(
            np.asarray(capacity, dtype=np.float64), 1e-9
        )
        message["energy"] = (
            np.clip(np.floor(share * ENERGY_STEPS), 0, ENERGY_STEPS - 1).astype(int).tolist()
        )
    if died:
        message["died"] = died
    if landed:
        message["landed"] = landed
    return message


def rare_message(world: World) -> Message | None:
    """The rare genes of both kingdoms and their looks (M7), or None before they exist."""
    try:
        rare = importlib.import_module("lineage_sim.rare")
    except ModuleNotFoundError:
        return None
    table = getattr(rare, "signature_table", None)
    if table is None:
        return None
    return {
        "type": "rare",
        "protocol": PROTOCOL,
        "genes": [
            {
                "kingdom": str(row["kingdom"]),
                "bit": int(row["bit"]),
                "name": str(row["name"]),
                "signature": str(row["signature"]),
                "look": str(row["look"]),
            }
            for row in table()
        ],
    }


def species_message(world: World) -> Message | None:
    """Every species that has lived (M6), or None in a world without species."""
    species = getattr(world, "species", None)
    if species is None:
        return None
    return {
        "type": "species",
        "protocol": PROTOCOL,
        "species": [
            {
                "id": int(record.id),
                "name": str(record.name),
                "parent": int(record.parent) if record.parent > 0 else None,
                "extinct": record.extinct_t_ms >= 0,
            }
            for record in species.records()
        ],
    }


def chronicle_message(world: World, after: int = 0) -> Message | None:
    """The chronicle's entries numbered above ``after`` (M9), or None when there are none."""
    chronicle = getattr(world, "chronicle", None)
    if chronicle is None:
        return None
    return entries_message(world, chronicle.entries(after))


def entries_message(world: World, entries: Sequence[ChronicleEntry]) -> Message | None:
    """A chronicle message of ``entries`` (R4: those a step returned, which may span the
    end of a world and the beginning of the next), or None when there are none."""
    if not entries:
        return None
    config = world.config.chronicle
    return {
        "type": "chronicle",
        "protocol": PROTOCOL,
        "notable_importance": int(config.notable_importance),
        "major_importance": int(config.major_importance),
        "entries": [
            {
                "number": int(entry.number),
                "t_ms": int(entry.t_ms),
                "kind": str(entry.kind),
                "importance": int(entry.importance),
                "text": str(entry.text),
                "species": int(entry.species),
                "x": round(float(entry.x), 3),
                "y": round(float(entry.y), 3),
            }
            for entry in entries
        ],
    }


def rain_of(world: World) -> str:
    """What falls now: the rain god power's soaking rain over the island's own (R4)."""
    if world.presence.raining:
        return "soaking"
    return {
        Rain.NONE: "none",
        Rain.RAIN: "rain",
        Rain.THUNDER: "thunder",
        Rain.STORM: "storm",
        Rain.CLOUD: "cloud",
    }[world.weather.rain]


def sky_message(world: World) -> Message:
    """The light of the moment, the owner's presence, rain and the cells on fire (R4)."""
    presence = world.presence
    burning = np.flatnonzero(world.wildfire.burning)
    return {
        "type": "sky",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "light": round(min(max(float(presence.light), 0.0), 1.0), 4),
        "present": bool(presence.present),
        "rain": rain_of(world),
        "burning": [int(index) for index in burning],
    }


def _event(output: OutputEvent) -> dict[str, Any] | None:
    """One output as an ``events`` entry, or None for those the scene does not show."""
    at: dict[str, Any] = {"t_ms": int(output.t_ms)}
    if isinstance(output, VolcanoErupted | EarthquakeStruck | CraterFormed):
        kind = {VolcanoErupted: "volcano", EarthquakeStruck: "earthquake", CraterFormed: "crater"}
        return {
            "kind": kind[type(output)],
            **at,
            "x": round(float(output.x), 3),
            "y": round(float(output.y), 3),
            "radius_cells": round(float(output.radius_cells), 3),
        }
    if isinstance(output, FireStarted):
        return {
            "kind": "fire_started",
            **at,
            "x": round(float(output.x), 3),
            "y": round(float(output.y), 3),
        }
    if isinstance(output, FireEnded):
        return {
            "kind": "fire_ended",
            **at,
            "cells": int(output.cells),
            "hours": round(float(output.hours), 3),
        }
    if isinstance(output, GodPowerUsed):
        return {
            "kind": "god_power",
            **at,
            "power": str(output.power),
            "x": round(float(output.x), 3),
            "y": round(float(output.y), 3),
        }
    if isinstance(output, CreaturesArrived):
        return {
            "kind": "creatures_arrived",
            **at,
            "x": round(float(output.x), 3),
            "y": round(float(output.y), 3),
            "count": int(output.count),
        }
    if isinstance(output, WorldEnded):
        return {
            "kind": "world_ended",
            **at,
            "world": int(output.world),
            "seed": int(output.seed),
            "cause": str(output.cause),
        }
    if isinstance(output, WorldBegan):
        return {"kind": "world_began", **at, "world": int(output.world), "seed": int(output.seed)}
    return None


def events_message(outputs: Sequence[OutputEvent]) -> Message | None:
    """What of ``outputs`` the scene shows as weather or a sequence (R4), or None."""
    events = [event for event in map(_event, outputs) if event is not None]
    if not events:
        return None
    return {"type": "events", "protocol": PROTOCOL, "events": events}


def view_message() -> Message:
    """The desk's view button (S1): for the kiosk on the device only."""
    return {"type": "view", "protocol": PROTOCOL}


def connect_messages(world: World, sent: set[int] | None = None) -> list[Message]:
    """Everything a renderer needs when it connects, in the order to send it."""
    messages = [clock_message(world), sky_message(world), land_message(world), fauna_message(world)]
    for extra in (species_message(world), rare_message(world)):
        if extra is not None:
            messages.append(extra)
    messages.append(creatures_message(world, sent))
    return messages
