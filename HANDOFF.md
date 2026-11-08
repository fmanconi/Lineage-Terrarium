# HANDOFF — Modding Framework & Dashboard Buttons Mod

## 1. Obiettivo

Costruire un'architettura modulare di modding per Lineage confinata interamente al renderer WebGL/TS (`renderer/src/mods/`), con un Menù Mod in-game accessibile in pixel art, e migrare i bottoni/scorciatoie della dashboard nella prima mod ufficiale ("Dashboard Buttons").

- **Riferimento OBIETTIVI.md**: Progetti personali di Federico (Svago & Desktop Companion) e standardizzazione ingegneria progetti (rif. proposta MARTA #11). Nessun impatto su dati o sistemi di produzione.
- **Perimetro di isolamento**: Confinato al solo **Renderer** (`renderer/`). Nessun file in `sim/` o `server/` viene modificato, garantendo il rispetto assoluto della purezza del motore di simulazione, del determinismo e delle migrazioni (ADR 0001, ADR 0024).

---

## 2. Decisioni prese

1. **Mod Loader integrato nel Renderer (Client-side TS)**
   - *Perché*: Lineage separa rigidamente simulazione e visualizzazione. Tutto ciò che è HUD, tasti, barre e menù risiede nel client. Questa scelta evita qualsiasi overhead di rete, non tocca il sim e permette il caricamento istantaneo.
   - *Fonte*: ADR 0001 (`sim` pure, no I/O), ADR 0024, discussione del 08/11/2026.

2. **Finestra modale pixel-art in-game (`renderer/src/mods/menu.ts`)**
   - *Perché*: Coerente con la direzione artistica del gioco (stesso stile di `card.ts`, `keybar.ts`, `fieldguide.ts`: cornice in legno `FRAME_EDGE`/`FRAME_LIT`, pergamena crema `CARD`, font pixel-art bitmap `pixelfont.ts`).
   - *Contenuto*: Titolo "MODS", lista scrollabile con toggle `[ON]` / `[OFF]`, box descrittivo (versione, autore, descrizione), istruzioni tasti (`Space`/`Enter` per invertire, `Esc`/`M` per chiudere). Supporto click del mouse.
   - *Fonte*: Decisioni `/grill-me` del 08/11/2026.

3. **Tasto universale `[M]` per il Menù Mod e disaccoppiamento da `[Tab]`**
   - *Perché*: In precedenza sia `Tab` che `M` aprivano il Field Guide (`main.ts:822`). Ora `Tab` è dedicato al Field Guide (Taccuino), mentre `M` apre il ModMenu. `M` funziona sempre, anche quando tutte le mod sono disattivate.
   - *Fonte*: `renderer/src/main.ts#L822`.

4. **Prima Mod: "Dashboard Buttons" (`renderer/src/mods/builtin/dashboard-buttons.ts`)**
   - *Cosa fa*: Incapsula l'istanza di `KeyBar` (`renderer/src/keybar.ts`). Quando è attiva (default per i nuovi utenti), mostra la barra dei tasti in basso a destra con supporto click (View, Guide, Miracle, Full, PiP, Night, e il nuovo bottone `[Mods]` per aprire il menù). Quando è disattivata, nasconde l'elemento `KeyBar` e ignora i click nell'area, restituendo la schermata pulita e pura del gioco originale.
   - *Fonte*: Decisioni `/grill-me` del 08/11/2026.

5. **Persistenza locale dello stato**
   - *Cosa fa*: Lo stato ON/OFF di ogni mod viene salvato in `localStorage` con la chiave `lineage_mods_state_v1` (usando `StorageLike` da `settings.ts`).
   - *Fonte*: `renderer/src/settings.ts#L25`.

---

## 3. File da toccare

### File nuovi da creare:

1. `renderer/src/mods/types.ts`:
   - Definire `ModMetadata`:
     - `id: string`
     - `name: string`
     - `version: string`
     - `description: string`
     - `author?: string`
     - `defaultEnabled: boolean`
   - Definire `ModContext`:
     - `frame: HTMLElement`
     - `width: number`
     - `height: number`
     - `storage: StorageLike` (da `settings.ts`)
   - Definire `Mod`:
     - `readonly meta: ModMetadata`
     - `init(ctx: ModContext): void`
     - `enable(): void`
     - `disable(): void`
     - `isEnabled(): boolean`
     - `update?(dtS: number, options: Record<string, unknown>): void`
     - `onKey?(e: KeyboardEvent): boolean` (ritorna `true` se l'evento è gestito/consumato)
     - `onPointer?(artX: number, artY: number, e: PointerEvent): boolean` (ritorna `true` se gestito)

2. `renderer/src/mods/registry.ts`:
   - Classe o modulo `ModRegistry`:
     - Mantiene mappa ordinata delle mod registrate.
     - Carica lo stato salvato da `localStorage` (`lineage_mods_state_v1`). Se una mod non è ancora presente, assume `mod.meta.defaultEnabled`.
     - Metodi:
       - `register(mod: Mod): void`
       - `getMods(): readonly Mod[]`
       - `getMod(id: string): Mod | undefined`
       - `isModEnabled(id: string): boolean`
       - `setModEnabled(id: string, enabled: boolean): void`
       - `toggleMod(id: string): boolean`
       - `initAll(ctx: ModContext): void`
       - `dispatchUpdate(dtS: number, options: Record<string, unknown>): void`
       - `dispatchKey(e: KeyboardEvent): boolean`
       - `dispatchPointer(artX: number, artY: number, e: PointerEvent): boolean`

3. `renderer/src/mods/menu.ts`:
   - Classe `ModMenu`:
     - Gestisce un `HTMLCanvasElement` overlay inserito in `frame`.
     - Coordinate fisse art-pixel (es. larghezza 320, altezza 200, centrate su 512x300 con styling percentuale come in `keybar.ts` o `card.ts`).
     - Render pixel-art: cornice in legno (`FRAME_EDGE`, `FRAME_LIT`, `FRAME_SHADE`), pergamena (`CARD`), inchiostro (`INK`, `FADED_INK`), font bitmap (`draw` da `pixelfont.ts`).
     - Disegna:
       - Intestazione: `"MODS"`
       - Lista mod registrate con indice, indicatore `[ON]` (verde/chiaro) o `[OFF]` (grigio/scuro) e nome.
       - Barra o box inferiore con la descrizione della mod attualmente evidenziata.
       - Hint comandi: `[↑/↓]` Sposta, `[Spazio/Enter]` Toggle, `[Esc/M]` Chiudi.
     - Metodi:
       - `open(): void`
       - `close(): void`
       - `toggle(): void`
       - `isOpen(): boolean`
       - `update(dtS: number, lamp?: Rgb): void` (ridisegna solo se `paintedKey` cambia)
       - `handleKey(e: KeyboardEvent): boolean`
       - `hitAt(artX: number, artY: number): "close" | "toggle" | null`

4. `renderer/src/mods/builtin/dashboard-buttons.ts`:
   - Classe `DashboardButtonsMod implements Mod`:
     - `meta`: `{ id: "dashboard-buttons", name: "Dashboard Buttons", version: "1.0.0", description: "Interactive bottom-right button bar with mouse clicks and shortcut hints.", defaultEnabled: true }`
     - Possiede o referenzia l'istanza di `KeyBar` (`renderer/src/keybar.ts`).
     - In `enable()`: mostra l'elemento DOM di `KeyBar` (`keyBar.element.style.display = ""`) e risveglia la barra (`keyBar.wake()`).
     - In `disable()`: nasconde l'elemento DOM di `KeyBar` (`keyBar.element.style.display = "none"`).
     - In `update(dtS, options)`: se abilitata, chiama `keyBar.update(dtS, options)`.
     - Metodo helper `hitAt(artX, artY)`: ritorna `keyBar.hitAt(artX, artY)` solo se la mod è abilitata, altrimenti `null`.

5. `renderer/tests/mods/registry.test.ts`:
   - Test unitari Vitest per `ModRegistry`:
     - Registrazione mod, stato di default, toggle abilitazione.
     - Salvataggio e ricaricamento da uno `StorageLike` finto in memoria.
     - Corretta invocazione di `enable()` e `disable()`.

### File esistenti da modificare:

1. `renderer/src/keybar.ts`:
   - Aggiungere il bottone per le Mod nei suggerimenti standard quando `guideOpen` è falso:
     ```typescript
     { id: "mods", key: { kind: "text", text: "M" }, label: "Mods" }
     ```
   - In `hitAt(artX, artY)` o nella lista degli hint, assicurare che `"mods"` sia un target valido restituito quando cliccato.

2. `renderer/src/main.ts`:
   - Importare `ModRegistry`, `ModMenu`, `DashboardButtonsMod`.
   - Istanziare `ModRegistry` e registrare `DashboardButtonsMod` (che prende in carico `keyBar`).
   - Istanziare `ModMenu` e aggiungere `modMenu.element` al DOM di `frame`.
   - Disaccoppiare i tasti:
     - `Tab`: chiama `toggleGuide()`.
     - `m` o `M`: chiama `toggleMods()`.
   - Nel click listener di `frame` (`pointerdown`):
     - Se `modMenu.isOpen()`, inoltrare il click a `modMenu`.
     - Se la KeyBar cliccata restituisce `"mods"`, aprire `modMenu.toggle()`.
   - Nel loop principale di rendering:
     - Chiamare `modMenu.update(dtS, lamp)`.
     - Chiamare `dashboardMod.update(dtS, ...)` anziché la chiamata diretta sciolta.

---

## 4. Criteri di fatto verificabili

1. Tutti i **699 test preesistenti** di Vitest continuano a passare (`npm --prefix renderer run test`).
2. I nuovi test di `renderer/tests/mods/registry.test.ts` passano al 100%.
3. `npm --prefix renderer run typecheck` passa con zero errori TypeScript.
4. Premendo `M` da tastiera, o cliccando sul pulsante `[M] Mods` della KeyBar, si apre la finestra modale in pixel art dei MODS.
5. Nel menù MODS, disattivando `Dashboard Buttons` (`[OFF]`), la barra in basso a destra scompare istantaneamente.
6. Ricaricando la pagina, lo stato della mod rimane persistito (letto da `localStorage`).
7. Con la mod disattivata, premere `M` continua a riaprire regolarmente il menù MODS per poterla riattivare.

---

## 5. Domande aperte

Nessuna. L'albero decisionale è stato concordato via `/grill-me` l'08/11/2026.
