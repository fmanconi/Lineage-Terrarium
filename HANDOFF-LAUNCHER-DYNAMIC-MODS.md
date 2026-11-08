# HANDOFF — Architettura Mod Dinamiche e Launcher Multipiattaforma

## 1. Obiettivo
Fornire a **Lineage: Terrarium** un'infrastruttura completa e modulare per:
1. **Modding dinamico scalabile**: consentire l'aggiunta e la rimozione di mod utente (grafiche/client e sim/regole) senza dover modificare il codice sorgente o ricompilare il renderer PixiJS ad ogni modifica.
2. **Desktop Launcher Cross-Platform (Windows e Linux)**: un'applicazione locale nativa e leggera per gestire mondi/salvataggi in `data/`, commutare le mod e selezionare il ritmo di simulazione (Fast-Life x90 vs Real-Time 24/7 x1).

Serve agli obiettivi di accessibilità desktop, manutenibilità ed estensibilità della simulazione evolutiva (ADR 0024 esteso, ADR 0025).

---

## 2. Decisioni prese

1. **Cartella Radice Unificata `mods/` (`mods/client` e `mods/sim`)**:
   - *Perché:* Separare nettamente le mod native integrate nel bundle (`renderer/src/mods/builtin/`) dalle mod esterne o create dalla community.
   - *Fonte:* `mods/README.md`.
2. **Caricamento a Runtime via ES Modules (`/api/mods` e `/user-mods/`)**:
   - *Perché:* Il server espone l'elenco delle mod e i relativi file statici con controllo rigoroso contro il path traversal e header `Content-Type: text/javascript`. Il client TypeScript usa `await import(/* @vite-ignore */ mod.entry)` per istanziare e registrare la classe a runtime.
   - *Fonte:* `server/lineage_server/server.py` (linee 345-385) e `renderer/src/mods/loader.ts`.
3. **Launcher Python + `pywebview` con Fallback Browser Loopback**:
   - *Perché:* Massimizza il riuso dell'ambiente Python gestito da `uv`, evitando l'introduzione di nuove toolchain pesanti. Utilizza WebView2 su Windows e WebKitGTK su Linux. Qualora `pywebview` non fosse presente, apre istantaneamente il browser predefinito comunicando con un server locale protetto da token crittografico effimero.
   - *Fonte:* `server/lineage_server/launcher.py` e `server/lineage_server/assets/launcher.html`.
4. **Calcolo Dinamico dell'Anticipo Temporale (`--years-ahead`)**:
   - *Perché:* Le isole salvate risiedono nell'anno simulato 2426; il launcher calcola automaticamente l'offset rispetto alla data reale odierna (400 anni) per garantire continuità temporale.

---

## 3. File Creati e Modificati

| File | Stato | Descrizione |
|---|---|---|
| `mods/README.md` | Nuovo | Documentazione dell'ecosistema mod e specifiche di `mod.json` |
| `mods/client/sample-banner/` | Nuovo | Mod client dimostrativa (`mod.json` e `index.js`) |
| `mods/sim/.gitkeep` | Nuovo | Punto di montaggio per futuri preset di configurazione mondo |
| `server/lineage_server/server.py` | Modificato | Endpoints `/api/mods` e `/user-mods/`, funzione `find_mods()` |
| `server/lineage_server/main.py` | Modificato | Argomento `--mods` collegato a `Server` |
| `server/lineage_server/desktop.py` | Modificato | Supporto a `--mods` e disattivazione `?fast=1` a ritmo x1 |
| `server/lineage_server/launcher.py` | Nuovo | Controller applicativo del launcher, bridge IPC e API mondi/mod |
| `server/lineage_server/assets/launcher.html` | Nuovo | UI pixel art standalone per la selezione mondo, ritmo e mod |
| `Lineage-Launcher.cmd` | Nuovo | Script di avvio per Windows (doppio clic) |
| `deploy/terrarium-launcher.sh` | Nuovo | Script di avvio eseguibile per Linux |
| `renderer/src/mods/loader.ts` | Nuovo | Dynamic loader ES module client per mod esterne |
| `renderer/src/main.ts` | Modificato | Invocazione di `loadUserMods(mods)` all'avvio |
| `renderer/tests/mods/loader.test.ts` | Nuovo | 5 test unitari con mock di fetch e del ModRegistry |
| `server/tests/test_server.py` | Modificato | Test di listing mod e prevenzione path traversal (200 su `.js`, 404 su tentativi non validi) |
| `server/tests/test_launcher.py` | Nuovo | 8 test completi per l'API launcher, bridge browser e spawn processo |

---

## 4. Criteri di Fatto Verificati

- **Suite Renderer**: `npm --prefix renderer test` passa con **747 / 747 test** (100% verde).
- **Suite Server**: `uv run pytest server/tests` passa con **61 passati, 1 saltato** (inclusi tutti i test launcher e mod).
- **Integrazione Git**:
  - Il lavoro è consolidato nel commit `dadc713` (`gemini/launcher-and-dynamic-mods`) e già integrato nel flusso `gemini/terrarium-mods-pack` (`55d5fb8`).
- **Verifica Funzionale dal Vivo**:
  - Launcher eseguito con successo in finestra nativa `pywebview` e testato tramite fallback loopback browser con token effimero.
  - Caricamento dinamico verificato in locale su `sample-banner`.

---

## 5. Domande Aperte e Prossimi Passi

1. **File di Blocco (`.lock`) su `data_dir`**:
   - Aggiungere un meccanismo di mutua esclusione atomico in `desktop.py` in modo che, se un mondo è già in esecuzione in un altro processo (es. PID attivo), il launcher mostri un avviso ed eviti scritture concorrenti sui file `.lzma`.
2. **Evoluzione Tauri v2 (Opzionale)**:
   - Se in futuro si desidera distribuire il gioco ad utenti esterni o su macchine senza Python/uv, l'UI di `launcher.html` potrà essere impacchettata in un binario nativo Tauri (<15 MB) con supporto System Tray nativo.
