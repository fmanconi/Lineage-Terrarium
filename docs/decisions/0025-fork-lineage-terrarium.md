# 0025 — Fork as Lineage: Terrarium

- **Status**: accepted
- **Date**: 2026-11-08

## Context

Lineage is the work of **Michele Lisi** (<https://github.com/mlisi1/Lineage>), released under
the Apache License 2.0. This repository began as a home adaptation of it: a continuous
biological screensaver for one Linux mini-PC at home (the real solar cycle, headless server,
Chromium kiosk), then grew a standalone desktop app (fast-life mode, PiP, fullscreen,
snapshots), the Naturalist's Field Guide and a client-side mod framework (ADR 0024).

On 2026-11-08 the upstream author agreed to an independent fork: *"Comunque ti direi, fai
un fork della repo e te la tieni così"* ("go ahead and fork the repo and keep it like
this"). The adaptation was named after the one machine it ran on, a name that says nothing
to anyone else who would run the project.

## Decision

1. **Name.** The fork is called **Lineage: Terrarium**, an idle evolution simulator and
   desktop biome companion. The repository is `fmanconi/Lineage-Terrarium`.
2. **License and credit.** The Apache License 2.0 and the original copyright stay as they
   are. Michele Lisi is credited up front in `README.md` and in the documentation as the
   author of the original Lineage engine.
3. **What is renamed.** What a user sees or runs: window and page titles, screen texts, the
   renderer's settings type (`TerrariumSettings`) and storage key
   (`lineage_terrarium_settings_v1`, read with a fallback to the earlier key so saved
   preferences survive), the docs, the launcher (`Lineage-Terrarium.cmd`), the deploy
   scripts, and the mods' names in the mod menu (their ids stay, ADR 0024).
4. **What is not renamed.** The Python packages (`lineage_sim`, `lineage_server`,
   `lineage_device`), the save schema, migrations, fixtures and every internal key. Saves
   must outlive code (CLAUDE.md §4.4), and renaming packages would touch every import and
   test for no user-visible gain.
5. **Deploy for anyone.** The home scripts are generalised: `deploy/terrarium-kiosk.sh`,
   `deploy/terrarium-update.sh`, the `deploy/lineage-terrarium-*` units and
   `sim/config/terrarium.toml` run Lineage: Terrarium as a 24/7 screensaver on any
   Debian/Ubuntu/Raspberry Pi mini-PC (`docs/terrarium-kiosk.md`). The first machine's own
   units and config stay in the repository only until it is moved over to these.
6. **Modularity.** New client features go in as mods (ADR 0024); the simulation stays pure
   and deterministic (CLAUDE.md §4.1–4.2). The desktop app and the kiosk are both supported.
7. **What is published.** Working notes between the people and agents on the project
   (`HANDOFF*.md`) and machine-specific guides (`privato/`) stay on disk and out of git.

## Consequences

- Browsers that stored the old settings key keep their preferences; they are written back
  under the new key on the next change.
- GitHub redirects the repository's old address, so clones that still point there keep
  pulling. The `Documentation=` links and the clone commands use the new name.
- The Windows viewer (`deploy/windows-sync.ps1`) finds a server named other than
  `terrarium` through `LINEAGE_TERRARIUM_HOSTS`, not through names written in the script.
