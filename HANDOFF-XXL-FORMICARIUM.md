# HANDOFF — MOD: Terrarium XXL (Formicarium & Social Insect Colonies)

## 1. Obiettivo

Implementare la MOD di dettaglio estremo **"Terrarium XXL: Formicarium & Social Insect Colonies"** (`id: "formicarium"`):
1. **Colonie di Insetti Sociali e Formicai (`ColonyMound`)**:
   - 3 colonie distinte posizionate su terra asciutta dell'isola:
     - *Formica rufa* (Formiche rosse del legno / Harvester, colore `#c0392b`, montagnola aghiforme terra scura)
     - *Lasius niger* (Formiche nere da giardino, colore `#24242e`, colonne compatte)
     - *Camponotus ligniperda* (Formiche carpentiere dorate, colore `#d4ac0d`, raccoglitrici di fogliame e legno)
   - Montagnole dei formicai pixel-art disegnate sul layer `ground` (cono terroso circolare con cratere scuro d'ingresso e granelli di terra sparsi).
2. **Rete e Griglia di Feromoni Chimici (`PheromoneGrid`)**:
   - Griglia 2D di feromoni su coordinate isola con evaporazione e diffusione fisica:
     - `foodTrails`: feromone di foraggiamento/cibo depositato dalle operaie cariche mentre tornano al formicaio;
     - `alarmTrails`: feromone di allarme emesso in presenza di predatori o rivali.
   - Hotkey `[I]` / `[i]` ("Inspect Pheromones"): attiva/disattiva la sovraimpressione delle autostrade chimiche bioluminescenti (linee ciano/smeraldo per il cibo, ambra/rosso per l'allarme) e un piccolo badge informativo.
3. **Comportamento Sciame ed Entità Micro-Formiche (`Ant`)**:
   - Popolazione di 24-32 formiche attive per colonia.
   - Macchina a stati:
     - `foraging`: cerca cibo seguendo i gradienti di feromone positivo o esplorando l'isola a ventaglio. Raccoglie briciole/frammenti vicino a flora o carcasse di animali.
     - `returning`: trasporta il carico verso il formicaio di appartenenza depositando feromone `foodTrail`.
     - `resting`: sosta breve nel formicaio prima di ripartire.
     - `alarm`: sciamano fuori a difendere il formicaio se calpestato da animali grandi (creature Mod XL) o se incontrano colonie rivali.
4. **Resa Grafica e Integrazione con Macro Zoom 2x/3x (Mod XL)**:
   - A zoom 1x: micro-puntini brulicanti da 1-2 pixel nei colori della propria colonia.
   - A zoom 2x/3x (Macro Zoom tasto `[Z]`): resa anatomica dettagliata in pixel-art: capo con antenne, torace con zampe micro-animate, addome/gastro e frammento di foglia verde (`0x5cb85c`) o cibo rosso (`0xe74c3c`) sollevato dalle mandibole!
5. **Piena conformità architettura Mod (ADR 0024)**:
   - Client-side renderer mod pura, zero modifiche al determinismo di `sim/`.
   - Mod registrata in `renderer/src/main.ts` e gestibile dal Mod Menu `[M]`.

---

## 2. File da Creare e Modificare

1. **`renderer/src/mods/builtin/formicarium.ts`** (Nuovo file):
   - Esportare flag globale:
     ```typescript
     let formicariumActive = false;
     export function setFormicariumActive(active: boolean): void;
     export function isFormicariumActive(): boolean;
     export function togglePheromoneOverlay(): boolean;
     export function isPheromoneOverlayActive(): boolean;
     ```
   - Struttura `FormicariumMod implements Mod`:
     - `meta`:
       - `id`: `"formicarium"`
       - `name`: `"Terrarium XXL: Formicarium & Social Insect Colonies"`
       - `version`: `"1.0.0"`
       - `description`: `"Underground ant mounds, pheromone foraging/alarm highways, worker/soldier swarms, and carrion harvesting."`
       - `defaultEnabled`: `true`
     - `layers`: `{ ground, over, screen }`
       - `ground`: montagnole dei formicai e visualizzazione autostrade feromoni con `[I]`.
       - `over`: particelle e sprite formiche (in coordinate celle del mondo, scalate automaticamente con `modsOver`).
       - `screen`: badge discreto in pixel font che indica lo stato delle colonie e l'overlay feromoni.
     - `onKey(e: KeyboardEvent)`:
       - Se `e.key === "i" || e.key === "I"`, cicla overlay feromoni e ritorna `true`.
2. **`renderer/src/main.ts`**:
   - Importare `FormicariumMod` da `./mods/builtin/formicarium`.
   - Registrare `mods.register(new FormicariumMod());` accanto a `xlScale`.
3. **`renderer/tests/mods/formicarium.test.ts`** (Nuovo file):
   - Test unitari completi:
     - Metadati della mod (`id`, `name`, `defaultEnabled: true`).
     - Abilitazione / disabilitazione globale e pulizia layer.
     - Griglia feromoni: deposizione, evaporazione e campionamento gradiente.
     - Stati delle formiche (`foraging`, `returning`, raccolta cibo, scarico al formicaio).
     - Gestione tasto `[I]` per toggle overlay feromoni.

---

## 3. Criteri di Fatto Verificabili

1. `npm --prefix renderer run typecheck` (tsc) passa con 0 errori.
2. `npm --prefix renderer run test` esegue con successo tutti i 795 test preesistenti + i nuovi test di `formicarium.test.ts`.
3. Nel menù MOD (`[M]`), compare "Terrarium XXL: Formicarium & Social Insect Colonies".
4. Il tasto `[I]` attiva/disattiva l'overlay delle scie di feromoni.
5. In Macro Zoom (`[Z]`), le formiche e i loro carichi di cibo/foglie sono chiaramente visibili e proporzionati alla fauna da 15cm.
