# HANDOFF — MOD: Terrarium XL (Macro Zoom & Apex Ecology)

## 1. Obiettivo

Implementare la MOD **"Terrarium XL: Macro Zoom & Apex Ecology"** (`id: "xl-scale"`):
1. **Zoom Macro (Macro Lens / Deep Close-Up)**:
   - Nella vista locale (che segue l'animale), possibilità di zoomare a **2x e 3x** (tasto `[Z]` o rotellina del mouse), permettendo di osservare creature minuscole da 15 cm in grande dettaglio pixel art.
2. **Classificazione Metrica Reale nel Taccuino delle Specie (`fieldguide.ts`)**:
   - Stima realistica in centimetri e chilogrammi della specie:
     - `Micro-fauna` (15–30 cm, 50–300 g) per sauri, roditori e insetti giganti;
     - `Meso-fauna` (40–120 cm, 2–35 kg) per erbivori e predatori medi;
     - `Macro / Apex Predator` (1.5–2.2 m, 60–150 kg) per felini, orsi e megafauna.
3. **Parametri Allometrici Estesi in `sim/config/terrarium.toml`**:
   - `mass_min = 0.08` (apre verso il basso alle creature minute di 15 cm);
   - `mass_max = 32.0` (apre verso l'alto per predatori dominanti);
   - `population_cap = 180` (aumenta la densità per consentire al micro-popolo di brulicare).

- **Ambito**: Renderer (`renderer/src/mods/builtin/xl-scale.ts`, `fieldguide.ts`, `main.ts`) e configurazione `sim/config/terrarium.toml`. Nessuna rottura della purezza di `sim/`.

---

## 2. Dettagli di Implementazione

### A. Modulo e Flag Globale (`renderer/src/mods/builtin/xl-scale.ts`)
- Esportare:
  ```typescript
  let xlScaleActive = false;
  export function setXlScaleActive(active: boolean): void { xlScaleActive = active; }
  export function isXlScaleActive(): boolean { return xlScaleActive; }
  ```
- Classe `XlScaleMod implements Mod`:
  - `meta`:
    - `id`: `"xl-scale"`
    - `name`: `"Terrarium XL: Macro Zoom & Apex Ecology"`
    - `version`: `"1.0.0"`
    - `description`: `"Deep macro zoom (key [Z] or wheel) and ecological scale from 15cm micro-critters to massive apex predators."`
    - `defaultEnabled`: `true`
  - `enable()`: chiama `setXlScaleActive(true)`.
  - `disable()`: chiama `setXlScaleActive(false)`.
  - `isEnabled()`: ritorna `isXlScaleActive()`.

### B. Macro Zoom nella Vista Locale (`renderer/src/main.ts`)
- Variabile di zoom `macroZoomLevel: 1 | 2 | 3 = 1` (default 1x).
- Gestione tasto `[Z]` o `[z]`:
  - Quando la telecamera è in vista `local` (o segue un animale) e la mod è attiva:
    - Cicla `macroZoomLevel = macroZoomLevel === 1 ? 2 : macroZoomLevel === 2 ? 3 : 1;`
- Supporto rotellina del mouse (`wheel`):
  - In vista `local`, scroll avanti incrementa `macroZoomLevel`, scroll indietro riduce fino a 1x.
- Applicazione dello zoom:
  - Sul container di scena / stage in vista `local`, applicare il fattore di scala `macroZoomLevel` centrato sul soggetto seguito (`shot.centre`).

### C. Classificazione Metrica nel Taccuino (`renderer/src/fieldguide.ts`)
- Funzione di calcolo metrica `formatMetricSize(mass: number): string`:
  - Se `mass < 0.35`: `"Micro (15-28 cm, ~120g)"`
  - Se `mass < 1.5`: `"Small (35-60 cm, ~2kg)"`
  - Se `mass < 6.0`: `"Medium (75-120 cm, ~25kg)"`
  - Altrimenti: `"Apex (1.5-2.2 m, ~95kg)"`
- Nella scheda specie del Taccuino, mostrare questa taglia accanto o sotto i tratti somatici.

### D. Configurazione `sim/config/terrarium.toml`
- Aggiornare:
  - `mass_min = 0.08`
  - `mass_max = 32.0`
  - `population_cap = 180`

### E. Test Unitari (`renderer/tests/mods/xl-scale.test.ts`)
- Verificare attivazione, ciclo `macroZoomLevel`, funzione `formatMetricSize` e persistenza.

---

## 3. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` passa con zero errori.
2. `npm --prefix renderer run test` con tutti i 785 test storici + nuovi test verdi.
3. Nel Menù MOD `[M]`, "Terrarium XL: Macro Zoom & Apex Ecology" compare e si può attivare/disattivare.
4. In vista locale, premendo `[Z]` o con la rotellina si può zoomare a 2x/3x in Macro.
5. Nel Taccuino (`[Tab]`), le specie mostrano la stima metrica (es. Micro, Small, Medium, Apex).
