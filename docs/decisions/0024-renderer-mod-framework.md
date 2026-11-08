# 0024 — Renderer Mod Framework and Key Bar Mod

- **Status**: accepted
- **Date**: 2026-11-08

## Context

Lineage has accumulated several visual and interactive enhancements (a pixel-art Field Guide, interactive bottom-right KeyBar hints, night dimming veil, snapshot, fullscreen, and PiP controls). In vanilla Lineage, the screen is an unadorned, sacred living island running 24/7. Adding UI widgets directly into `main.ts` risks bloat and deprives users of the choice between pure idle immersion and interactive desk gadgetry.

Furthermore, future features and community enhancements should be modular, self-contained, and easily enabled or disabled without editing core source code or affecting the pure deterministic simulation in `sim/`.

## Decision

1. **Client-side Mod Framework in `renderer/src/mods/`**:
   - The simulation engine (`sim/`) remains pure, deterministic, and untouched (ADR 0001).
   - Mods live strictly in the client renderer (`renderer/src/mods/`).
   - Every mod implements a lightweight `Mod` interface with metadata, lifecycle hooks (`init`, `enable`, `disable`), optional update ticks, and optional event handlers (`onKey`, `onPointer`).

2. **Pixel-Art In-Game Mod Menu (`renderer/src/mods/menu.ts`)**:
   - A modal dialog rendered in crisp pixel-art aesthetics (wooden bevel, cream parchment, bitmap font) centered on screen.
   - Allows users to inspect registered mods and toggle them `[ON]` / `[OFF]` in real time.
   - Mod states are persisted in browser/desktop local storage (`lineage_mods_state_v1`).
   - Universal hotkey `[M]` toggles the menu at any time.

3. **First Mod: "Key Bar" (`renderer/src/mods/builtin/dashboard-buttons.ts`)**:
   - Encapsulates `keybar.ts` (the bottom-right interactive hints and button bar).
   - Enabled by default for new users.
   - When enabled: renders the keybar, exposes interactive clickable buttons (`View`, `Guide`, `Miracle`, `Full`, `PiP`, `Night`, and a new `[Mods]` button to open the mod menu), and processes pointer clicks.
   - When disabled: completely hides `keybar` and ignores pointer hits on the dashboard area, restoring the 100% pure vanilla island view.

4. **Hotkey Disambiguation**:
   - `Tab`: Opens/closes the Naturalist's Field Guide.
   - `M`: Opens/closes the Mod Menu (also accessible by clicking `[Mods]` on the KeyBar when active).

## Consequences

- Core rendering and simulation stay decoupled from UI extensions.
- Users can switch between a rich interactive desktop app and a minimal screensaver with a single keystroke.
- Future mods (such as Night Dimmer Veil or Field Guide extraction) follow a clean, established plugin protocol.
