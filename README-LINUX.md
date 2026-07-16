# AS Adventurer — Linux Port

Native Linux server for **AS Adventurer** (Leaflit’s advanced GIFtuber / expression overlay client).

The Windows release ships `ASAdventurer.exe` (a `pkg`-bundled Node app). This port runs the same web UI and protocols with plain Node.js on Linux.

## Requirements

- **Node.js 18+** (20/22 recommended) — *not needed if you use the Flatpak*
- **OBS Studio** (for the transparent overlay)
- Face tracking (optional): **VTube Studio** or **iFacialMocap** on iPhone, or **webcam** via MediaPipe in the browser
- Microphone access in the browser (Control Panel tab must stay open)

## One-click Flatpak (recommended)

Already built and installed on this machine:

```bash
flatpak run studio.angelsword.ASAdventurer
```

Or open **AS Adventurer** from your app menu / launcher. That starts the server and opens the Control Panel. A second click re-opens the panel if the server is already running.

### Shareable `.flatpak` bundle (~191 MB)

```
~/ASAdventurer/flatpak/dist/studio.angelsword.ASAdventurer.flatpak
```

Friends install with:

```bash
flatpak install flathub org.freedesktop.Platform//24.08   # once
flatpak install --user studio.angelsword.ASAdventurer.flatpak
flatpak run studio.angelsword.ASAdventurer
```

Rebuild after code/asset changes:

```bash
cd ~/ASAdventurer && ./flatpak/build.sh
```

## Quick start (without Flatpak)

```bash
cd ~/ASAdventurer
chmod +x start.sh
./start.sh
```

Or manually:

```bash
cd ~/ASAdventurer
npm install
npm start
```

Then open:

| Page | URL |
|------|-----|
| Control Panel | http://localhost:3000 |
| OBS Browser Source | http://localhost:3000/overlay.html |

Optional debug overlay: `http://localhost:3000/overlay.html?debug=1`

## Custom port

```bash
PORT=3001 npm start
```

If 3000 is busy, the server automatically tries the next free port.

## Assets

Character models live under `public/assets/` — same layout as Windows. See `public/assets/README.txt`.

Included models from the release: **Queri**, **Cathelyn**.

## Face tracking

### VTube Studio (iPhone)
1. VTube Studio → Settings → **3rd Party PC Clients** → enable  
2. Control Panel → enter phone IP → **Connect VTS**  
3. Phone and PC on the same LAN  
4. UDP ports: send **21412**, receive **11125**

### iFacialMocap (iPhone)
1. Open iFacialMocap on the phone  
2. Control Panel → enter phone IP → **Connect iFacial**  
3. UDP port **49983**

### Webcam
Use the **Webcam** tab in the Control Panel (MediaPipe runs in the browser; no extra install).

### Microphone
Select a device in the Control Panel and click **Enable Microphone**. Keep that tab open while streaming (OBS cannot access the mic itself).

## Firewall (UDP)

If tracking does not connect, allow inbound UDP on:

- `11125` (VTube Studio receive)
- `21412` (VTube Studio send / keepalive)
- `49983` (iFacialMocap)

Example (firewalld):

```bash
sudo firewall-cmd --add-port=11125/udp --add-port=21412/udp --add-port=49983/udp
```

## Files

| Path | Purpose |
|------|---------|
| `server.js` | Linux/cross-platform Node server |
| `start.sh` | Launcher (installs deps if needed) |
| `public/` | Control panel, overlay, character assets |
| `ASAdventurer.exe` | Original Windows binary (unused on Linux) |
| `Start AS Adventurer.bat` | Original Windows launcher |

## Notes

- HTTP binds to **127.0.0.1** (local only). OBS on the same machine uses `localhost`.
- WebSocket clients are restricted to localhost origins (same as the Windows client).
- Mic and webcam capture happen in the **browser**, not in Node — identical to the Windows design.

## Troubleshooting

**Port in use**  
`PORT=3001 ./start.sh` or stop the other process on 3000.

**Face tracking not connecting**  
Same Wi‑Fi, correct phone IP, PC-client mode enabled, UDP ports open.

**Mic stops when tab is hidden**  
The Control Panel uses a Web Worker so background tabs stay responsive; still keep the tab open.

**Expression flickering**  
Raise **Expression Hold** and thresholds in the Control Panel.
