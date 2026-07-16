# 🎭 AS Adventurer

A real-time streaming overlay that changes character expressions based on
**facial tracking** and **voice detection**. Designed for OBS Studio.

**Upstream / Windows client:** Leaflit (Angel's Sword Studios)  
**Linux port:** Node server + optional Flatpak (this tree)

## Download (recommended)

Prefer **GitHub Releases** over cloning if you only want to run the app:

| Platform | What to get |
|----------|-------------|
| **Linux (easiest)** | `studio.angelsword.ASAdventurer.flatpak` from [Releases](../../releases) |
| **Linux (from source)** | Clone this repo, then `./start.sh` |
| **Windows** | Leaflit's Windows package / `ASAdventurer.exe` |

### Linux Flatpak install

```bash
# Once: Freedesktop runtime from Flathub
flatpak install flathub org.freedesktop.Platform//24.08

# Install the .flatpak you downloaded from Releases
flatpak install --user studio.angelsword.ASAdventurer.flatpak

# Launch from your app menu, or:
flatpak run studio.angelsword.ASAdventurer
```

### Linux from source

```bash
git clone https://github.com/EliLeeVT/angelssword-adventurers-linux-client.git
cd angelssword-adventurers-linux-client
./start.sh         # installs npm deps if needed, starts the server
```

Open **http://localhost:3000** (Control Panel).  
OBS Browser Source: **http://localhost:3000/overlay.html**

More detail: [README-LINUX.md](README-LINUX.md) · publishing: [GITHUB-RELEASE.md](GITHUB-RELEASE.md)

## Quick Start

### Windows
1. **Extract** the folder anywhere on your PC
2. **Double-click** `Start AS Adventurer.bat`
3. **Open** http://localhost:3000 in your browser (the Control Panel)
4. **Add a Browser Source** in OBS pointing to `http://localhost:3000/overlay.html`

> Windows Firewall may prompt you to allow network access — click **Allow**.

### Linux
1. Prefer the **Flatpak** from Releases (above), **or** install **Node.js 18+**
2. From this folder run: `./start.sh`  (or `npm install && npm start`)
3. **Open** http://localhost:3000 in your browser (the Control Panel)
4. **Add a Browser Source** in OBS pointing to `http://localhost:3000/overlay.html`

## Requirements

- **Windows 10/11** (64-bit) **or Linux** (Flatpak *or* Node.js 18+)
- **OBS Studio** (for streaming)
- **VTube Studio** on iPhone, OR **iFacialMocap** (for facial tracking)

## Adding Your Character

Place your character sprites/animations in the `public/assets/` folder.
See `public/assets/README.txt` for the full file naming guide.

### Minimum Files Needed

| File | What it does |
|:-----|:-------------|
| `neutral_idle.webm` | Default resting state |
| `neutral_speaking.webm` | Talking, neutral expression |

### Optional Expression States

| File | What it does |
|:-----|:-------------|
| `happy_idle.webm` / `happy_speaking.webm` | Smiling |
| `sad_idle.webm` / `sad_speaking.webm` | Frowning |
| `surprised_idle.webm` / `surprised_speaking.webm` | Surprised |
| `eyes_closed.webm` | Eyes shut for 1.5+ seconds |
| `typing.webm` | Keyboard typing animation |

Supported formats: `.webm`, `.webp`, `.gif`, `.png`, `.mp4`

## Connecting Face Tracking

### VTube Studio (iPhone)
1. Open **VTube Studio** → **Settings** → **3rd Party PC Clients** → Enable
2. In the Control Panel, enter your iPhone's IP and click **Connect VTS**
3. Phone and PC must be on the same WiFi network

### iFacialMocap (iPhone)
1. Open **iFacialMocap** on your iPhone
2. In the Control Panel, enter your iPhone's IP and click **Connect iFacial**

## Enabling Microphone

1. In the Control Panel, select your mic from the dropdown
2. Click **Enable Microphone**
3. Keep the Control Panel tab open while streaming

## Control Panel Features

- **Expression thresholds** — tune smile/frown/surprise sensitivity
- **Speaking hold** — how long to maintain talking animation (helps with stuttering)
- **Expression hold** — how long to stay in an expression before reverting
- **Emote triggers** — click to play emotes and sub-animations
- **Live monitoring** — see real-time expression scores

## OBS Setup

1. Add a **Browser Source** in OBS
2. URL: `http://localhost:3000/overlay.html`
3. Set width/height to match your character dimensions
4. Background is transparent by default

### Debug Mode
Add `?debug=1` to see live state info:
```
http://localhost:3000/overlay.html?debug=1
```

## Ports Used

| Port | Protocol | Purpose |
|:-----|:---------|:--------|
| 3000 | HTTP/WS | Web server + WebSocket |
| 21412 | UDP | VTube Studio (send) |
| 11125 | UDP | VTube Studio (receive) |
| 49983 | UDP | iFacialMocap |

## Troubleshooting

**Face tracking not connecting?**
- Ensure your iPhone app has PC client mode enabled
- Phone and PC must be on the same network
- Windows Firewall may prompt you — click Allow

**Mic stops working?**
- Keep the Control Panel browser tab open
- Select the correct device from the mic dropdown

**Expression flickering?**
- Increase the Expression Hold slider
- Raise the sensitivity thresholds
