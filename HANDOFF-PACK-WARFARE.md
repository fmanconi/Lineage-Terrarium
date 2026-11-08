# HANDOFF — MOD: Pack, Colonies & Territorial Warfare

## 1. Obiettivo

Implementare la MOD **"Pack, Colonies & Territorial Warfare"** (`id: "pack-warfare"`):
- Formazione di branchi coordinati (coesione, allineamento di stormo/sciame e separazione minima tra membri della stessa specie).
- Identificazione e protezione di Nidi/Centri Colonia per le popolazioni che crescono in numero.
- Sfide territoriali e rivalità tra specie/colonie diverse: intimidazione visiva, scintille e ritirata del gruppo in inferiorità numerica (Pack Advantage).
- Toggle istantaneo nel Menù MOD `[M]`.

- **Ambito**: Renderer (`renderer/src/mods/builtin/pack-warfare.ts` e `renderer/src/creatures/`). Nessuna modifica a `sim/` o al determinismo della simulazione pura.

---

## 2. Decisioni e Dettagli Tecnici

### A. Modulo e Flag Globale (`renderer/src/mods/builtin/pack-warfare.ts`)
- Esportare le funzioni di stato:
  ```typescript
  let packWarfareActive = false;
  export function setPackWarfareActive(active: boolean): void { packWarfareActive = active; }
  export function isPackWarfareActive(): boolean { return packWarfareActive; }
  ```
- Classe `PackWarfareMod implements Mod`:
  - `meta`:
    - `id`: `"pack-warfare"`
    - `name`: `"Pack, Colonies & Territorial Warfare"`
    - `version`: `"1.0.0"`
    - `description`: `"Swarm & pack cohesion, colony nests, and territorial skirmishes with rival species."`
    - `defaultEnabled`: `true`
  - `enable()`: imposta `setPackWarfareActive(true)`.
  - `disable()`: imposta `setPackWarfareActive(false)`.
  - `isEnabled()`: ritorna `isPackWarfareActive()`.

### B. Coordinazione di Branco (Pack Flocking / Boids in `renderer/src/creatures/pack.ts`)
- Creare il modulo helper `renderer/src/creatures/pack.ts`:
  - `updatePackDynamics(creatures: Creature[], dtS: number)`:
    - Raggruppa le creature vive per specie (`creature.plan.colour` o `seed.genome`).
    - Per membri della stessa specie vicini (distanza < 3.0 celle):
      - **Allineamento**: tendono a convergere sulla media della direzione di marcia del branco.
      - **Separazione**: mantengono una distanza confortevole minima (evitando sovrapposizioni visive anomale).
      - **Coesione**: se un membro si allontana troppo dal gruppo (> 4 celle), il suo prossimo stroll è orientato verso il baricentro dei compagni.

### C. Nidi di Colonia (Colony Nests)
- Quando una specie conta $\ge 4$ individui nell'area:
  - Viene calcolato il baricentro della colonia come `NestLocation`.
  - Le madri e i piccoli (`growth < 1`) orbitano preferenzialmente vicino al nido, mentre gli adulti esplorano il perimetro esterno.
  - Sul terreno, in prossimità del baricentro, viene visualizzato un piccolo elemento visivo di nido in pixel art (cumulo di rametti / pietre `4x4` pixel con texture procedurale).

### D. Sfide Territoriali e Ritirata (Territorial Warfare)
- Quando creature di specie o gruppi diversi si avvicinano a meno di 2.0 celle:
  - Scatta lo stato di **Tensione Territoriale**:
    - Le creature si fronteggiano orientando le teste l'una verso l'altra per un breve istante.
    - Compaiono piccole scintille visive di avvertimento (`sparks.ts` o sbuffi).
    - **Pack Multiplier**: il gruppo che ha più alleati entro 3 celle vince l'intimidazione. Il membro del gruppo in minoranza viene intimorito ed esegue una ritirata decisa (marcia in direzione opposta di 2-3 celle).

### E. Integrazione in `layer.ts` e `main.ts`
- In `CreatureLayer`: durante il ciclo di aggiornamento dei frame, se `isPackWarfareActive()` è vero, chiama `updatePackDynamics`.
- In `main.ts`: registra `PackWarfareMod` nel `ModRegistry`. Compare nel menù `[M]`.

### F. Test Unitari (`renderer/tests/mods/pack-warfare.test.ts`)
- Verificare attivazione/disattivazione, raggruppamento per specie, convergenza direzionale e logica di vittoria per superiorità numerica (Pack Advantage).

---

## 3. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` senza errori.
2. `npm --prefix renderer run test` con tutti i 725 test storici + i nuovi test verdi.
3. Nel Menù MOD `[M]`, "Pack, Colonies & Territorial Warfare" compare con toggle `[ON]` / `[OFF]`.
4. Con la mod attiva:
   - I membri della stessa specie si muovono coordinati in gruppo;
   - Si formano colonie stabili con nido;
   - I confini generano schermaglie e ritirate coerenti.
