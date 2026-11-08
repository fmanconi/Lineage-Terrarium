# Lineage: Terrarium 🌿

*An Idle Biological Evolution Simulator & Desktop Biome Companion*

A small procedurally generated island where creatures and plants evolve over years of real
time, drawn in pixel art. Creatures have genomes, procedural bodies and small brains that
learn; plants spread, compete and burn; the land drifts, erodes and erupts. Species are
born and go extinct, the island writes its own chronicle, and when life collapses a new
world rises. Lineage: Terrarium runs it as a desktop app, or as a 24/7 screensaver on a
machine of its own.

Lineage: Terrarium is a fork of [**Lineage**](https://github.com/mlisi1/Lineage) by
**Michele Lisi** (see [Credits & Upstream](#credits--upstream)).

## Features

- 🪟 **Standalone Desktop App** — the island in its own window, with Picture-in-Picture
  (`[P]`), fullscreen (`[F]`) and snapshots (`[C]`).
- 🧩 **In-Game Modding Framework** — press `[M]` for the pixel-art mod menu and switch mods
  on and off live ([ADR 0024](docs/decisions/0024-renderer-mod-framework.md)).
- 📖 **The Naturalist's Field Guide** — press `[Tab]` for the notebook: living species
  with portraits and genes, the phylogenetic tree, the island's chronicle and settings.
- ⚡ **Fast-Life Mode & 400-Year Bootstrap** — the desktop app runs the biology 90× faster
  and starts from an island already 400 years old, so evolution shows in hours, not years.
- 🌙 **Circadian Solar Cycle & Sleep Mode** — daylight follows the real sun (or a
  day/night cycle in fast-life), with a night dimmer and a super-dark sleep veil (`[N]`).
- 🖥️ **Kiosk & Continuous Screensaver** — ready to run 24/7 on a dedicated Linux machine
  with Chromium in kiosk mode and systemd units ([guide](docs/terrarium-kiosk.md)).

## Quick start: how to play

**Windows** — after the one-time setup below, double-click **`Lineage-Terrarium.cmd`**.
The island opens in a window titled *Lineage: Terrarium*; closing it saves the island.

One-time setup (needs [uv](https://docs.astral.sh/uv/) and Node 22):

```sh
uv sync
cd renderer && npm ci && npm run build:kiosk
```

**Web (development)** — the scene in the browser, with hot reload:

```sh
npm --prefix renderer run dev
```

**Linux screensaver / kiosk** — see [docs/terrarium-kiosk.md](docs/terrarium-kiosk.md):

```sh
./deploy/terrarium-kiosk.sh
```

| Key | What it does |
|---|---|
| `V` | step the views: map → region → one animal |
| `Tab` | the Naturalist's Field Guide |
| `M` | the mod menu |
| `G` | the god power, once a week (rain, seed, meteor or ark, as the island needs) |
| `N` | sleep veil |
| `F` / `P` / `C` | fullscreen / Picture-in-Picture / snapshot |

## How it is built

A pure, deterministic Python simulation (`sim/`, package `lineage_sim`), a real-time server
that streams the world over a WebSocket (`server/`), and one PixiJS renderer for the desk,
the desktop app and the phone (`renderer/`). See [CLAUDE.md](CLAUDE.md) for the
architecture and milestones, [docs/design/](docs/design/) for the spec and
[docs/decisions/](docs/decisions/) for the decisions. The Python packages keep their
upstream names (`lineage_sim`, `lineage_server`, `lineage_device`), so saves and tests stay
compatible ([ADR 0025](docs/decisions/0025-fork-lineage-terrarium.md)).

## Development

Requires [uv](https://docs.astral.sh/uv/) and Node 22.

```sh
uv sync                                   # Python 3.11 workspace: sim, server, device, tools
uv run pytest -m "not slow"               # fast suite
uv run ruff check . && uv run pyright     # lint and types

uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/demo
uv run python -m tools.report M0 --runs runs/demo

cd renderer && npm ci && npm test && npx playwright test
npm run dev                               # then / (the scene: V or a click steps the views) or /land.html
```

Run the island in real time (S1), as the device does, with the desk's page:

```sh
cd renderer && npm run build:kiosk && cd ..
uv run python -m lineage_server.main --data runs/island --dist renderer/dist-kiosk --fake-device
# then http://localhost:8080/ ; keys typed in the terminal play the device:
# p presence, g god power, v view, l/r power lost/restored; Ctrl+C saves and stops
```

If your shell exports `PYTHONPATH` (for example a sourced ROS environment), prefix the
Python commands with `env -u PYTHONPATH`.

## Credits & Upstream

**Lineage** — the simulation engine, the renderer and the design this fork builds on — is
the work of **Michele Lisi**: <https://github.com/mlisi1/Lineage>. On 2026-11-08 he agreed
to this independent fork.

Lineage and Lineage: Terrarium are released under the [Apache License 2.0](LICENSE). The
original copyright and license are kept unchanged; the changes made in this fork are listed
in its commit history and decisions ([ADR 0025](docs/decisions/0025-fork-lineage-terrarium.md)).
