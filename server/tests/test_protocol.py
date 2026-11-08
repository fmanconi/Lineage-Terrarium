"""The state stream: every message the encoder builds is what the schema says."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from lineage_server.protocol import SCHEMA_PATH, encode
from lineage_sim.config import parse_config
from lineage_sim.flora import RARE_GENES, Cover
from lineage_sim.state import io
from lineage_sim.world import World

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v4.lzma"
CONFIG = REPO / "sim" / "config" / "default.toml"
SCHEMA: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def errors(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Where `value` breaks `schema`: the part of JSON Schema that schema.json uses."""
    if "$ref" in schema:
        name = schema["$ref"].removeprefix("#/$defs/")
        return errors(value, SCHEMA["$defs"][name], path)
    if "oneOf" in schema:
        passing = [option for option in schema["oneOf"] if not errors(value, option, path)]
        return [] if len(passing) == 1 else [f"{path}: matches {len(passing)} of oneOf"]
    found: list[str] = []
    kinds = schema.get("type")
    if kinds is not None:
        names = kinds if isinstance(kinds, list) else [kinds]
        checks = {
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "null": lambda v: v is None,
        }
        if not any(checks[name](value) for name in names):
            return [f"{path}: not {kinds}"]
    if "const" in schema and value != schema["const"]:
        found.append(f"{path}: {value!r} is not {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        found.append(f"{path}: {value!r} not in {schema['enum']}")
    if "pattern" in schema and not re.search(schema["pattern"], value):
        found.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if "minimum" in schema and value < schema["minimum"]:
        found.append(f"{path}: {value} below {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        found.append(f"{path}: {value} above {schema['maximum']}")
    if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
        found.append(f"{path}: {value} not above {schema['exclusiveMinimum']}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        found += [f"{path}: no {key}" for key in schema.get("required", []) if key not in value]
        for key, item in value.items():
            if key in properties:
                found += errors(item, properties[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                found.append(f"{path}: unexpected {key}")
            elif isinstance(schema.get("additionalProperties"), dict):
                found += errors(item, schema["additionalProperties"], f"{path}.{key}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            found.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            found.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for index, item in enumerate(value):
                found += errors(item, schema["items"], f"{path}[{index}]")
    return found


def decode(grid: dict[str, Any], count: int) -> np.ndarray:
    dtype = "<u2" if grid["encoding"] == "u16le" else "u1"
    numbers = np.frombuffer(base64.b64decode(grid["data"]), dtype=dtype)
    assert numbers.size == count
    return numbers.astype(np.float64) / grid["scale"]


@pytest.fixture(scope="module")
def world() -> World:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    return World.restore(config, io.loads(SAVE.read_bytes()))


def test_the_schema_checker_catches_what_it_should() -> None:
    clock = {
        "type": "clock",
        "protocol": 1,
        "t_ms": 0,
        "date": "2026-01-01",
        "season": "winter",
        "season_progress": 0.1,
        "day_of_year": 1,
        "days_in_year": 365,
    }
    assert errors(clock, SCHEMA) == []
    assert errors({**clock, "season": "monsoon"}, SCHEMA)
    assert errors({**clock, "extra": 1}, SCHEMA)
    assert errors({key: value for key, value in clock.items() if key != "date"}, SCHEMA)


def test_the_view_button_message_is_what_the_schema_says() -> None:
    assert errors(encode.view_message(), SCHEMA) == []
    assert errors({**encode.view_message(), "view": "map"}, SCHEMA)


def test_every_message_on_connect_is_what_the_schema_says(world: World) -> None:
    messages = encode.connect_messages(world)
    assert [message["type"] for message in messages][:4] == ["clock", "sky", "land", "fauna"]
    assert messages[-1]["type"] == "creatures"
    for message in messages:
        assert errors(message, SCHEMA) == [], message["type"]
        # And it survives the wire.
        assert json.loads(json.dumps(message)) == message


def test_the_land_carries_the_world_cell_for_cell(world: World) -> None:
    land = encode.land_message(world)
    terrain, flora = world.terrain, world.flora
    count = terrain.height.size
    assert (land["height"], land["width"]) == terrain.height.shape
    heights = decode(land["heights"], count).reshape(terrain.height.shape)
    assert np.max(np.abs(heights - terrain.height)) <= 0.5 / encode.HEIGHT_STEPS + 1e-7
    cover = decode(land["cover"], count).reshape(terrain.height.shape)
    assert np.array_equal(cover, flora.cover())
    assert land["cover_classes"][Cover.WATER] == "WATER"
    biomass = decode(land["biomass"], count).reshape(terrain.height.shape)
    assert np.max(np.abs(biomass - flora.biomass)) <= 0.5 / 255 + 1e-7
    # Plant genes where something grows, nothing elsewhere.
    height_gene = decode(land["plant_height"], count).reshape(terrain.height.shape)
    assert np.all(height_gene[flora.biomass <= 0] == 0)
    assert np.any(height_gene[flora.biomass > 0] > 0)
    snow = decode(land["snow"], count)
    assert np.all((snow >= 0) & (snow <= 1))
    # The plants' rare genes by bit, as the simulation names them (M7: six).
    assert land["rare_genes"] == [rare.name for rare in RARE_GENES]
    assert land["rare_genes"][:3] == ["FIRE_PINE", "NITROGEN_FIXER", "MANGROVE"]


def test_creatures_send_their_genomes_once(world: World) -> None:
    sent: set[int] = set()
    first = encode.creatures_message(world, sent)
    assert len(first["ids"]) == world.fauna.count == len(first["positions"])
    assert {born["id"] for born in first["born"]} == set(first["ids"])
    assert all(len(born["genome"]) == world.fauna.genes.shape[1] for born in first["born"])
    again = encode.creatures_message(world, sent)
    assert again["born"] == []
    assert again["ids"] == first["ids"]


def test_messages_are_pure_functions_of_the_world(world: World) -> None:
    assert encode.connect_messages(world) == encode.connect_messages(world)


def test_rare_genes_travel_once_the_sim_has_them(monkeypatch: pytest.MonkeyPatch) -> None:
    """M7's parts (lineage_sim.rare, Fauna.slots, Fauna.torpid) are read only when present:
    a stand-in of the same shape shows what the messages carry then."""
    import sys
    import types

    rare = types.ModuleType("lineage_sim.rare")
    table = [
        {"kingdom": "creature", "bit": 1, "name": "VENOM", "signature": "fangs", "look": "x"},
        {"kingdom": "plant", "bit": 8, "name": "POISONOUS", "signature": "purple", "look": "y"},
    ]
    rare.signature_table = lambda: table  # type: ignore[attr-defined]
    rare.render_config = lambda cfg: {"giant_mass_factor": 2.0}  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "lineage_sim.rare", rare)
    fauna = types.SimpleNamespace(
        ids=np.array([7, 9], dtype=np.int64),
        genes=np.zeros((2, 14), dtype=np.float32),
        positions=np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32),
        slots=np.array([1, 0], dtype=np.uint16),
        torpid=np.array([False, True]),
    )
    world = types.SimpleNamespace(fauna=fauna, t_ms=5)
    creatures = encode.creatures_message(world)  # type: ignore[arg-type]
    assert errors(creatures, SCHEMA) == []
    assert [born["slots"] for born in creatures["born"]] == [1, 0]
    assert creatures["torpid"] == [9]
    # The phenotype's keys are read from the real config (R2 named them: CONFIG_KEYS).
    fauna.config = parse_config(CONFIG.read_text(encoding="utf-8")).fauna
    assert encode.fauna_message(world)["rare_config"] == {"giant_mass_factor": 2.0}  # type: ignore[arg-type]
    message = encode.rare_message(world)  # type: ignore[arg-type]
    assert message is not None
    assert errors(message, SCHEMA) == []
    assert [gene["name"] for gene in message["genes"]] == ["VENOM", "POISONOUS"]


def test_no_rare_message_before_the_sim_has_rare_genes(world: World) -> None:
    import importlib

    if hasattr(importlib.import_module("lineage_sim.rare"), "signature_table"):
        pytest.skip("lineage_sim.rare has its table (M7 merged)")
    assert encode.rare_message(world) is None
    assert "torpid" not in encode.creatures_message(world)


def test_the_chronicle_sends_only_entries_not_sent_before() -> None:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads((SAVE.parent / "v9.lzma").read_bytes()))
    entries = world.chronicle.entries()
    assert len(entries) > 2
    message = encode.chronicle_message(world)
    assert message is not None
    assert errors(message, SCHEMA) == []
    assert json.loads(json.dumps(message)) == message
    assert [entry["number"] for entry in message["entries"]] == [e.number for e in entries]
    assert message["notable_importance"] == config.chronicle.notable_importance
    later = encode.chronicle_message(world, after=len(entries) - 2)
    assert later is not None
    assert [entry["number"] for entry in later["entries"]] == [len(entries) - 1, len(entries)]
    assert encode.chronicle_message(world, after=len(entries)) is None


def test_the_sky_says_the_light_rain_and_fires_of_the_moment(world: World) -> None:
    sky = encode.sky_message(world)
    assert errors(sky, SCHEMA) == []
    assert sky["light"] == pytest.approx(world.presence.light, abs=1e-4)
    assert sky["present"] == world.presence.present
    assert sky["rain"] == encode.rain_of(world)
    assert sky["rain"] in {"none", "rain", "thunder", "storm", "soaking"}
    burning = world.wildfire.burning
    assert sky["burning"] == [int(i) for i in np.flatnonzero(burning)]
    assert sky["burning"] == sorted(sky["burning"])


def test_events_carry_what_the_scene_shows_and_nothing_else() -> None:
    import datetime as dt

    from lineage_sim.events import (
        CraterFormed,
        CreaturesArrived,
        DayStarted,
        EarthquakeStruck,
        FireEnded,
        FireStarted,
        GodPowerUsed,
        VolcanoErupted,
        WorldBegan,
        WorldEnded,
    )
    from lineage_sim.state.schema import WorldState

    archive = WorldState(seed=3, epoch_unix_ms=0, t_ms=5)
    outputs = [
        DayStarted(0, dt.date(2027, 1, 1)),
        FireStarted(1, 4.0, 5.0),
        FireEnded(2, 12, 3.5),
        VolcanoErupted(3, 10.0, 11.0, 4.0, 0.2),
        EarthquakeStruck(4, 20.0, 21.0, 6.0, 0.01),
        CraterFormed(5, 30.0, 31.0, 3.0, 0.1),
        GodPowerUsed(6, "meteor", 30.0, 31.0),
        CreaturesArrived(6, 12, False, 40.0, 41.0, 900),
        WorldEnded(7, 1, 3, "last_creature", archive),
        WorldBegan(0, 2, 99, 1000),
    ]
    message = encode.events_message(outputs)
    assert message is not None
    assert errors(message, SCHEMA) == []
    assert json.loads(json.dumps(message)) == message
    kinds = [event["kind"] for event in message["events"]]
    assert kinds == [
        "fire_started",
        "fire_ended",
        "volcano",
        "earthquake",
        "crater",
        "god_power",
        "creatures_arrived",
        "world_ended",
        "world_began",
    ]
    assert message["events"][5]["power"] == "meteor"
    assert message["events"][6] == {"kind": "creatures_arrived", "t_ms": 6, "x": 40.0, "y": 41.0,
                                     "count": 12}  # fmt: skip
    assert message["events"][7] == {
        "kind": "world_ended",
        "t_ms": 7,
        "world": 1,
        "seed": 3,
        "cause": "last_creature",
    }
    assert encode.events_message(outputs[:1]) is None
    assert encode.events_message([]) is None


def test_the_land_carries_scorch_and_algae(world: World) -> None:
    land = encode.land_message(world)
    cells = land["width"] * land["height"]
    scorch = decode(land["scorch"], cells).reshape(land["height"], land["width"])
    algae = decode(land["algae"], cells).reshape(land["height"], land["width"])
    assert np.allclose(scorch, world.flora.scorch, atol=1 / 255)
    assert np.allclose(algae, world.flora.algae, atol=1 / 255)


# --- R5: what the scene shows of each creature ------------------------------------------


def _stand_in(
    ids: list[int], maturity: list[float] | None = None, eating: list[int] | None = None
) -> Any:
    """A fauna of ``ids`` with R5's read-only views, in a world at t_ms 5."""
    import types

    count = len(ids)
    fauna = types.SimpleNamespace(
        ids=np.array(ids, dtype=np.int64),
        genes=np.zeros((count, 14), dtype=np.float32),
        positions=np.zeros((count, 2), dtype=np.float32),
    )
    if maturity is not None:
        fauna.maturity = np.array(maturity, dtype=np.float32)
    if eating is not None:
        fauna.eating = np.array(eating, dtype=np.int8)
    return types.SimpleNamespace(fauna=fauna, t_ms=5)


def test_the_dead_are_told_by_cause_and_hunter() -> None:
    from lineage_sim.events import CreaturesDied

    world = _stand_in([1, 2])
    sent: set[int] = set()
    encode.creatures_message(world, sent)  # 1 and 2 sent; 3 never was
    sent.update({4, 6, 7, 8, 9, 10})
    world.fauna.ids = np.array([1], dtype=np.int64)
    news = [
        CreaturesDied(1, (2, 3), ("killed", "starved"), (1, -1)),
        CreaturesDied(2, (4,), ("killed",), (1,)),
        CreaturesDied(3, (6, 7), ("drowned", "old_age"), (-1, -1)),
        CreaturesDied(3, (8,), ("blast",), ()),  # a blast names no hunter
        CreaturesDied(3, (9,), ("killed",), ()),  # a caller that does not say who
        CreaturesDied(3, (10,), ("burnt",), (-1,)),
    ]
    message = encode.creatures_message(world, sent, news)
    assert errors(message, SCHEMA) == []
    assert message["died"] == [
        {"id": 2, "cause": "killed", "by": 1},
        {"id": 4, "cause": "killed", "by": 1},
        {"id": 6, "cause": "drowned"},
        {"id": 7, "cause": "old_age"},
        {"id": 8, "cause": "blast"},
        {"id": 9, "cause": "killed"},
        {"id": 10, "cause": "burnt"},
    ]
    assert json.loads(json.dumps(message)) == message


def test_the_newborn_carry_their_mother_and_the_landed_are_named() -> None:
    from lineage_sim.events import CreaturesArrived, CreaturesBorn

    world = _stand_in([1, 2, 3, 11, 12])
    sent: set[int] = {1, 2}
    news = [
        CreaturesBorn(1, (3, 13), (1, 2)),  # 13 died before the message: not sent
        CreaturesArrived(2, 3, False, 0.0, 0.0, 10),  # ids 10, 11, 12; 10 is gone already
    ]
    message = encode.creatures_message(world, sent, news)
    assert errors(message, SCHEMA) == []
    parents = {born["id"]: born.get("parent") for born in message["born"]}
    assert parents == {3: 1, 11: None, 12: None}
    assert message["landed"] == [11, 12]
    assert "died" not in message
    # Without news: neither the dead nor the landed, nor a parent.
    quiet = encode.creatures_message(world, set())
    assert "died" not in quiet
    assert "landed" not in quiet
    assert all("parent" not in born for born in quiet["born"])


def test_the_young_and_what_each_ate() -> None:
    world = _stand_in([4, 5, 6, 7, 8], maturity=[0.0, 0.5, 0.999, 1.0, 1.0], eating=[1, 2, 0, 1, 0])
    message = encode.creatures_message(world)
    assert errors(message, SCHEMA) == []
    assert message["young"] == [[4, 0], [5, 8], [6, encode.YOUNG_STEPS - 1]]
    assert message["grazing"] == [4, 7]
    assert message["feeding"] == [5]


def test_the_real_fauna_sends_its_young_and_meals() -> None:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads(SAVE.read_bytes()))
    world.step(3600.0)  # an hour of meals
    message = encode.creatures_message(world)
    assert errors(message, SCHEMA) == []
    fauna = world.fauna
    young = {ident: step for ident, step in message["young"]}
    for ident, grown in zip(fauna.ids.tolist(), fauna.maturity.tolist(), strict=True):
        if grown < 1.0:
            assert young[ident] == int(grown * encode.YOUNG_STEPS)
        else:
            assert ident not in young
    eating = fauna.eating
    assert message["grazing"] == fauna.ids[eating == 1].tolist()
    assert message["feeding"] == fauna.ids[eating == 2].tolist()
    assert message["grazing"]  # a herd on pasture grazes


def test_the_schema_knows_the_causes_of_death() -> None:
    from lineage_sim.fauna.population import Death

    message = encode.creatures_message(_stand_in([1]))
    assert errors({**message, "died": [{"id": 1, "cause": "killed", "by": 2}]}, SCHEMA) == []
    assert errors({**message, "died": [{"id": 1, "cause": "eaten"}]}, SCHEMA)
    assert errors({**message, "died": [{"id": 1}]}, SCHEMA)
    assert errors({**message, "young": [[1]]}, SCHEMA)
    for cause in [death.name.lower() for death in Death] + ["blast"]:
        assert errors({**message, "died": [{"id": 1, "cause": cause}]}, SCHEMA) == [], cause


def test_the_energy_of_each_in_sixteenths() -> None:
    import types

    world = _stand_in([4, 5, 6, 7])
    world.fauna.energy = np.array([0.0, 5.0, 9.99, 20.0], dtype=np.float32)
    world.fauna.body = types.SimpleNamespace(capacity=np.array([10.0, 10.0, 10.0, 10.0]))
    message = encode.creatures_message(world)
    assert errors(message, SCHEMA) == []
    assert message["energy"] == [0, 8, encode.ENERGY_STEPS - 1, encode.ENERGY_STEPS - 1]
    # A fauna without energy sends none.
    assert "energy" not in encode.creatures_message(_stand_in([1]))


def test_the_real_fauna_sends_its_energy() -> None:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads(SAVE.read_bytes()))
    message = encode.creatures_message(world)
    assert errors(message, SCHEMA) == []
    fauna = world.fauna
    assert len(message["energy"]) == len(message["ids"])
    share = fauna.energy / fauna.body.capacity
    expected = np.clip(np.floor(share * encode.ENERGY_STEPS), 0, encode.ENERGY_STEPS - 1)
    assert message["energy"] == expected.astype(int).tolist()
    assert len(set(message["energy"])) > 1  # a living herd is not all of one fullness
