# CLAUDE.md — Lineage

Guidance for Claude (and humans) working in this repository. Read this file fully before
making changes. When this file and a request disagree, ask.

## 1. What Lineage is

Lineage is an idle desk gadget: a small procedurally generated island where creatures and
plants evolve over **years** of real time. It sits on a work desk, runs 24/7, and writes its
own history.

- **Creatures**: genome → procedural body; small neural brain; evolution plus lifetime
  learning (reinforcement); rare genes with an extreme bonus and a real cost.
- **Plants**: vegetation grid; 8-gene plant genome; succession (bare → grass → shrub →
  forest), fire, grazing; rare plant genes.
- **Terrain**: height + fertility grids; plate drift, sea-level cycles, erosion, volcanoes;
  everything changes slowly and never resets except at the end of a world.
- **The owner's presence is the sun**: a PIR sensor sets daylight. Evenings are dusk,
  weekends are the "Long Night", holidays are dark ages. Seasons follow the real calendar.
- **One rare intervention**: a button triggers a "god power" (meteor, rain, seed, ark),
  chosen by the island at random, weighted by what it needs, with a 7-day cooldown shown
  by an LED (ADR 0016).
- **Worlds end**: if life collapses, an apocalypse plays and a new continent is generated.
  Past worlds are archived.
- **Chronicle and bestiary**: an event detector writes dated history entries; every species
  that ever lived is recorded.
- **Outputs**: one continuous scene on a 7" screen (documentary camera + captions, its view
  chosen with a view button, ADR 0020), a phone
  web app, push notifications for major events, and a daily public journal (static site).
- **Look**: pixel art everywhere (flat palettes, stepped shading, hard pixel edges); see
  `docs/design/concept.md`. The screen shows the world from three distances: the
  continent as a map, a region, and one animal from close to the ground
  (`docs/design/renderer.md`, ADR 0007).

Design references live in `docs/design/` and `mockups/`. They are the spec; keep them in
sync when behaviour changes.

## 2. Target hardware (for context; hardware work comes later)

- Orange Pi Zero 2W (Allwinner H618, quad A53; the 2 GB model), Debian-based OS (Trixie,
  whose Python is 3.13; the project runs on its own Python 3.11, brought by `uv`, S1).
- Waveshare 70H-1024600 7" IPS, 1024×600, HDMI via adapter board + 15 cm FPC; backlight
  enable/PWM pins driven from GPIO.
