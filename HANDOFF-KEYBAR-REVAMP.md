# HANDOFF — Razionalizzazione KeyBar e Comandi Tastiera

## 1. Obiettivo

Snellire la barra dei tasti (`KeyBar`) in basso a destra e armonizzare le scorciatoie da tastiera:
- **`[G]`**: Miracolo Divino (confermato).
- **`[M]`**: Gestore Mod (confermato).
- **`[Tab]`**: Guida / Taccuino del Naturalista.
- **`[V]`**: Vista telecamera (ciclo Mappa -> Regione -> Animale).
- **`[N]`**: Modalità Notte / Sleep.
- **`[F]` e `[P]`**: Bottoni compatti (Fullscreen e PiP) con icona visiva senza etichetta prolissa, riducendo l'ingombro della barra a meno di 300px.
- **`[Esc]` universale**:
  - Se un modal (ModMenu o FieldGuide) è aperto, lo chiude.
  - Se nessun modal è aperto, apre direttamente il Gestore Mod (`[M]`).
- Tasti rapidi sempre attivi: `[C]` (snapshot fotocamera), `F11` (fullscreen alternativo).

---

## 2. File da toccare

### A. `renderer/src/keybar.ts`
1. In `hintWidth(hint: KeyHint)`:
   - Se `hint.label === ""`, non conteggiare `LABEL_GAP` (la larghezza è data solo dal tasto + eventuale dot).
2. In `paintKeyBar`:
   - Se `hint.label !== ""`, aggiungi `LABEL_GAP` e disegna la label. Se vuota, non aggiungere padding vuoto.
3. In `hintsForState`:
   - Ordina i tasti nella schermata principale:
     ```typescript
     return [
       { id: "guide", key: { kind: "text", text: "Tab" }, label: "Guide" },
       { id: "view", key: { kind: "text", text: "V" }, label: "View" },
       {
         id: "miracle",
         key: { kind: "text", text: "G" },
         label: "Miracle",
         ...(miracleDot === undefined ? {} : { dot: miracleDot }),
       },
       {
         id: "night",
         key: { kind: "text", text: "N" },
         label: "Night",
         dot: sleepMode ? "moon-on" : "moon-off",
       },
       { id: "mods", key: { kind: "text", text: "M" }, label: "Mods" },
       {
         id: "fullscreen",
         key: { kind: "text", text: "F" },
         label: "",
         dot: fullscreen ? "full-on" : "full-off",
       },
       {
         id: "pip",
         key: { kind: "text", text: "P" },
         label: "",
         dot: pip ? "pip-on" : "pip-off",
       },
     ];
     ```

### B. `renderer/src/main.ts`
1. Nel listener `window.addEventListener("keydown", ...)`:
   - Se `event.key === "Escape"`:
     - Se `modMenu.isOpen()`, chiudilo (`modMenu.close()`).
     - Altrimenti se `fieldGuide.open`, chiudilo (`fieldGuide.close()`).
     - Altrimenti (nessun modal aperto), apri il Gestore Mod (`toggleMods()`).

### C. `renderer/tests/camera/fieldguide.test.ts`
1. Nel test `"paints crisp keycaps and adapts hints to open guide tabs"`:
   - Aggiorna l'aspettativa dell'ordine degli ID:
     `["guide", "view", "miracle", "night", "mods", "fullscreen", "pip"]`.
   - Aggiorna il controllo di larghezza: la barra ridisegnata deve essere più stretta di 310 pixel (anziché 380), occupando molto meno spazio a schermo.

---

## 3. Criteri di fatto verificabili

1. `npm --prefix renderer run typecheck` senza errori.
2. `npm --prefix renderer run test` con tutti i 742 test verdi.
3. La barra dei tasti a schermo è snella (meno di 310 px) e ben spaziata.
4. Premendo `Esc` a schermo libero si apre il Gestore Mod.
