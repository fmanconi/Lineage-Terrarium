# HANDOFF — MOD: Purposeful Wanderer AI (Fix Movimento Insetti)

## 1. Obiettivo

Implementare la seconda MOD ufficiale del gioco, **"Purposeful Wanderer AI"**, per risolvere il difetto visivo/comportamentale per cui gli insetti e le creature tendono a girare continuamente su se stessi in circolo anziché muoversi con scopo e naturalezza.

- **Nome Mod**: `Purposeful Wanderer AI` (`id: "purposeful-wanderer"`)
- **Default**: `enabled: true`
- **Ambito**: Renderer (`renderer/src/mods/builtin/wanderer.ts` e `renderer/src/creatures/motion.ts`). Nessun tocco a `sim/` o al determinismo della simulazione pura.

---

## 2. Diagnosi e Decisioni Tecniche

### La Causa in `renderer/src/creatures/motion.ts`:
1. In `chooseStroll` (L.676), a ogni fine pausa (ogni 1.5–5s) viene campionato un angolo completamente casuale `angle = random() * 2 * Math.PI`. L'animale compie 2 passi, si ferma, sceglie un nuovo angolo a caso (spesso invertito di 150°–180°), ruotando continuamente su se stesso entro il piccolo leash (0.4 celle).
2. Durante `motion.mode === "pause"` (L.277), `walker.heading` viene forzato a seguire `motion.look` a rate elevato, facendo girare a scatti l'intero corpo sul posto anche durante le soste.

### Le Soluzioni della Mod:
1. **Controllo globale della modalità Wanderer in `motion.ts`**:
   - Esportare le funzioni:
     ```typescript
     let purposefulWandererActive = false;
     export function setPurposefulWanderer(active: boolean): void { purposefulWandererActive = active; }
     export function isPurposefulWanderer(): boolean { return purposefulWandererActive; }
     ```
2. **Cono di Movimento in Avanti (Forward Heading Bias)**:
   - In `chooseStroll`: quando la mod è attiva, il campionamento dell'angolo di passeggiata non è più uniformemente distribuito su $2\pi$. Viene invece orientato verso la direzione corrente (`walker.heading`), con una deviazione controllata:
     `const angle = walker.heading + (random() * 2 - 1) * (Math.PI / 3); // cono di ±60°`
   - Se il punto è ostruito da un ostacolo (`free(x, y) === false`), i tentativi successivi (`attempt > 0`) allargano gradualmente l'angolo fino a trovare una via libera.
   - Quando la mod è disattivata (`purposefulWandererActive === false`), il codice si comporta esattamente come la versione vanilla storica (`random() * 2 * Math.PI`).
3. **Stabilità di Postura in Pausa**:
   - In `motion.mode === "pause"`: quando la mod è attiva, la rotazione di `walker.heading` verso `motion.look` è attenuata o limitata a un arco delicato ($\pm 15^\circ$), consentendo alla creatura di "guardarsi attorno" senza che il corpo ruoti a 360° sul posto.
4. **Classe Mod `renderer/src/mods/builtin/wanderer.ts`**:
   - Implementa l'interfaccia `Mod`:
     - `id`: `"purposeful-wanderer"`
     - `name`: `"Purposeful Wanderer AI"`
     - `version`: `"1.0.0"`
     - `description`: `"Replaces erratic on-the-spot spinning with forward momentum and natural wandering."`
     - `defaultEnabled`: `true`
     - `enable()`: chiama `setPurposefulWanderer(true)`.
     - `disable()`: chiama `setPurposefulWanderer(false)`.
     - `isEnabled()`: ritorna `isPurposefulWanderer()`.
5. **Integrazione in `renderer/src/main.ts`**:
   - Importare `PurposefulWandererMod` da `./mods/builtin/wanderer`.
   - Registrare l'istanza in `modRegistry.register(new PurposefulWandererMod())`.
   - In questo modo la mod compare nel menù `[M]`, è accesa di default per tutti i nuovi utenti e può essere disattivata/riattivata a caldo in qualsiasi momento.

---

## 3. File da creare o modificare

1. **Crea `renderer/src/mods/builtin/wanderer.ts`**:
   - Implementazione della classe `PurposefulWandererMod`.
2. **Modifica `renderer/src/creatures/motion.ts`**:
   - Aggiungi export di `setPurposefulWanderer` e `isPurposefulWanderer`.
   - In `chooseStroll`: passa o usa `walker.heading` per campionare nel cono in avanti se la mod è attiva.
   - In `drive` (sezione `pause`): mantieni stabile la postura del corpo.
3. **Modifica `renderer/src/main.ts`**:
   - Registra `PurposefulWandererMod` nel `modRegistry`.
4. **Crea `renderer/tests/mods/wanderer.test.ts`**:
   - Test unitario: verifica abilitazione/disabilitazione della mod, chiamata a `setPurposefulWanderer`, persistenza nel registro e verifica che `chooseStroll` rispetti il cono in avanti quando attiva.

---

## 4. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` passa con zero errori.
2. `npm --prefix renderer run test` passa con tutti i 714 test storici + i nuovi test verdi.
3. Aprendo il Menù Mod con `[M]`, compaiono entrambe le mod: "Dashboard Buttons" e "Purposeful Wanderer AI".
4. Disattivando "Purposeful Wanderer AI", le creature riprendono il comportamento casuale a 360°; attivandola, passeggiano orientandosi in avanti senza girare in tondo.