- PIR sensor, god-power push button, view push button (steps the screen's views, ADR 0020),
  cooldown LED, power switch, 18650 UPS module with mains-loss sense.
- The software must also run fully on a normal PC with no hardware attached.

## 3. Repository layout

```
lineage/
├── CLAUDE.md                 # this file
├── README.md
├── docs/
│   ├── design/               # spec: concept, creatures, plants, terrain, chronicle, presence
│   ├── decisions/            # ADRs: NNNN-short-title.md (context, decision, consequences)
│   ├── milestones.md         # status table mirrored from section 8 of this file; handoff notes
│   └── m11-plan.md           # how M11 will tune the island (evidence from M5 onward)
├── sim/                      # Python package `lineage_sim` — the world. Pure. No I/O.
│   ├── pyproject.toml
│   ├── lineage_sim/
│   │   ├── clock.py          # sim time, calendar, seasons; time is INJECTED, never read
│   │   ├── rng.py            # seeded streams per subsystem
│   │   ├── config.py         # typed config loaded from TOML
│   │   ├── world.py          # World: owns subsystems, step(dt), apply(event)
│   │   ├── subsystem.py      # Context + Subsystem protocol (what the World drives)
│   │   ├── terrain.py
│   │   ├── flora.py
│   │   ├── fauna/            # genome.py, phenotype.py, brain.py, creature.py, population.py
│   │   ├── species.py        # clustering, persistent ids, names, phylogeny
│   │   ├── rare.py           # rare gene tables (creatures + plants)
│   │   ├── presence.py       # presence/daylight model, god powers, cooldown
│   │   ├── weather.py        # the island's own rain, thunder, thunderstorms, overcast (R4)
│   │   ├── chronicle.py      # event detectors → entries; bestiary records (M9)
│   │   ├── apocalypse.py     # end-of-world detection, new continent
│   │   ├── events.py         # input events (presence, button, power) and output events
│   │   └── state/
│   │       ├── schema.py     # versioned, serialisable state
│   │       ├── io.py         # save/load (compressed), atomic writes handled by caller
│   │       └── migrations/   # vN_to_vN+1.py, one file per bump, never edited after release
│   ├── config/default.toml   # every tunable lives here, documented inline
│   └── tests/                # fauna_site.py: hand-built site shared by fauna scenario tests
├── tools/                    # dev-only CLIs (not deployed)
│   ├── fastforward.py        # run N sim-years headless for M seeds → runs/<id>/
│   ├── tune/                 # M11: score a run on every criterion, sweep levers
│   │                         #   (sweeps/<name>.toml → runs/sweep-<name>/), sensitivity
│   ├── report.py             # build a milestone report from runs → reports/<milestone>/
│   ├── runs.py               # on-disk format of runs/<id>/
│   ├── milestones/           # per-milestone metrics, acceptance criteria, report sections
│   ├── viz/                  # shared plotting style + figure helpers
│   ├── replay.py             # load a save, inspect, render stills and renderer fixtures
│   ├── stream.py             # record the state stream from a save, for the renderer (R1),
│                             #   through the server's feed (S1)
│   ├── server_watch.py       # sample a running server's /status, judge it against §4.8 (S1)
│   ├── kiosk_bench.py        # benchmark a renderer page in Chromium kiosk on the device (R0);
│   │                         #   standard library only: copied to the board as one file
│   └── showcase.py           # run the showcase on the board and sum up how it ran (R6);
│                             #   standard library and kiosk_bench.py, copied beside it
├── renderer/                 # TypeScript + PixiJS (WebGL). One renderer for desk and phone.
│   ├── src/                  # terrain/, plants/, creatures/, camera.ts, captions.ts, protocol.ts
│   │   │                     #   (generated), stream.ts, landscape.ts, looks.ts, director.ts (R3:
│   │   │                     #   the view button's camera), herd.ts (the stream's animals),
│   │   │                     #   pixelfont.ts (the captions' font), atmosphere/ (R4: light,
│   │   │                     #   glow, weather of events, the apocalypse sequence; R5:
│   │   │                     #   `ambient.ts`, fireflies, gulls, dust), plants/ (R5: `wind.ts`,
│   │   │                     #   `pieces.ts`), creatures/ (R5: the creature layer `layer.ts`,
│   │   │                     #   its atlas, `habitat.ts`, `views.ts`, colours from the genes,
│   │   │                     #   the map's dots, wading, remains, portraits, eating, hunting,
│   │   │                     #   nursery, sleep), card.ts (the name card),
│   │   │                     #   marker.ts (a chronicle entry's place), bench.ts and
│   │   │                     #   benchplan.ts (R5: the scene's benchmark), framecap.ts (the
│   │   │                     #   30 fps cap), gpu.ts, framestats.ts, showcase/ (R6: the
│   │   │                     #   showcase's script, director, captions and frame meter),
│   │   │                     #   terrain/groundcache.ts (R5: painted ground kept between visits),
│   │   │                     #   plants/standing.ts + standing.worker.ts and plants/artcache.ts
│   │   │                     #   (R5: plant sheets drawn in a worker, kept between loads),
│   │   │                     #   iris.ts (R5: the live iris and loading ring between views),
│   │   │                     #   mods/ (ADR 0024: the mod protocol, registry and menu `M`;
│   │   │                     #   builtin/dashboard-buttons.ts, the key bar as the first mod)
│   │   ├── sheets/           # look sheets of the real scene (land.html, R1)
│   │   └── spike/            # R0 spike: the scene, its in-page benchmark (spike.html),
│   │                         #   the look sheet (look.html) and the creature sheet (R2);
│   │                         #   the real scene no longer imports from it (R5)
│   ├── scripts/              # look-report.mjs: write the look or creature sheet to reports/;
│   │                         #   atmosphere-report.mjs (+ apng.mjs): the R4 report;
│   │                         #   final-report.mjs: the R5 report (before and after);
│   │                         #   slow-bench.mjs: the scene's benchmark on a PC at about the
│   │                         #   board's speed; board-trace.mjs, compare-films.mjs
│   ├── public/spike/         # the world the spike draws; generated by tools/replay.py
│   ├── public/stream/        # recorded state streams the scene plays (autumn, winter, life: with
│   │                         #   creatures, R3; office, end: light and a world's end, R4);
│   │                         #   tools/stream.py
│   └── tests/                # vitest unit tests + Playwright visual snapshots
├── server/                   # Python package `lineage_server` — runs on the device
│   ├── config/server.toml    # the server's settings (port, polling, saves kept), S1
│   └── lineage_server/       # main.py (the command), island.py (the world in real time, its
│                             #   saves), server.py (WebSocket /stream, pages, /status), feed.py
│                             #   (which messages a step makes), store.py (saves on disk),
│                             #   settings.py (S1); later api.py, notify.py, journal.py;
│                             #   protocol/ (schema.json: the wire format; encode.py);
│                             #   desktop.py (the desktop app), launcher.py and
│                             #   assets/launcher.html (its launcher: world, pace, mods)
├── device/                   # Python package `lineage_device` — the ONLY code touching GPIO
│   └── lineage_device/       # interface.py (what the server gets, S1), fake.py (S1's minimal
│                             #   fake; S2 completes it), presence.py, button.py, led.py,
│                             #   backlight.py, power.py
├── app/                      # phone PWA shell, reuses renderer/
├── journal/                  # static site templates
├── deploy/                   # os notes, systemd units (lineage-r0@, lineage-r5@: the board
│                             #   benchmarks; lineage-server@: the island, lineage-s1-kiosk@
│                             #   and s1-board.sh: S1's board session), setup.sh,
│                             #   kiosk, backups, tailscale; terrarium-kiosk.sh and the
│                             #   lineage-terrarium-* units: the screensaver on any Linux
│                             #   machine (ADR 0025)
├── mockups/                  # HTML mockups and enclosure concepts (reference only)
├── reports/                  # committed milestone reports (HTML + metrics.json), see §7
├── runs/                     # gitignored raw fast-forward output
├── hardware/                 # LATER: bom/, electrical/, cad/ (see §10)
└── .github/workflows/        # ci.yml (fast), nightly.yml (long runs), journal.yml
```

Do not create directories outside this layout without updating this file.

## 4. Architecture rules (non-negotiable)

1. **The simulation is pure.** `lineage_sim` never reads the wall clock, filesystem,
   network, environment, or GPIO. Time advances only through `World.step(dt)`; the real world
   reaches it only as events (`PresenceChanged`, `GodPower`, `PowerLost`…) via
   `World.apply(event)`. Outputs are returned (`ChronicleEntry`, `SpeciesBorn`…), not
   pushed anywhere.
2. **Determinism.** Same seed + same config + same event sequence ⇒ bit-identical state.
   Every random draw comes from `rng.py` streams (one stream per subsystem, so adding draws
   in fauna does not change terrain). No `random`, no `np.random` global state, no
   iteration over sets/dicts whose order can vary, no time-based seeds.
3. **One time model.** Sim time is seconds since world creation, mapped 1:1 to wall time on
   the device. Fast-forward runs the same code with large `dt`/many steps. Subsystems run
   on their own schedules (see `config/default.toml` `[schedule]`): creatures at a
   behaviour rate, flora and terrain on coarse ticks. Never hard-code a schedule elsewhere.
4. **Saves outlive code.** The world will run for years while the code changes.
   - State carries `schema_version`. Any change to persisted fields bumps it and adds a
     migration in `state/migrations/`.
   - Every migration has a test that loads a frozen fixture save from the previous version
     (`sim/tests/fixtures/saves/vN.lzma`) and checks invariants after upgrading.
   - Never delete or edit a released migration or fixture.
5. **Tunables live in config.** Rates, thresholds and probabilities go in
   `config/default.toml` with a comment giving units and intent. Code reads them through
   the typed `config.py`. Magic numbers in sim code are a review blocker.
6. **Hardware isolation.** Only `lineage_device` touches GPIO. It exposes the same
   interface as `lineage_device.fake`, which maps keyboard keys / a small web panel to
   presence, button and power events, so everything runs on a PC.
7. **One renderer.** The desk kiosk and the phone draw the same scene from the same state
   stream. The wire format is defined once (`server/.../protocol` JSON schema) and the
   TypeScript types are generated from it. If the on-device graphics spike (R0) fails, a
   native renderer may be added beside `renderer/`, consuming the same protocol.
8. **Performance budget on the device.** Sim ≤ 25% of one core on average; renderer ≥ 30 fps
   at 1024×600; daily save ≤ 2 s; RAM for sim + server ≤ 300 MB. Benchmarks guard these.

## 5. Tooling and conventions

- **Python** 3.11 (the project's, on the board too through `uv`). Managed with `uv`; one workspace with `sim`,
  `server`, `device`, `tools` as members.
- **Numerics**: NumPy, vectorised over grids and populations. No per-cell Python loops in
  hot paths (flora/terrain); creatures may loop in Python only if the benchmark allows it.
  Numba or a small C extension only after an ADR.
- **Lint/format/type**: `ruff check`, `ruff format`, `pyright --strict` on `sim/`.
- **TypeScript**: strict mode, Vite, PixiJS, vitest, Playwright; `eslint` + `prettier`.
- **Commands** (keep this list accurate):
  - `uv sync` — install the workspace (Python 3.11, all members, dev tools)
  - `uv run ruff check . && uv run ruff format --check . && uv run pyright` — lint/format/types
  - `uv run pytest -m "not slow"` — fast suite (CI on every push)
  - `uv run pytest -m slow` — long statistical tests (nightly)
  - `uv run pytest -m criteria` — M11's nightly check: the tuned island, 3 years × 20
    seeds, judged on every criterion at once (`tools/tests/test_m11_criteria.py`; its own
    nightly job; about 8 minutes on 20 cores)
  - `uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>`
    (`--save-days 30` for long statistical runs; `--power-cut-day N` to test resume;
    `--set fauna.learning=false` to change one config key for an ablation;
    `--fork-days 60 --fork-length 28` to fork every 60 days with learning on and off, M5;
    `--schedule office` to play the owner's presence: `always`, `office`, `office-august`,
    `conference`, M8; worlds that end go to `runs/<id>/archives/<seed>/`, M10;
    `--press-every-days 7` presses the god-power button weekly at the desk, M11)
  - `uv run python -m tools.report <milestone> --runs runs/<id>`
    (`--baseline runs/<id>` for ablation reports, M5: the run with the mechanism off;
    M8 takes the office run and `--baseline` once per other schedule; M11 takes the tuned
    office run and, as `--baseline`, the held-out, 5-year, 10-year ("what to expect over
    the years"), fork, learning-off, schedule and mechanism-off runs, each recognised by its
    manifest, plus `--sweep runs/sweep-<name>`)
  - `uv run python -m tools.tune.sweep tools/tune/sweeps/<name>.toml --jobs 10 --max-load 14`
    — run and score a sweep (M11; resumes where it stopped; `--dry-run` lists the points),
    then `uv run python -m tools.tune.sensitivity runs/sweep-<name>` (which levers move
    which criteria)
  - `uv run python -m tools.replay <save.lzma> [--still out.png] [--renderer-fixture DIR]`
    — inspect a save; `--renderer-fixture renderer/public/spike` regenerates the spike's world
  - `uv run python -m tools.stream <save.lzma> --out renderer/public/stream/recording.json
    --days 56 --land-every 28` — record the state stream the scene plays (`--creatures`
    adds creatures; `--skip-days 165 --days 21 --land-every 10 --out .../winter.json`
    writes the winter recording; `sim/tests/fixtures/saves/v9.lzma --out .../life.json
    --days 28 --land-every 14 --creatures --creatures-every 7200` the creatures' one, R3;
    `--sky-every 600 --schedule office` adds the light and events, `--press-days 2,6,13`
    presses the god-power button, `--famine-day 2` starves the herd so the world ends:
    `v9.lzma --out .../office.json --days 14 --land-every 7 --creatures --creatures-every
    7200 --sky-every 600 --schedule office --press-days 2,6,13` and `.../end.json --days 3
    --land-every 3 --creatures --creatures-every 7200 --sky-every 600 --schedule office
    --famine-day 2`, R4; `--stage DAY:HOUR:WHAT[@X,Y]` stages a fire, a rain kind
    (`shower`, `thunder`, `storm`) or an overcast (`cloud`), a volcano, a quake or a god
    power by name, as the report's streams do)
  - `uv run python -m lineage_server.main --data DIR --dist renderer/dist-kiosk --fake-device`
    — run the island in real time (S1): the newest save under `DIR/saves` (or a new world,
    `--seed N`), the time it was off caught up, the kiosk at `http://localhost:8080/`, the
    stream at `/stream`, its numbers at `/status`; keys on stdin play the device (`p`
    presence, `g` god power, `v` view, `l`/`r` power lost/restored); Ctrl+C saves and stops
  - `deploy/terrarium-kiosk.sh [--data DIR] [--config FILE] [--port N] [--build]` — Lineage:
    Terrarium as a screensaver on a Linux machine: the server headless with
    `sim/config/terrarium.toml` (the real solar cycle) and Chromium in kiosk mode
    (`docs/terrarium-kiosk.md`, ADR 0025); `Lineage-Terrarium.cmd` opens the desktop app on
    Windows
  - `uv run python -m lineage_server.launcher [--browser]` — the desktop app's launcher: a
    world under `data/`, the pace (fast-life x90 or real time x1), the user mods of `mods/`
    on or off, then Launch; a pywebview window, or the browser without pywebview
    (`Lineage-Launcher.cmd` on Windows, `deploy/terrarium-launcher.sh` on Linux)
  - `deploy/s1-board.sh setup|start|status|stop lineage@<board>` — the server and the kiosk
    on the board (procedure in `deploy/README.md`), then `uv run python -m
    tools.server_watch http://<board>:8080 --minutes 180 --out runs/s1-board/status.jsonl`
    — its numbers against the budgets of §4.8
  - `uv run python -m tools.viz.pixelmap` — write the renderer's copy of the palette
    (`renderer/src/terrain/palette.json`)
  - `cd renderer && npm run protocol` — regenerate `src/protocol.ts` from the wire schema
  - `cd renderer && npm run build` — build the pages into `renderer/dist`
  - `cd renderer && npm run look` — write the look sheet (how terrain, plants and creatures
    are drawn) to `reports/R0-look-sheet/`; live at `/look.html` under `npm run dev`
  - `cd renderer && npm run land` — write the land sheet (R1: ground and plants in the
    cosy look) to `reports/R1-land-sheet/`; live at `/land.html`
  - `cd renderer && npm run atmosphere` — write the R4 report to `reports/R4-atmosphere/`:
    it records streams of each event, films every effect in the three views at 1024×600 and
    30 fps (needs `ffmpeg`), and writes `report.html` (committed) and `films/` (gitignored);
    `R4_REPORT_REUSE_STREAMS=1` keeps the recorded streams, `R4_REPORT_REUSE_FILMS=1` the
    films already made, and `R4_REPORT_ONLY=strike,algae,…` films only those scenes while
    the look is tuned (a partial page: commit only a full one)
  - `cd renderer && npm run final` — write the R5 report to `reports/R5-final/`: builds the
    renderer as it is and as it was when R5 began (`R5_REPORT_BEFORE=<commit>` for another),
    films the same places in both at 1024×600 (needs `ffmpeg`) and writes `report.html`
    with stills to compare and the films in `films/` (gitignored, as R4's)
  - `cd renderer && npm run creatures` — write the creature sheet (phenotype port against
    the sim, creature styles side by side) to `reports/R2-creature-sheet/`; live at
    `/creatures.html`
  - `cd renderer && node scripts/compare-films.mjs <url before> <url after> [frames] [scenes]`
    — film moving scenes (fire, bushes, the card, the scroll, the map, rain, snow) from two
    servings of the page (the commit before a change in a `git worktree`, `npx vite --port
    5392`) and compare them frame by frame: a change that claims the same pixels must give
    every frame byte for byte the same
  - `cd renderer && node scripts/slow-bench.mjs <scenarios> [throttle=20] [port=5391]` — the
    scene's benchmark on a PC with the page's CPU slowed to about the board's (`npx vite
    --port 5391` first; its workers are not slowed; the ground is kept only by a committed
    build: `npx vite build --mode kiosk` and `npx vite preview`)
  - `cd renderer && npm run build:kiosk` — the desk's build (`vite build --mode kiosk`) into
    `renderer/dist-kiosk/`: the scene alone, demo paths compiled out (`?film`, `?file=`;
    `?show=`/`?recording=` only under `?bench`), the server's stream `ws://<host>/stream` by
    default
  - on the board: `python3 kiosk_bench.py --dist dist-kiosk --fps-cap 30` (the scene's
    benchmark, `index.html?bench`, R5; `--page spike.html --dist dist` for the R0 spike;
    procedure in `deploy/README.md`, from a board in its box `deploy/board-setup.md`), then
    for the spike `uv run python -m tools.report R0 --runs <directory holding kiosk-bench.json>`
  - on the board: `./showcase.sh` (with `lineage-showcase@.service` installed, `deploy/`;
    `showcase.py`, `kiosk_bench.py` and `dist-kiosk/` in `~/lineage-r5/`) — the showcase
    (`index.html?showcase`, R6: a scripted tour of the scene in the desk's build, looping,
    a frame counter top right); Ctrl+C prints frames a second, frames late by act and by
    loop, memory and temperature (also `showcase-summary.txt`)
  - `uv run python -m tools.report R5 --runs runs/r5-device` — R5's device report from the
    `kiosk-bench.json` the scene's benchmark wrote on the board (`python3 kiosk_bench.py
    --dist dist-kiosk --fps-cap 30`, procedure in `deploy/README.md`) → `reports/R5-device/`,
    the evidence file committed in place of `config.toml`
  - `cd renderer && npm test && npx playwright test` (`PLAYWRIGHT_PORT=…` when another
    worktree's tests may run at the same time)
  - `cd renderer && npm run typecheck && npm run lint`
- **Dependencies**: ask before adding any new dependency; record why in the PR/commit.
- **Commits**: small, one concern each, message `area: imperative summary`
  (`flora: add fire spread`). Reference the milestone id (`[M3]`).
- **Docs**: when behaviour changes, update `docs/design/*` in the same commit.
- **Naming in code**: genes are named constants/enums, never bare indices.

## 6. Testing policy

Every code addition ships with tests. A milestone is not done until its tests, its report
(if statistical) and its docs are in.

**Kinds of tests, by layer**

| Kind | Where | What |
|---|---|---|
| Unit | everywhere | pure functions: genome → phenotype, suitability, naming, migrations |
| Property (Hypothesis) | sim | invariants under random inputs: heights in [0,1], energy never negative, populations finite, gene values clamped, save→load→save identical |
| Determinism | sim | golden hash of state after N steps for fixed seeds; two runs equal; independent subsystem streams |
| Scenario | sim | hand-built worlds that must produce a specific outcome (a fire spreads through dry forest and stops at water; a strait closes when uplift exceeds threshold; a chronicle trigger fires exactly once) |
| Statistical | sim (`slow`) | many seeds, many sim-years; assert on distributions with tolerance bands, never on one seed |
| Migration | sim | fixture save of every past schema version loads and passes invariants |
| Benchmark | sim, server | `pytest-benchmark`; fail if > budget (§4.8) on CI reference machine; on-device numbers recorded in reports |
| Visual | renderer | Playwright screenshots of fixed states (seeded) compared to baselines |
| Integration | server, device | sim ↔ server ↔ fake device end to end; power-loss → save → restart resumes identical state |
| Soak | device | multi-day run on hardware; memory, CPU, temperature, saves |

**Rules**
- Fix the seed in every test. Statistical tests use ≥ 20 seeds and report the spread.
- A failing statistical test is investigated, never "re-run until green". If tolerance
  bands change, the report must show why.
- Golden hashes change only with an explanation in the commit message.
- Tests must not depend on wall-clock time or network.

## 7. Milestone reports (visualisation and artifacts)

Any milestone that involves statistical behaviour (terrain dynamics, succession, evolution,
learning, tuning) must produce a report:

```
reports/<MID>-<slug>/
├── report.html      # self-contained: figures inline, readable without the repo
├── metrics.json     # every number the acceptance criteria check, plus seeds and config hash
├── config.toml      # exact config used
└── README.md        # 10-line summary: what was run, PASS/FAIL per criterion, notes
```

Report content standard:
- **Header**: milestone, git commit, config hash, seeds, sim-years, wall time.
- **Acceptance table**: each criterion from §8, measured value, target band, PASS/FAIL.
- **Time series** with the median across seeds and a 10–90% band, never a single seed alone.
- **Distributions** (histograms/violin) for per-seed outcomes (e.g. time to first forest).
- **Spatial snapshots**: map grids at fixed sim-times for 2–3 representative seeds
  (and one worst-case seed), plus an animated GIF/WebP where change over time matters.
- **Comparison/ablation** plots when the milestone introduces a mechanism (on vs off).
- Shared plotting style from `tools/viz/style.py`: consistent colours per land-cover class,
  per species, per event type; axes labelled with units; one axis per chart.

Raw runs go to `runs/` (gitignored). Only the report directory is committed. Reports are
regenerated, never hand-edited.

A milestone measured on the device (R0) has no fast-forward run: its report is built from
the file the device benchmark wrote, and that file is committed in the report directory
in place of `config.toml`, because a PC cannot regenerate it.

## 8. Milestones

Tracks run partly in parallel: **M** = simulation, **R** = renderer, **S** = server/device/
deploy. Each milestone lists deliverables, tests and acceptance criteria. Targets in
`[brackets]` are initial bands to be refined by the milestone's own report; changing them
needs a note in `docs/decisions/`.

### M0 — Repository and tooling
- **Deliver**: layout from §3 with package skeletons, `uv` workspace, ruff/pyright, pytest +
  hypothesis + pytest-benchmark, vitest + Playwright skeleton, CI workflow (fast suite),
  nightly workflow (slow suite), `tools/viz/style.py`, report scaffolding (`tools/report.py`
  producing an empty report with header), `docs/design/` populated from the design notes.
- **Tests**: CI green on an empty-but-real test per package; report tool produces a valid
  HTML for a dummy run.
- **Done when**: `uv run pytest`, `npm test`, and a dummy report all run from a fresh clone.

### M1 — Core: clock, RNG, world loop, state, saves, migrations
- **Deliver**: `clock.py` (calendar, seasons, day/week from injected time), `rng.py`
  (named streams), `world.py` (step/apply/outputs), state schema v1, compressed save/load,
  migration framework with a toy v0→v1 migration and fixture.
- **Tests**: determinism (two runs same hash; reordering unrelated subsystems keeps
  streams independent), save→load→continue equals uninterrupted run, migration fixture,
  property tests on clock (season boundaries, leap years, DST irrelevant because UTC
  internally), benchmark of empty step.
- **Done when**: a 3-sim-year empty world fast-forwards, saves daily, survives a simulated
  power cut mid-run and resumes bit-identical.

### M2 — Terrain generation and dynamics
- **Deliver**: island generation (noise + falloff), fertility layer, sea-level cycle,
  moving uplift/subsidence, erosion (vegetation-aware hook), events: volcano, earthquake,
  crater; landmass counting.
- **Tests**: properties (bounds, no NaN, mass roughly conserved by erosion), scenario
  (volcano creates new land at the right place; strait closes under uplift), determinism.
- **Report** (20 seeds × 10 sim-years): land fraction, sea level, landmass count over time;
  coastline change per year; snapshot grid + GIF; event frequency.
- **Accept**: land fraction stays in `[0.25, 0.6]`; ≥ 1 split/rejoin per 3 years in
  `[≥ 50%]` of seeds; no seed loses all land; terrain step within budget (retired in
  M11, ADR 0019: M4.4 budgets the whole world, 600 ms per sim-day on the PC).

### M3 — Flora
- **Deliver**: vegetation grid, 8-gene plant genome, growth/suitability, dispersal (wind,
  fruit), shading succession, soil building, grazing hook, fire (spread, fire-pine
  survival), winter dieback, plant rare genes, erosion feedback.
- **Tests**: unit (suitability, form classification), scenario (fire stops at water; trees
  cannot establish on infertile soil; flooded cells die), properties, determinism,
  benchmark (full grid step).
- **Report** (20 seeds × 5 sim-years from bare rock): land-cover stacked area (median +
  band), time to first shrubland / first forest (distributions), plant species count,
  soil fertility, fire sizes (log histogram), map snapshots per season and per year.
- **Accept**: grass covers ≥ 50% of land within `[3–9 sim-months]`; first closed forest
  within `[12–24 sim-months]`; ≥ 4 distinct plant forms coexist at year 3 in ≥ 80% of
  seeds; no seed ends at 100% one class.

### M4 — Fauna I: genome, body, energy, reproduction, evolution
- **Deliver**: creature genome (body genes + rare slots), phenotype function (shared spec
  with renderer), movement on terrain, metabolism, eating plants/meat, sexual reproduction
  with mate compatibility, mutation, asexual fallback, population cap; brains are evolved
  only (no lifetime learning yet).
- **Tests**: phenotype unit tests (trade-offs hold: bigger ⇒ costlier), energy
  conservation bounds, scenario (starving creature dies; compatible pair breeds;
  incompatible pair does not), properties, determinism, benchmark at 150 creatures.
- **Report** (20 seeds × 3 sim-years): population, births/deaths, trait means and
  distributions over time (size, diet, limbs, speed, armour), habitat occupancy,
  extinction events.
- **Accept**: total extinction in `[< 20%]` of seed-years; trait distributions drift
  measurably from ancestors (mean genetic distance rising); both herbivores and predators
  present during year 3 in `[≥ 60%]` of seeds (mean over the final year, not one day:
  predator packs boom and bust within months; ADR 0009).

### M5 — Fauna II: lifetime learning
- **Deliver**: reward-modulated policy update with eligibility traces and exploration
  noise; learning-rate and exploration genes; "time to competence" metric. (As built,
  ADR 0009: learning from meals, diet traditions, plant-form senses, scavenging.)
- **Tests**: unit (update rule on a toy bandit improves reward), scenario (a single
  creature in a food field learns to approach food within N steps), determinism.
- **Report**: ablation learning ON vs OFF (same seeds): survival, mean energy, time to
  competence across generations (Baldwin effect plot), learning-rate gene trajectory.
- **Accept**: learning tracks the local environment: final-year diet fit (learned plant
  preference against local plant defence) positive in `[≥ 80%]` of seeds; step cost within
  budget. Reported without a band: early-life feeding gain (originally `[≥ 15%]`, out of
  reach on a balanced island), time to competence across generations (originally a
  downward trend in `[≥ 60%]` of seeds), and shielding versus genetic assimilation; every
  run shows shielding, the opposite of a Baldwin effect. Revised 2026-10-17 and
  2026-10-18 (ADR 0009).

### M6 — Species, names, phylogeny
- **Deliver**: daily genome clustering with persistent ids, speciation/extinction
  detection, syllable names derived from genome with lineage-aware daughter names,
  phylogeny store.
- **Tests**: clustering stability (small noise does not split species), split detection
  scenario, name determinism and uniqueness, phylogeny is a valid tree.
- **Report**: species count over time, speciation and extinction rates per sim-month,
  rendered phylogenetic tree for 3 seeds, name samples.
- **Accept**: species alive in `[3–16]` for ≥ 90% of sim-time (3–12 until M11, ADR 0019);
  speciation `[≥ 1 / month]` median. (As built, ADR 0012: species are genome clusters, finer than who can mate;
  sim-time is inhabited time, median seed; speciation counts splits only. M6.1 measured
  79 % and was deferred to M11 by the owner, 2026-10-18.)

### M7 — Rare genes (creatures and plants)
- **Deliver**: full rare tables for both kingdoms, appearance and loss rates, effects and
  costs, visual-signature flags for the renderer.
- **Tests**: each rare gene's bonus and cost measurable in a controlled scenario
  (e.g. venom kills larger prey; photosynthesis starves in darkness).
- **Report**: appearance frequency, carrier lifespan and lineage persistence per gene,
  frequency trajectories, which genes dominate under which conditions.
- **Accept**: every rare gene appears in `[≥ 30%]` of 3-year seeds; none reaches fixation
  (> 90% of population) for more than `[3 sim-months]` in `[≥ 90%]` of seeds. (As built,
  ADR 0015: M7.1 95 % PASS; M7.2 85 % FAIL because photosynthesis sweeps herds while
  there is no night, 95 % without it; deferred to M8 by the owner, 2026-10-18.)

### M8 — Presence, calendar, god powers
- **Deliver**: daylight from presence events with hold logic handled upstream, dusk/dawn,
  weekend Long Night, holiday darkness, moonlight floor after N days, seasons from
  calendar, god powers (meteor, rain, seed, ark) with cooldown state.
- **Tests**: synthetic presence schedules; cooldown enforced; scenario (3-week absence
  does not auto-extinguish all life above `[x%]` of seeds).
- **Report**: compare schedules — always present, office hours, office + August break,
  3-week conference — on populations, nocturnal trait frequency, rare-gene frequencies
  (glow, hibernation, photosynthesis).
- **Accept**: office schedule produces measurable selection on light traits (night or
  day; night traits alone until M11, ADR 0019) vs always-present; 3-week absence survival `[≥ 80%]` of seeds; August holiday survival
  `[≥ 80%]` of seeds (added by the owner, 2026-10-19). (As built, ADR 0016: a button, not
  a covered switch, fires a power the island draws by need; holidays are long absences;
  plants follow a week's light. M8.2 and M8.3 100 % PASS; M7.2 95 % PASS in office light;
  M8.1 p = 0.15 FAIL: hibernation takes off in a third of office seeds, glow never pays;
  deferred to M11 by the owner, 2026-10-19; in M11 night traits still never respond, and
  the owner widened M8.1 to light traits: photosynthesis rarer in office light, p = 0.03
  after a Bonferroni correction, PASS.)

### M9 — Chronicle and bestiary
- **Deliver**: event detectors (speciation, extinction, firsts, records, booms/crashes,
  migrations, splits/rejoins, fires, volcanoes, god powers, anniversaries), templated
  text, importance scores, deduplication/rate limiting, bestiary records with portraits'
  genome snapshot.
- **Tests**: each detector fires exactly once on its scenario; no duplicate spam over a
  long run; text templates render for all event types.
- **Report**: sample 3-year chronicle (rendered), entries per month histogram, importance
  distribution.
- **Accept**: `[2–15]` notable entries per sim-month median; no event type > 30% of all
  entries. (As built, ADR 0017: importance 1–5, notable ≥ 3, major ≥ 4 pushed; English
  text; the history lives in the save, schema v9; the World hands outputs to observers.
  M9.1 3.5 per month and M9.2 18.9 % PASS under the office schedule; merged 2026-10-19.)

### M10 — Apocalypse and worlds
- **Deliver**: collapse detection, end-of-world event, new continent with new seed,
  archive of the previous world (chronicle, bestiary, phylogeny, final map), world
  numbering.
- **Tests**: scenario (forced collapse ends world exactly once), archive integrity,
  migrations cover archives.
- **Accept**: archives load and render; new world starts within budget. (As built,
  ADR 0018: once life is established, the last creature's death ends the world (the
  owner, 2026-10-20); the World archives itself (`WorldEnded`, the final save) and starts
  the next at once from a seed drawn by the old one; every archive is kept; schema v10.
  Ending a world and starting the next: 73 ms on the PC; merged 2026-10-20.)

### M11 — Long-run tuning and stability
- **Deliver**: tuned `default.toml`; `tools/tune/` sweeps. Plan and evidence so far:
  `docs/m11-plan.md` (ADR 0011: features first, tuning once here).
- **Tests**: nightly 3-year × 20-seed run with all acceptance criteria from M2–M10.
- **Report**: full dashboard — all prior metrics at 3 sim-years, genetic distance from
  ancestors, sensitivity of key metrics to the top tunables.
- **Accept**: every M2–M10 criterion passes simultaneously; mean genetic distance still
  rising at year 3 (no stagnation). (Done 2026-10-27, ADR 0019: the owner added criteria on
  diversity and balance, D1–D3, bands set after five new mechanisms: food at sea and
  wading, reach by height, cover for prey, nutrients back to the soil, seeds carried by
  grazers; M2.5 retired and the whole-world step budget raised to 600 ms. 2026-10-21, the
  owner: the island is closed, no strangers (hunters land once as a second wave of
  founders, the ark brings them back); M3.5 tolerates a tenth of the seeds in open
  woodland; M6.1 leaves out the founding; the species definition is not tuned; the
  tuned island is checked with a weekly press of the button. 2026-10-22: hunters land by
  the herd and are built a little larger than it; the ark waits until an empty island is
  green enough for founders; every M criterion is judged without presses, press runs
  only for harm; god-power entries stay major. 2026-10-23, the owner: presses cannot be
  relied on for predators; hunters may prey on kin that eat far more plants
  (`prey_diet_gap`), so they can arise from the herd; a gentler diet trade-off brings them
  back but turns herds omnivore. 2026-10-24: the hunting levers do not help. 2026-10-25,
  the owner: soft caps (births wait longer near a cap) and resting hunters
  (`hunter_rest_share`), with `predator_cap` 32: hunters last beside grazers in 15 of 20
  ten-year seeds and every M criterion passes; M6.1's band is now 3–16 species; D1 asks
  9 of 12 body genes with a niche, D2 5 of 14 rare genes thriving; M8.1 judges light
  traits. The report `reports/M11-long-run` (e08aece and after): every criterion passes
  on tuning and held-out seeds; merged into `main` 2026-10-27; the nightly criteria test
  (`pytest -m criteria`) guards it. R5, merging second,
  re-records the stream recordings; the sim's Orange Pi measurement is left to S1/S7; S1 made it, 6.1 s of CPU a sim-day,
  ADR 0023.)

### R0 — Renderer spike on the device (gates R1+)
- **Deliver**: PixiJS scene with 50 animated chain-of-circles creatures, a terrain bitmap,
  plant sprites and a full-screen tint, in Chromium kiosk on the Orange Pi at 1024×600.
- **Measure**: fps (median, 1% low), CPU, GPU driver in use, RAM.
- **Accept**: ≥ 30 fps median in each of the three views and the crowded middle one
  (ADR 0010; the first scene, a sprite in every cell, is measured but not judged).
  Otherwise write an ADR choosing the native fallback. A larger HDMI display may stand
  in for the 7" screen (ADR 0008).

### R1 — Terrain and plants from the state stream
- **Deliver**: protocol types generated from the schema; the ground painted from the
  cells for the three views (ADR 0007), cross-faded when it changes and painted off the
  frame; the plants that stand on it, by form and season. (As built, ADR 0014: in the
  cosy look after Stardew Valley, the report maps' palette too; seasons turn over about
  four weeks; snow from the simulation; `HEIGHT` and `EVERGREEN` in the drawing; a moving
  sea.)
- **Tests**: vitest for plant form mapping; Playwright snapshots of fixed states.

### R2 — Procedural creatures
- **Deliver**: body from genes (spine, limbs, mouth, eyes, armour, patterns, rare
  overlays), procedural animation (chain follow, leg IK, fins). Phenotype spec shared with
  `fauna/phenotype.py`; a cross-language test checks both produce the same derived values
  for a fixture set of genomes. (As built, ADR 0013: in the cosy look after Stardew
  Valley; one body plan per species; life between sim ticks; swimmers seen through the
  water; the torpid curled up. Drawing them in the real scene from the stream is R3's.)
- **Tests**: vitest geometry tests, Playwright snapshots of the 15 specimen genomes.

### R3 — Documentary camera and captions
- **Deliver**: subject selection (interest score), the three views (map, region, one
  animal followed from close by) and the moves between them, wide shots at dawn, captions
  from chronicle entries, Monday recap tour.
- **Tests**: subject selection unit tests; snapshot of caption layout; no caption overlaps.
- (As built, ADR 0020: the owner steers it with a view button, map → middle → local →
  map, back to the map after 15 idle minutes; the middle view drifts over the island, the
  local view follows an animal of a random species for about five minutes, on springs;
  views change by a dip to dark; notable entries on a parchment scroll. Dawn shots and the
  Monday recap dropped by the owner, 2026-10-20.)

### R4 — Atmosphere
- **Deliver**: day/night tint from presence, glow pass, seasons, weather of events,
  apocalypse sequence; waves breaking on the coasts in all three views, the map too
  (added by the owner, 2026-10-20).
- **Tests**: snapshots per lighting state. (Its device benchmark moved to R5.)
- (As built, ADR 0021: moonlit-blue nights, rose dusks and lilac dawns, eased between the
  sim's 10-minute light steps, the day graded by the season; an additive glow pass; rain,
  smoke and flames, volcano ash and lava, quake shake, meteor streak and flash, seed and
  ark light; a three-minute apocalypse on the map (omen, fire, flood, dark, rise) during
  which the button waits; `sky` and `events` messages on the wire. The owner's choices,
  2026-10-20. Round 2, the owner: the island's own weather in the sim (rain spells,
  visual-only thunder, thunderstorms whose lightning alone starts fires), fire kills
  animals in it, schema v12; flame sprites, charred trees, ripples, drawn volcano cones
  and craters, the powers' real effects, algae (M11) drawn. Rounds 3–5, the owner: films
  at the screen's resolution and frame rate; a barren ring round cones and craters;
  overcast spells (seen only); the world greyed under cloud; rain, fire, lava, crater,
  ark, seed and tides reworked; what stands sorted among the plants. Round 6: no pops,
  creatures under new cones and craters die, tides by a shader, falling snow. Round 7:
  one kind of fall per view, the open sea's swell, a larger meteor in the middle view.
  The owner called the look final on 2026-10-21; merged into `main`.)

### R5 — Final rendering pass and device benchmark
- **Deliver**: the look of terrain, plants, creatures and atmosphere tuned together, as one
  pass over R1–R4 (the cosy palette, ADR 0013, is the starting point); the R0 benchmark's
  views rebuilt on the real renderer and the state stream; on-device numbers in a report.
  R1–R4 do not measure on the device; they keep within the PC-side checks and leave the
  board to R5. Added by the owner (2026-10-20, from the R3 demo): animals do not walk
  through bushes and trees; a body never folds through itself when it turns; every legged
  animal steps with its legs in turn (IK), none drags all its legs at once; plants do not
  pop in over animals; and a small scroll by the animal followed in the local view gives
  its species' name and a few of its genes (the phone's follow-a-creature, S3, shows the
  same). The R3 demo's clicks (local view: a click for another animal, a double click for
  the map) come out here: the final build has only the view button's cycle
  (`Director.toMap` stays: R4's apocalypse uses it).
  (In progress, ADR 0022: the owner's answers, 2026-10-21: the known fixes plus tuning
  rounds on creatures and on ground and plants; the board run on the 7" screen; the kiosk
  capped at 30 fps for want of a fan, "≥ 30 fps" read as holding the cap. Rounds 1–4:
  colours from six genes ranked among the living species, no olive; round map dots; a
  calmer ground; grass as small unoutlined tufts after references, nine sizes, random
  tints; snow only from the sim; the young drawn small, `young` on the wire. Later rounds
  to 2026-10-24: plants off the water; animals wading or struggling in the sea, wet feet
  at high tide; legs in turn, no folding; animals round and behind trees and bushes, the
  leaves over them (no fade; bushes in pieces, each piece leaning in the wind, the
  owner's choice); deaths by cause with bones, landings with a splash; a field-guide
  name card with a portrait, an illuminated chronicle scroll lit like a lantern at night,
  chronicle places marked and visited; eating, hunting, births, sleep at night, plants
  in the wind, fireflies, gulls, butterflies and dust; then, drawn only so that M11's
  simulations are unchanged: autumn leaves, animals shaking off the rain and hunching in
  storms, photosynthesisers basking, venom's strike, swimmers' wakes, the young trailing
  their mothers, a pair touching heads before a birth; the scene's benchmark
  (`?bench`, `?cap=30`) and the desk's build (`npm run build:kiosk`). The owner called
  the look final on 2026-10-25; its tests are in (`tests/e2e/final.spec.ts` the stills of
  what R5 drew). Measured on the board 2026-10-27 (`reports/R5-device/`): the four judged
  views hold the 30 fps cap, 4.6 % of the crowd's frames late at most (R5.2's band 5 %),
  582 MB; the draw lists kept from rebuilding every frame, the ground in pieces painted
  by two workers and kept between visits in the browser's storage, the island painted
  ahead after each new day while frames come on time; the middle view's animals posed
  two frames in three (the owner); measured with the plain kiosk, 20 s a scenario, the
  sim-day held, a day's turn reported apart (the owner). `main` (M11) merged in on
  2026-10-27, the streams re-recorded with M11's sim. The showcase the owner asked for
  was begun here and moved to R6 by the owner (2026-10-27); its first version is on
  `r5-final`. Then (2026-10-28) a review of the renderer's per-frame costs and an
  optimization plan (`docs/renderer-performance-review.md`,
  `docs/renderer-optimization-plan.md`, ADR 0022), all the same pixels but one: a frame
  probe in the benchmark naming what late frames held; the card's portrait read back
  without waiting for the GPU; a day without a new land laid out only in a turn of the
  season; the ground's painters faster (a piece's margin as land or sea only, a land's
  cells once), and their colour pass on the GPU (the owner: the same to the eye, not to
  the byte; `?painter=cpu` paints on the CPU). Then (2026-10-29 and 2026-10-30) the
  views' loading, the map "really fast" and each view in about 3 s as the owner's goal:
  the ground's cache answered at once, the map's painting kept, the plants' sheets kept
  between loads and drawn in a worker for the views not shown, the next views' ground
  painted ahead where they will open; the pointer hidden, the dip drawn on the canvas;
  live, an iris with a loading ring between views masks what is left (the owner: "we
  just have to mask the load times"). The last board run (2026-10-30): the four views
  hold the cap, Chromium 735 MB; R5.2 5.1 % late in the local view against 5 %, accepted
  by the owner ("the performances are fine as it is now"); what could be done later is in
  `docs/renderer-optimization-plan.md`. Merged into `main` 2026-10-30. Checklist and
  handoff in `docs/milestones.md`; reports `reports/R5-final/`, `reports/R5-device/`.)
- **Tests**: Playwright snapshots of the final look; the benchmark runs on the board
  (`tools/kiosk_bench.py`, procedure in `deploy/README.md`).
- **Accept**: ≥ 30 fps median in each of the three views and the crowded middle one, as R0
  (ADR 0010), with the final look; Chromium's memory within the board's budget (§4.8).

### R6 — Showcase and trailer
- **Deliver** (added by the owner, 2026-10-27, from R5): a showcase of the whole of Lineage
  "almost like a trailer, with text that describes what is being shown": the concept, close
  ups, effects and animations, in a scripted tour of the real scene in the desk's build
  (`?showcase`, `renderer/src/showcase/`), looping on the board without reloading, as the
  desk would run it, a frame counter in the top-right corner, and a runner
  (`tools/showcase.py`) that prints frames a second, frames late by act and by loop,
  memory and temperature on Ctrl+C; the tour filmed on the PC for the README (a trailer and
  a short teaser), the README's section. The owner judges the trailer's look on the PC
  first, then the showcase is tuned on the board. (Begun in R5: a first version of
  thirteen acts, about three minutes, its runner and the board's unit; ADR 0022.)
- **Tests**: the script's timeline, captions within the screen, the transitions, the frame
  meter; the runner's summary; a still of each act (Playwright).
- **Accept**: the owner's verdict on the trailer; on the board, `[≥ 30 fps median and
  ≤ 10 % frames late in every act]` from the second loop on (bands the owner sets), no
  ground bare at a cut.

### S1 — Server: real-time loop and persistence
- **Deliver**: run the sim in real time, daily atomic saves (write temp → fsync → rename),
  keep last N saves, WebSocket state stream, recovery on start.
- **Tests**: integration with fake device; kill -9 during save leaves a loadable save.
- (As built, ADR 0023: one process and port for the kiosk's pages, `/stream` and
  `/status`; the time the device was off is caught up on start with the owner away, a
  save at each midnight on the way and one at the end (the owner, 2026-10-28); saves kept:
  the newest of each of the last 7 days and the oldest of each month, archives forever; a
  save on shutdown, on power loss and at a world's end; creatures streamed at each fauna
  tick; the view button sent to the desk only, as a `view` message; a minimal fake device,
  S2 completes it; `tools/stream.py` records through the server's feed. On the board,
  2026-10-29: the sim 0.1 % of a core with the kiosk drawing, 6.1 s CPU a sim-day, saves
  1.2–1.6 s, 89 MB: every budget of §4.8 met. The save had the least margin, so saves use
  xz preset 0 since (the owner, 2026-10-30): as small, 2.3× faster, 3 MB of memory
  instead of 35; on the board 0.88 s with the kiosk drawing (1.61 s before). Merged into `main` 2026-10-30, after R5.)

### S2 — Device layer
- **Deliver**: PIR with configurable hold, god-power and view buttons with debounce, LED, backlight
  sleep/dim, mains-loss detection → save → clean shutdown, `fake.py` parity.
- **Tests**: unit with mocked GPIO; fake ↔ real interface conformance test.

### S3 — Phone app and API
- **Deliver**: read-only API (chronicle, bestiary, stats, phylogeny), PWA reusing the
  renderer, follow-a-creature (with R5's name scroll).
- **Tests**: API contract tests; Playwright mobile viewport snapshots.

### S4 — Notifications
- **Deliver**: ntfy/Telegram adapter for major events, rate limited, quiet hours.
- **Tests**: adapter mocked; rate limit scenario.

### S5 — Public journal
- **Deliver**: daily static site (chronicle, creature of the day, map, archive of worlds),
  publish to GitHub Pages; doubles as off-device backup of the save.
- **Tests**: site builds from fixture state; links valid.

### S6 — Deployment
- **Deliver**: `deploy/setup.sh` for a fresh SD card, systemd units, kiosk, display
  timings, Tailscale notes, log rotation, SD-wear settings.
- **Tests**: shellcheck; dry-run in a Debian container.

### S7 — Soak test
- **Deliver**: 7-day run on the device with telemetry.
- **Report**: CPU, RAM, temperature, fps, save durations, any restarts.
- **Accept**: no leak trend, no crashes, all budgets in §4.8 met.

**Suggested order**: M0 → M1 → R0 (as soon as hardware is on the desk) → M2 → M3 → M4 →
M5 → M6 → M7 → M8 → M9 → M10 → M11, with R1–R4 following M3/M4, R5 once R1–R4 are in,
and S1–S7 after M8; R6 after R5.

## 9. How to work on a milestone (for Claude)

1. Read the milestone in §8, the related `docs/design/` page, and in
   `docs/milestones.md` the milestone's "Starting" brief and "Working on a milestone
   here" (adding a subsystem or schema version, report wiring, pitfalls). If the spec is
   ambiguous, ask before coding; propose the interpretation.
2. Write a short plan in the PR/commit description: files touched, new config keys, schema
   changes (and the migration), tests to add.
3. Implement in small commits. Tests come with the code, not after.
4. Run the fast suite. For statistical milestones, run the fast-forward and build the
   report (§7); read the plots yourself before claiming success and describe what they
   show, including anything surprising.
5. Update `docs/milestones.md` status, `docs/design/*`, and this file if commands or
   layout changed.
6. Never claim a criterion passes without the number from `metrics.json`.

## 10. Hardware (later)

Not in scope yet. When it starts:
- `hardware/cad/` — **SolidWorks** native files (`.SLDPRT`, `.SLDASM`, `.SLDDRW`) tracked
  with **Git LFS**; every release also exports `step/` and print-ready `stl/` so the design
  is usable without SolidWorks. Measured part dimensions recorded in
  `hardware/cad/params.md` (single source of truth).
- `hardware/electrical/` — schematic, `pinout.yaml` (the only place GPIO numbers are
  defined; `lineage_device` reads it), power budget.
- `hardware/bom/bom.csv` — part, qty, source, price, link, owned.
Add `.gitattributes` LFS rules before the first CAD commit.
