# Publishing on GitHub

Flathub is optional. For this project, **GitHub Releases** are the simplest
way to ship Linux builds to friends and the VTuber community.

## One-time repo setup

```bash
cd ~/ASAdventurer

# If not already a git repo:
git init
git add .
git status   # confirm node_modules/ and flatpak/build* are NOT listed
git commit -m "Initial Linux port of AS Adventurer"

# Create an empty repo on GitHub (e.g. as-adventurer-linux), then:
git branch -M main
git remote add origin git@github.com:YOUR_USER/as-adventurer-linux.git
git push -u origin main
```

Coordinate with Leaflit on:

- Repo name / org (match her other AS Adventurer repos if she prefers)
- Whether Windows `.exe` lives here or only on her existing repo
- LICENSE wording if she wants something more formal

## What goes in git vs Releases

| In the git repo | On a GitHub **Release** (attachments) |
|-----------------|----------------------------------------|
| `server.js`, `public/`, `package.json` | `studio.angelsword.ASAdventurer.flatpak` (~191 MB) |
| `start.sh`, `flatpak/*.yml`, icons, docs | Optional: `ASAdventurer.exe` + Windows zip |
| Source anyone can `git clone` | One-click downloads for non-developers |

Do **not** commit `node_modules/`, `flatpak/build/`, `flatpak/repo/`, or `flatpak/dist/`.

## Cutting a Release

```bash
cd ~/ASAdventurer

# 1) Rebuild Flatpak (optional but recommended for each release)
./flatpak/build.sh --no-install   # or full build.sh

# 2) Tag
git tag -a v1.0.0 -m "v1.0.0 — Linux Flatpak + Node port"
git push origin main --tags

# 3) Create a Release on GitHub (web UI or gh CLI) and upload:
#    flatpak/dist/studio.angelsword.ASAdventurer.flatpak
```

### Suggested Release notes (copy/paste)

```markdown
## AS Adventurer — Linux v1.0.0

Real-time GIFtuber / expression overlay for OBS (Linux port of Leaflit's client).

### Flatpak (easiest)

1. Install Flatpak + Flathub if needed
2. Runtime (once):  
   `flatpak install flathub org.freedesktop.Platform//24.08`
3. Install this release asset:  
   `flatpak install --user studio.angelsword.ASAdventurer.flatpak`
4. Run: **AS Adventurer** from your app menu, or  
   `flatpak run studio.angelsword.ASAdventurer`

### From source (Node 18+)

```bash
git clone https://github.com/YOUR_USER/as-adventurer-linux.git
cd as-adventurer-linux
./start.sh
```

Open http://localhost:3000 — OBS Browser Source:  
`http://localhost:3000/overlay.html`

### Windows

Use Leaflit's Windows package / `ASAdventurer.exe` if attached, or her main AS Adventurer repo.
```

## Clone-and-run size note

`public/assets/` is ~167 MB of WebM/models. That is fine for GitHub (no single
file over the 100 MB hard limit). Clones will be large; Releases with only the
`.flatpak` are friendlier for casual users.
