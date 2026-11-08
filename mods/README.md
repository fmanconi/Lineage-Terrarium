# User mods

Mods dropped here are found by the server at run time, with no rebuild of the renderer.
The built-in mods live in `renderer/src/mods/builtin/` (ADR 0024); these are the user's.

```
mods/
├── client/<id>/      # renderer mods: mod.json + an ES module, loaded by the scene
└── sim/<id>/         # simulation mods: listed only, never run (see below)
```

## How they reach the scene

- `GET /api/mods` lists every folder under `client/` and `sim/` that holds a valid
  `mod.json`, with its metadata, its `kind` (`client` or `sim`) and, for client mods, the
  URL of its entry (`/user-mods/<id>/<entry>`).
- `/user-mods/<id>/<file>` serves the files of `client/<id>/` only. The id must be lower
  case letters, digits, `-` and `_`; a path that leaves the mod's folder is a 404.
- After the built-in mods, the renderer (`renderer/src/mods/loader.ts`) imports each
  client mod's entry and registers it. From then on it is a mod like the others: on and
  off from the mod menu (`M`), its state kept in local storage.

The server finds this folder at the repository's root; `--mods DIR` points it elsewhere.

## `mod.json`

```json
{
  "id": "sample-banner",
  "name": "Sample Banner",
  "version": "1.0.0",
  "description": "What it does, in a line or two (the menu shows four).",
  "author": "optional",
  "defaultEnabled": false,
  "entry": "index.js",
  "enabled": true
}
```

- `id` must equal the folder's name and never change once released (it keys the saved
  on/off state).
- `entry` is the ES module the renderer imports (default `index.js`).
- `enabled: false` keeps the mod out of the scene entirely (not even in the menu).

## The entry module

Its default export is a class (or a function returning an object) conforming to `Mod` in
`renderer/src/mods/types.ts`: `meta`, `init(ctx)`, `enable()`, `disable()`, `isEnabled()`,
and optionally `update`, `onKey`, `onPointer`. `meta.id` must match `mod.json`.
`client/sample-banner/` is a working example.

## Simulation mods

`sim/` is listed by `/api/mods` but nothing in it is ever run. The simulation is pure and
deterministic (CLAUDE.md §4.1–4.2): code loaded at run time would change saves that must
outlive it. How sim mods could work is an open question for an ADR.
