# HANDOFF — MOD: Winter Yule & Christmas Isle (Mod Natalizia)

## 1. Obiettivo

Costruire la mod festiva **"Winter Yule & Christmas Isle"** (`id: "christmas-yule"`), integrata nel Mod Framework del gioco.
La mod porta l'atmosfera natalizia e del solstizio d'inverno sull'isola con:
1. **Nevicata costante**: fiocchi di neve pixel art che fluttuano sullo schermo con la brezza invernale.
2. **Cappellini natalizi (Santa Hats)**: un minuscolo cappellino rosso con bordo e pon-pon bianco in pixel art sulla testa di ciascuna creatura vivente.
3. **Lucine colorate (Twinkling Fairy Lights)**: ghirlande di lucine intermittenti (rosso, oro, verde, ciano) che brillano sui cespugli e sugli alberi.
4. **Stella d'Inverno / Cometa**: una brillante stella a croce pixel art nel cielo crepuscolare e notturno.

- **Ambito**: Esclusivamente Renderer (`renderer/`). Nessun impatto sul simulatore o sul determinismo di `sim/`.

---

## 2. Decisioni e Dettagli di Implementazione

### A. Modulo e Flag Globale (`renderer/src/mods/builtin/christmas.ts`)
- Esportare le funzioni per interrogare e impostare lo stato:
  ```typescript
  let christmasActive = false;
  export function setChristmasActive(active: boolean): void { christmasActive = active; }
  export function isChristmasActive(): boolean { return christmasActive; }
  ```
- Classe `ChristmasMod implements Mod`:
  - `meta`:
    - `id`: `"christmas-yule"`
    - `name`: `"Winter Yule & Christmas Isle"`
    - `version`: `"1.0.0"`
    - `description`: `"Holiday celebration: gentle snowfall, Santa hats on creatures, twinkling tree lights, and a glowing winter star."`
    - `defaultEnabled`: `true`
  - In `enable()`: chiama `setChristmasActive(true)`.
  - In `disable()`: chiama `setChristmasActive(false)`.
  - In `isEnabled()`: ritorna `isChristmasActive()`.

### B. Nevicata Continua (`renderer/src/atmosphere/atmosphere.ts`)
- In `update(view, moment, dtS)` di `atmosphere.ts`:
  - Se `isChristmasActive()` è vero:
    - Forza `this.snowfall = 1.0;` e assicura `this.rain = Math.max(this.rain, 0.75);` (così `drawSnow(view)` si attiva e fa scendere i fiocchi senza dipendere dalla stagione o dal meteo).
  - Quando disattivata, il meteo e la neve tornano al ciclo naturale.

### C. Cappellini di Babbo Natale (`renderer/src/creatures/layer.ts`)
- Generare una texture pixel art procedurale (o sprite) per il cappellino (es. triangolo rosso `0xd32f2f` alto 5-6 pixel con base bianca `0xffffff` e pon-pon bianco in cima).
- Per ogni creatura in `CreatureLayer`:
  - Aggiungere un piccolo sprite `santaHat` agganciato al container della testa (`joints[0]`).
  - Durante l'aggiornamento dei frame:
    - Se `isChristmasActive()` è attivo e la vista mostra i corpi (`showing === "bodies"`), il cappellino è visibile (`santaHat.visible = true`) e posizionato leggermente sopra la testa della creatura;
    - Altrimenti `santaHat.visible = false`.

### D. Lucine Festive sugli Alberi & Stella d'Inverno
- In `atmosphere.ts` (o `christmas.ts`):
  - Lucine scintillanti attorno agli alberi/cespugli: piccoli punti luminosi pulsanti (colori festivi: rosso, oro, verde, ciano) che sfumano ciclicamente (`Math.sin(timeS * 4 + hash)`).
  - Durante la notte/dusk (`dark > 0.3`), una stella luminosa a croce (pixel art 5x5) brilla nel cielo.

### E. Registrazione in `renderer/src/main.ts`
- Registrare `ChristmasMod` nel `ModRegistry`:
  `modRegistry.register(new ChristmasMod());`
- Compare nel Menù MOD `[M]` subito dopo `Dashboard Buttons` e `Purposeful Wanderer AI`.

### F. Test Unitari (`renderer/tests/mods/christmas.test.ts`)
- Testare metadati, `enable()`, `disable()`, stato di persistenza nel registro e propagazione dei flag a `isChristmasActive()`.

---

## 3. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` senza errori.
2. `npm --prefix renderer run test` con tutti i 722 test storici + i nuovi test verdi.
3. Nel Menù MOD (`[M]`), "Winter Yule & Christmas Isle" compare con toggle `[ON]` / `[OFF]`.
4. All'attivazione:
   - Nevica dolcemente sull'isola;
   - Le creature indossano il cappellino natalizio;
   - Di notte brilla la stella festiva.
