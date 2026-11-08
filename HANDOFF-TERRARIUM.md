# HANDOFF — Rebranding e Pulizia per Lineage: Terrarium

## 1. Obiettivo e Contesto Upstream

In data 08/11/2026 l'autore originale di Lineage, **Michele Lisi**, ha confermato la direzione per un fork indipendente:
> *"Comunque ti direi, fai un fork della repo e te la tieni così"*

Il fork assume ufficialmente il nome **Lineage: Terrarium** (idle evolution simulator & desktop biome companion).
Come richiesto dalla licenza Apache 2.0, l'attribuzione a Michele Lisi rimane in primo piano in `LICENSE`, `README.md` e nella documentazione.

---

## 2. Decisioni sull'Ambito (Scope)

1. **Pacchetti Python e logica interna non si rinominano**:
   - `lineage_sim`, `lineage_server`, chiavi interne di migrazione e fixture restano intatte. Questo preserva la compatibilità, evita refactoring invasivi e mantiene la piena integrità di test e salvataggi.
2. **Rebranding pulito a livello di UI, Settings, Docs e Launcher**:
   - Tutto ciò che l'utente vede o usa (titoli finestre, impostazioni locali, taccuino, documentazione, launcher) passa a "Terrarium".
   - `SmerdinoSettings` diventa `TerrariumSettings` con un alias di tipo retrocompatibile.
   - La chiave storage diventa `lineage_terrarium_settings_v1` (con fallback su `lineage_smerdino_settings_v1`).
3. **Generalizzazione degli script di deploy**:
   - Gli script casalinghi specifici per il mini-PC "smerdino" vengono generalizzati in strumenti di deploy pronti per chiunque voglia eseguire Lineage: Terrarium come screensaver continuo / kiosk su Linux.
4. **GitHub**:
   - La gestione remota di GitHub verrà eseguita in un secondo momento con Federico; per ora lavoriamo esclusivamente sul branch locale `gemini/clean-terrarium`.

---

## 3. File da modificare e creare

### A. Decisione architetturale
- **Crea `docs/decisions/0025-fork-lineage-terrarium.md`**:
  - Status: accepted
  - Context: decisione concordata con Michele Lisi per fork autonomo con Modding Framework e desktop companion.
  - Decision: adozione del nome "Lineage: Terrarium", mantenimento di licenza e copyright originari, modularità client e supporto desktop/kiosk.

### B. Renderer & Settings
- **`renderer/src/settings.ts`**:
  - Rinomina `interface SmerdinoSettings` in `interface TerrariumSettings`.
  - Aggiungi export di retrocompatibilità: `export type SmerdinoSettings = TerrariumSettings;`.
  - Aggiorna `SETTINGS_STORAGE_KEY` a `"lineage_terrarium_settings_v1"`.
  - In `loadSettings()`: se `"lineage_terrarium_settings_v1"` è null, fai fallback su `"lineage_smerdino_settings_v1"`.
  - Aggiorna commenti da Smerdino a Terrarium.
- **`renderer/src/fieldguide.ts`**:
  - Sostituisci `SmerdinoSettings` con `TerrariumSettings`.
  - Cambia `"Connect to live Smerdino server"` in `"Connect to live Terrarium server"`.
  - Aggiorna intestazione del file a `"The Naturalist's Field Guide (Tab) for Lineage: Terrarium"`.
- **`renderer/src/main.ts`**, **`renderer/src/director.ts`**, **`renderer/src/keybar.ts`**:
  - Sostituisci `SmerdinoSettings` con `TerrariumSettings`.
  - Aggiorna commenti e riferimenti testuali a `Lineage: Terrarium`.
- **`renderer/tests/camera/fieldguide.test.ts`**:
  - Aggiorna le descrizioni dei test (`describe("Terrarium screensaver settings", ...)`).

### C. Configurazione & Deploy
- **`sim/config/terrarium.toml`**:
  - Crea copiando `sim/config/smerdino.toml` e aggiornando descrizioni e titoli per Terrarium (ciclo solare reale e parametri screensaver).
- **Cartella `deploy/`**:
  - Crea `deploy/terrarium-kiosk.sh` (generico, default config `sim/config/terrarium.toml`).
  - Crea `deploy/lineage-terrarium-server.service` e `deploy/lineage-terrarium-kiosk.service`.
  - In `deploy/windows-sync.ps1`: imposta come default server host `terrarium.local`.
  - Crea `Lineage-Terrarium.cmd` alla radice: avvia l'app desktop con titolo finestra `"Lineage: Terrarium"`.

### D. Documentazione & README
- **`docs/terrarium-kiosk.md`**:
  - Guida generica e curata: come eseguire Lineage: Terrarium come screensaver continuo su mini-PC Linux (Debian/Ubuntu/Raspberry Pi).
- **`README.md`**:
  - Riscrivi il README principale con lo stile di un progetto open-source di alta qualità:
    - Intestazione: `# Lineage: Terrarium 🌿`
    - Sottotitolo: *"An Idle Biological Evolution Simulator & Desktop Biome Companion"*
    - Sezione **Features**:
      - 🪟 *Standalone Desktop App*: supporto PiP (Picture-in-Picture) e Fullscreen (`[F]`), snapshot (`[C]`).
      - 🧩 *In-Game Modding Framework*: premi `[M]` per aprire il menù delle MOD in pixel art e personalizzare l'esperienza a caldo.
      - 📖 *The Naturalist's Field Guide*: premi `[Tab]` per il taccuino con albero filogenetico, ritratti e cronaca.
      - ⚡ *Fast-Life Mode & 400-Year Bootstrap*: simulazione biologica rapida a 90x per vedere l'evoluzione in ore.
      - 🌙 *Circadian Solar Cycle & Sleep Mode*: ciclo luce/buio e velo notte (`[N]`).
      - 🖥️ *Kiosk & Continuous Screensaver*: pronto per girare 24/7 su macchine dedicate.
    - Sezione **Come giocare (Quick Start)**:
      - Windows: doppio click su `Lineage-Terrarium.cmd`
      - Web Dev: `npm --prefix renderer run dev`
    - Sezione **Credits & Upstream**:
      - Attribuzione in primo piano a **Michele Lisi** per il motore originale *Lineage* (Apache License 2.0).

---

## 4. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` passa con 0 errori.
2. `npm --prefix renderer run test` passa con tutti i 713 test verdi.
3. Nessun riferimento a "smerdino" rimane nei tipi esportati o nei testi a schermo.
4. `Lineage-Terrarium.cmd` avvia l'applicazione desktop con titolo `"Lineage: Terrarium"`.
5. I commit vengono eseguiti in modo atomico e pulito sul branch `gemini/clean-terrarium`.
