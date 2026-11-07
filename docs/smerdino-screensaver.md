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

---

## 3. Guida all'Installazione su PC Ubuntu ("Smerdino")

### 1. Clonazione e Setup ambiente
```bash
git clone https://github.com/fmanconi/Lineage.git ~/Lineage-Smerdino
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
