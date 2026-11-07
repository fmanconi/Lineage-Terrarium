# Adattamento Lineage per Screensaver Biologico Casalingo ("Smerdino")

> **Attribuzione**: Questo repository è un fork adattato per installazione headless / kiosk da camera, basato sul lavoro originale di **Michele Lisi** ([mlisi1/Lineage](https://github.com/mlisi1/Lineage)). La licenza originale (Apache License 2.0) è integralmente preservata.

---

## 1. Motivazione ed Obiettivi

Nel progetto originale *Lineage*, l'illuminazione dell'isola dipende dalla presenza fisica della persona alla scrivania rilevata tramite un sensore PIR hardware:
- Presenza attiva $\rightarrow$ sorge il sole (1.0).
- Assenza $\rightarrow$ dopo il tramonto cala la notte (`night_light = 0.05`), e dopo lunghe assenze si attesta a un livello di luna (`moonlight = 0.15`).

Per l'installazione su un PC Linux casalingo ("smerdino") adibito a screensaver biologico continuo da camera, questo modello presentava due criticità:
1. Assenza di hardware dedicato (sensore PIR GPIO, tasto God Power su porta seriale/GPIO).
2. Di notte, il display acceso non deve emettere luce forte o disturbare il riposo, ma deve risvegliarsi naturalmente al mattino seguendo il ciclo circadiano del sole reale.

---

## 2. Modifiche Apportate

### A. Ciclo Solare Astronomico Reale (`solar_cycle`)
È stata introdotta in `sim/lineage_sim/presence.py` la modalità `solar_cycle`, configurabile in `sim/config/default.toml` e `sim/config/smerdino.toml` tramite le chiavi:
```toml
[presence]
solar_cycle = true
latitude = 43.7228   # Coordinate approssimate di Pisa (Italia)
longitude = 10.4017  # Fuso Europe/Rome
```

#### Modello di calcolo astronomico:
- Calcola l'elevazione solare locale reale $\alpha$ (in gradi) istante per istante a partire dal timestamp UTC della simulazione (algoritmo standard basato su equazione del tempo e declinazione solare).
- **Notte profonda** ($\alpha \le -6.0^\circ$): luce fissa al minimo notturno (`night_light = 0.05`), con la palette a pixel art del renderer che diventa blu scuro lunare e lo schermo emette pochissima luce.
- **Transizione alba / tramonto** (crepuscolo civile, tra $-6.0^\circ$ e $+6.0^\circ$): la luce sale/scende gradualmente con interpolazione *smoothstep* ($3x^2 - 2x^3$), passando per le palette di luce rosata crepuscolare (dusk) e lilla (dawn).
- **Giorno pieno** ($\alpha \ge +6.0^\circ$): luce a 1.0; le piante fotosintetizzano a pieno ritmo e la fauna diurna è attiva.
- Non richiede dipendenze esterne (solo libreria standard Python `math` e `datetime`).

### B. Esecuzione Server Headless e Disaccoppiamento Hardware
- `lineage_server.main` è stato esteso con i flag:
  - `--solar`: forza l'abilitazione del ciclo solare senza dover modificare file toml a mano.
  - `--headless`: avvia il server come demone in background senza pretendere input da tastiera su `sys.stdin` (usa `FakeDevice` in modo nativo quando `sys.stdin` non è una tty interattiva o in modalità headless).
  - Riconoscimento automatico: se avviato senza `--fake-device` o sotto systemd con `StandardInput=null`, attiva `FakeDevice` in automatico.

### C. Script Kiosk e Systemd per Ubuntu
- **`deploy/smerdino-kiosk.sh`**:
  Script bash per avviare il server in background (con attesa del readiness check su `http://localhost:8080/status`) e lanciare Chromium a schermo intero con flag ottimizzati per kiosk screensaver (`--kiosk`, `--noerrdialogs`, disabilitazione risparmio energetico dei frame su finestre non occluse, disabilitazione throttling background). Alla chiusura con `Ctrl+C` o `SIGTERM`, invia un segnale pulito al server per garantire il salvataggio atomico finale dello stato dell'isola su disco.
- **`deploy/lineage-smerdino-server.service`**: Unit systemd per avviare il simulatore come servizio utente persistente al boot.
- **`deploy/lineage-smerdino-kiosk.service`**: Unit systemd per avviare Chromium a schermo intero nella sessione grafica.

### D. Taccuino delle Specie (`Field Guide`), Regia Screensaver, Miracolo & Barra Tasti
Interfaccia in-game interamente dipinta in pixel art (`512×300` art pixels, font bitmap `pixelfont.ts`, cornici in legno smussato e carta crema come `card.ts`, illuminazione notturna calda `lantern`):
- **Tasto `Tab` o `M` — Taccuino da Naturalista a 3 segnalibri** (con auto-chiusura dopo 15 minuti di inattività):
  1. **`1 Species` (Specie Viventi & Tavola Anatomica)**: censimento live dell'isola (specie vive/estinte, proporzione erbivori/onnivori/predatori) e scheda dettagliata con ritratto procedurale `44×44` (`Portraits`), barre dei geni medi (`Size`, `Diet`, `Speed`, `Armour`, `Water`, `Sense`), icone `7×7` dei geni rari e stato live. Premendo **`Enter`** il taccuino si chiude e la telecamera `local` insegue dal vivo un esemplare sveglio di quella specie.
  2. **`2 Lineage` (Albero Filogenetico)**: cladogramma evolutivo a doppia pagina che traccia i ceppi fondatori, le speciazioni figlie e i rami estinti (`†`).
  3. **`3 Island` (Regia Screensaver, Cielo di Pisa & Miracolo Settimanale)**:
     - **Filosofia 1:1 preservata**: nessun comando di avanzamento rapido o alterazione della velocità sull'isola viva.
     - **Opzioni Screensaver** (salvate in `localStorage`): *Camera Director* (`Rest on Map` dopo 15m vs `Auto-Tour` documentario autonomo `map → middle → local`), *Night Dimmer* (`Normal` / `Soft Dim` / `Dark Room` per attenuare ulteriormente il chiarore notturno in camera da letto), *Key Hint Bar* (`Auto 10s` / `Always` / `Hidden`), *Chronicle Scrolls* (`Shown` / `Quiet`) e *Frame Rate Cap* (`30 FPS` / `60 FPS`).
     - **Miracolo Settimanale (`God Power`, tasto `G` o endpoint `GET/POST /god-power`)**: espone via HTTP locale per il solo desk il pulsante fisico di Lineage con ricarica reale di **7 giorni**, mostrando il conto alla rovescia e i bisogni ecologici dell'isola (`Rain`, `Seed`, `Ark`).
- **Micro-Barra Tasti in basso a destra (`KeyBar`)**: mostra i comandi contestuali con keycap in pixel art (`[V] View`, `[Tab] Guide`, `[G] Miracle`), scomparendo dolcemente dopo 10 secondi di inattività per lasciare il quadro pulito.

---

## 3. Guida all'Installazione su PC Ubuntu ("Smerdino")

### 1. Clonazione e Setup ambiente
```bash
git clone https://github.com/fmanconi/Lineage-Smerdino.git ~/Lineage-Smerdino
cd ~/Lineage-Smerdino

# Installazione dipendenze con uv
uv sync

# Compilazione del renderer per kiosk (richiede Node 22 / npm)
cd renderer && npm ci && npm run build:kiosk && cd ..
```

### 2. Avvio Rapido Kiosk
```bash
chmod +x deploy/smerdino-kiosk.sh
./deploy/smerdino-kiosk.sh
```

### 3. Installazione come Servizio systemd di background
Per far girare il simulatore 24/7 all'avvio del computer:
```bash
mkdir -p ~/.config/systemd/user
cp deploy/lineage-smerdino-server.service ~/.config/systemd/user/

# Abilita il lingering in modo che il servizio giri anche prima del login grafico
loginctl enable-linger $USER

# Avvia e abilita il servizio
systemctl --user daemon-reload
systemctl --user enable --now lineage-smerdino-server.service

# Verifica lo stato
systemctl --user status lineage-smerdino-server.service
curl -s http://localhost:8080/status
```

### 4. Aggiornamenti Automatici da Remoto (mentre il gioco gira)
Se sviluppi o modifichi il codice dal tuo PC principale e vuoi che "smerdino" si aggiorni automaticamente senza interrompere la simulazione o perdere lo stato:

#### Opzione A: Timer automatico (ogni 2 minuti)
```bash
cp deploy/lineage-smerdino-autoupdate.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now lineage-smerdino-autoupdate.timer
```
Il timer verifica periodicamente la presenza di nuovi commit su `origin/main`:
- Se non ci sono novità, non fa nulla.
- Se trova commit: scarica le modifiche, esegue `uv sync` o ricompila `dist-kiosk` solo se necessario, e se il codice Python è cambiato riavvia il server inviando prima `SIGTERM` per preservare il salvataggio atomico del mondo in corso!

#### Opzione B: Aggiornamento manuale su richiesta
Puoi lanciare in qualsiasi momento:
```bash
chmod +x deploy/smerdino-update.sh
./deploy/smerdino-update.sh
```

