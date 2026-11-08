# Lineage: Terrarium as a continuous screensaver (Linux kiosk)

> Lineage: Terrarium is a fork of **Lineage** by **Michele Lisi**
> ([mlisi1/Lineage](https://github.com/mlisi1/Lineage)), Apache License 2.0 (ADR 0025).

This guide turns a small Linux machine with a screen (an old laptop, a mini-PC, a Raspberry
Pi 4/5) into a living window on the island: the server runs the world in real time, 24/7,
and Chromium shows it full screen. No sensors or buttons are needed: daylight follows the
real sun where you live, so the screen is bright by day and a dim moonlit blue at night.

Tested on Debian and Ubuntu; Raspberry Pi OS (Bookworm or later, 64-bit) works the same way.

## 1. What you need

- A 64-bit Linux machine with a desktop session (X11 or Wayland) and a screen.
- `git`, `curl`, [uv](https://docs.astral.sh/uv/) (it brings Python 3.11 by itself), and
  Node.js 22 with `npm` to build the renderer once.
- Chromium (`chromium`, `chromium-browser`) or Google Chrome.

```bash
sudo apt install git curl chromium      # on Ubuntu the package may be chromium-browser
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 2. Install

```bash
git clone https://github.com/fmanconi/Lineage-Terrarium.git ~/Lineage-Terrarium
cd ~/Lineage-Terrarium
uv sync                                          # Python workspace
(cd renderer && npm ci && npm run build:kiosk)   # the scene, into renderer/dist-kiosk
```

The systemd units below expect the repository in `~/Lineage-Terrarium`; if you clone it
elsewhere, change the paths in them.

## 3. Set your place

Open `sim/config/terrarium.toml`, find the `[presence]` section and set your coordinates
(decimal degrees, north and east positive):

```toml
[presence]
solar_cycle = true
latitude = 43.7228
longitude = 10.4017
```

The sun's elevation is computed from UTC and these coordinates, so the time zone of the
machine does not matter. Between −6° and +6° of elevation (civil twilight) the light eases
through dusk and dawn; below −6° the island sleeps in moonlight.

## 4. Try it

```bash
chmod +x deploy/terrarium-kiosk.sh
./deploy/terrarium-kiosk.sh
```

The script starts the server headless, waits for it to answer on
`http://localhost:8080/status`, then opens Chromium in kiosk mode at
`http://localhost:8080/?cap=30` (30 frames a second is plenty and keeps a fanless machine
cool). Quit Chromium (Alt+F4) or press Ctrl+C in the terminal: the server is stopped with
SIGTERM and saves the island before it exits.

Options and environment variables:

| Option | Variable | Default |
|---|---|---|
| `--data DIR` | `LINEAGE_DATA` | `~/lineage-data` (saves and past worlds) |
| `--config FILE` | `LINEAGE_CONFIG` | `sim/config/terrarium.toml` |
| `--port N` | `LINEAGE_PORT` | `8080` |
| `--build` | | rebuild `renderer/dist-kiosk` first |
| `--browser-only` | | only open the kiosk, for a server already running |
| | `LINEAGE_BROWSER` | first of `chromium`, `chromium-browser`, `google-chrome` |

## 5. Run it 24/7 with systemd

Two user units: the island server, which runs from boot even with nobody logged in, and
the kiosk window, which opens when the desktop session starts.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/lineage-terrarium-server.service deploy/lineage-terrarium-kiosk.service \
   ~/.config/systemd/user/
loginctl enable-linger "$USER"              # the server runs without a login
systemctl --user daemon-reload
systemctl --user enable --now lineage-terrarium-server.service
systemctl --user enable --now lineage-terrarium-kiosk.service

systemctl --user status lineage-terrarium-server.service
curl -s http://localhost:8080/status        # world, seed, date, saves, clients
journalctl --user -u lineage-terrarium-server.service -f
```

The kiosk unit sets `DISPLAY=:0` and `XAUTHORITY` for an X11 session. On Wayland
(the default on recent Ubuntu and Raspberry Pi OS), replace those two lines with
`Environment=WAYLAND_DISPLAY=wayland-0` and add `--ozone-platform=wayland` to Chromium's
flags in `deploy/terrarium-kiosk.sh` if the window does not appear. The desktop session
must log in by itself (auto-login) for the kiosk to open after a reboot.

Stopping or restarting the server always saves first (`KillSignal=SIGTERM`, up to 30 s).
The server also saves at every midnight; it keeps the newest save of
each of the last 7 days and the oldest of each month, and every past world forever.

## 6. Keep the screen awake

The desktop's own screensaver and power management must not blank the screen:

- **GNOME / Ubuntu:** Settings → Power → Screen Blank: *Never*; or
  `gsettings set org.gnome.desktop.session idle-delay 0`.
- **X11 in general:** `xset s off -dpms` at session start.
- **Raspberry Pi OS:** `sudo raspi-config` → Display Options → Screen Blanking → *No*.

The island can dim itself instead: press `Tab`, open the *Island* tab and choose a
*Night Dimmer* (`Soft Dim` or `Dark Room`), or press `N` for the super-dark sleep veil at
any hour.

## 7. At the screen

| Key | What it does |
|---|---|
| `V` | step the views: map → region → one animal → map |
| `Tab` | the Naturalist's Field Guide: species, phylogenetic tree, island settings |
| `G` | the god power (once every 7 days; the island picks rain, seed, meteor or ark) |
| `N` | sleep veil on/off |
| `M` | the mod menu (ADR 0024) |

## 8. Watch it from another computer

The server listens on the network too. From any browser on the LAN, open
`http://<machine>:8080/`: the same world, with its own camera and settings. Name the
machine `terrarium` (`sudo hostnamectl set-hostname terrarium`, with `avahi-daemon`
installed for mDNS) and the Windows viewer finds it by itself:

```powershell
.\deploy\windows-sync.ps1            # tries terrarium.local, then terrarium
.\deploy\windows-sync.ps1 -ServerHost 192.168.1.50 -Fullscreen
```

## 9. Update

```bash
cd ~/Lineage-Terrarium
git pull
uv sync
(cd renderer && npm ci && npm run build:kiosk)
systemctl --user restart lineage-terrarium-server.service lineage-terrarium-kiosk.service
```

Or let the machine do it: `deploy/terrarium-update.sh` looks for new commits every two
minutes and, when there are, pulls them, rebuilds what changed and restarts the server and
the kiosk.

```bash
cp deploy/lineage-terrarium-autoupdate.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now lineage-terrarium-autoupdate.timer
```

Saves outlive code: every change to the saved state comes with a migration, so the island
carries on where it was.
