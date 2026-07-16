# AS Adventurer → Flathub: first-time guide

This is a practical walkthrough for submitting AS Adventurer to Flathub.
It is **not** “upload the `.flatpak` file.” Flathub rebuilds apps from a
**public manifest + public sources**.

Official docs (bookmark these):

- [Submission](https://docs.flathub.org/docs/for-app-authors/submission)
- [Requirements](https://docs.flathub.org/docs/for-app-authors/requirements)
- [MetaInfo guidelines](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines)
- [App maintenance (after merge)](https://docs.flathub.org/docs/for-app-authors/maintenance)

Help: [Matrix](https://matrix.to/#/#flathub:matrix.org) ·
[Discourse](https://discourse.flathub.org/) ·
[GitHub issues](https://github.com/flathub/flathub/issues)

---

## What success looks like for end users

After Flathub accepts and publishes the app:

```bash
flatpak install flathub <APP_ID>
# or one click in Discover / GNOME Software / Flathub website
```

That **is** simple. Getting there is a review process (often days–weeks).

---

## Honest readiness check (read this first)

| Topic | Your situation today | Flathub expectation |
|--------|----------------------|---------------------|
| Package format | Local `.flatpak` bundle | GitHub PR with **manifest only** (no binaries in the PR) |
| Sources | Folder on your PC | Public **git** or downloadable **archive** URLs |
| App ID | `studio.angelsword.ASAdventurer` | Must match a domain **or** code host you control |
| Homepage | `https://localhost` (placeholder) | Real HTTPS homepage |
| Screenshots | None in metainfo | At least one public image URL |
| License | Proprietary + Leaflit OK | `LicenseRef-proprietary=https://…` + redistributable |
| History | Very new Linux port | Prefer mature projects; brand-new apps can be rejected |
| UI model | Server + system browser | May get questions re “thin web wrapper” policy |
| AI-assisted code | Linux `server.js` was ported with AI help | Flathub **forbids AI-generated app content** (strict policy) |

**Important — Generative AI policy:** Flathub states that applications
containing AI-generated or AI-assisted code are not allowed, and that
submission PRs must not be AI-generated. Reviewers may reject on that basis.
Talk with Leaflit early: she should treat the Linux port as **her** product
(review, own, commit under her project), and **you** should write the PR
description and replies yourself in your own words.

If Flathub rejects on history / AI / “opens a browser,” the backup plan is
still excellent: GitHub Releases with the `.flatpak` + install instructions
(what you already have).

---

## Phase 0 — Decisions with Leaflit (do this first)

Answer these together and write them down:

1. **Who is the official publisher?**
   - **Ideal:** Leaflit / Angel’s Sword Studios as upstream, you help maintain.
   - **Also OK:** Community package with her written permission (metainfo must say it’s community-maintained).

2. **Where is the public source?**
   - GitHub / GitLab / Codeberg repo for the **Linux client** (recommended name something like `as-adventurer`).
   - Tag releases: `v1.0.0`, etc.

3. **What App ID?**

   | If you control… | Example App ID |
   |-----------------|----------------|
   | Domain `angelsword.studio` | `studio.angelsword.ASAdventurer` |
   | GitHub user/org `Leaflit` repo `as-adventurer` | `io.github.Leaflit.as_adventurer` (see Flathub ID rules for underscores) |

   Rules summary: reverse-DNS, ≥3 components, domain must be real HTTPS you control,
   **or** `io.github.<user>.<repo>` matching a public repo.

4. **License text URL**  
   A page or LICENSE file stating redistribution of the Linux client + bundled assets is allowed (Flathub hosting).

5. **Screenshots**  
   1–3 images of Control Panel + OBS overlay (hosted in the git repo or website; use permanent commit/tag URLs, not a moving branch if possible).

6. **Homepage**  
   Even a GitHub Pages / README site is fine.

---

## Phase 1 — Make an upstream project Flathub can build

### 1. Create a public git repository

Suggested layout (keep it clean for reviewers):

```text
as-adventurer/                 # public repo
  server.js
  package.json
  package-lock.json
  public/                      # UI + models (if redistributable)
  flatpak/
    as-adventurer-launcher.sh
    icons/...
  LICENSE                      # or LICENSE.txt + proprietary notice
  README.md
  studio.angelsword.ASAdventurer.metainfo.xml   # or your final APP_ID
  studio.angelsword.ASAdventurer.desktop
```

Do **not** commit: `node_modules/`, `.flatpak-builder/`, `flatpak/build/`,
`flatpak/repo/`, `ASAdventurer.exe`, giant local caches.

### 2. Tag a release

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

Flathub will download that tag/archive by URL.

### 3. Fix metadata (required for Flathub website listing)

Your current metainfo needs upgrades before submission:

- Real `<url type="homepage">` (not localhost)
- Prefer also `bugtracker`, `vcs-browser`
- Modern `<developer id="…"><name>…</name></developer>` (not only developer_name)
- Proprietary license with URL:  
  `LicenseRef-proprietary=https://example.com/license`
- **Screenshots** with public `https://…` image links
- If **community** package: first description paragraph must be bold note:  
  `**This is a community package of AS Adventurer and not officially supported by …**`
- If **you** submit for Leaflit as official: phrase it as official Linux packaging with her blessing

Validate later with:

```bash
flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
  appstream path/to/APP_ID.metainfo.xml
```

### 4. Flathub-style manifest (different from local `type: dir`)

Local builds can use `path: ..`. **Flathub CI cannot.**

You need sources like:

```yaml
sources:
  - type: git
    url: https://github.com/OWNER/as-adventurer.git
    tag: v1.0.0
    commit: <full-sha>
```

or a release tarball URL + sha256.

**npm:** no network during build. Use
[flatpak-builder-tools / flatpak-node-generator](https://github.com/flatpak/flatpak-builder-tools)
to generate an npm sources JSON, and include that file **in the Flathub PR**.
Do not vendor `node_modules` into the Flathub submission PR.

**Node binary:** shipping the official Node.js linux tarball (as we do now) is a
common pattern; reviewers may still ask questions. Document why (small JS app,
official Node builds).

### 5. Build & lint locally (mimic Flathub)

```bash
flatpak install -y flathub org.flatpak.Builder
flatpak remote-add --if-not-exists --user flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo

# From the directory that will become the Flathub PR contents:
flatpak run --command=flathub-build org.flatpak.Builder --install APP_ID.yml
flatpak run APP_ID

flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest APP_ID.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
```

Fix every linter error before opening a PR.

---

## Phase 2 — Open the Flathub submission PR

### Prerequisites

- GitHub account with **2FA** enabled  
- You will write the PR **yourself** (human-written title, body, replies)

### Steps (from Flathub docs)

1. Fork [flathub/flathub](https://github.com/flathub/flathub/fork)  
   **Uncheck** “Copy the master branch only” so you get `new-pr`.

2. Clone your fork’s `new-pr` branch:

   ```bash
   git clone --branch=new-pr git@github.com:YOUR_USER/flathub.git
   cd flathub
   git checkout -b add-as-adventurer new-pr
   ```

3. Put **only** Flathub packaging files at the **root** of that branch, e.g.:

   ```text
   APP_ID.yml                 # main manifest (name must match App ID)
   APP_ID.metainfo.xml        # only if not shipped in upstream tarball
   generated-sources.json     # npm deps, if needed
   flathub.json               # optional: limit arches
   # NO app source tree, NO node_modules, NO .flatpak binary
   ```

4. Commit, push, open a PR against base branch **`new-pr`**  
   (not `master`).  
   Title example: `Add studio.angelsword.ASAdventurer`

5. Wait for human review. Answer every comment.  
   Do **not** close/reopen the PR to “start over.”

6. When reviewers say so, comment: `bot, build`  
   (test build; screenshots won’t appear until official publish)

7. After approval/merge: Flathub creates `github.com/flathub/APP_ID`.  
   Accept the invite within a week. Then you maintain updates there.

---

## Phase 3 — After you’re on Flathub

- New versions: update tag/commit in the **Flathub app repo** manifest, push; CI builds.
- Keep metainfo `<releases>` in sync.
- Runtime upgrades when Freedesktop ships a new stable (e.g. 25.08).
- Security: reply to issues; don’t abandon the app.

---

## Suggested order of work (this week)

1. **Leaflit call** — App ID, official vs community, license page, who owns the repo.  
2. **Public GitHub repo** + tag `v1.0.0` with redistributable tree.  
3. **Homepage + screenshots + license URL.**  
4. **Flathub-ready manifest** (git sources + npm generated sources).  
5. Local `flathub-build` + linter clean.  
6. **You** open the Flathub PR and talk to reviewers.

---

## What I (Grok) can / cannot do

| Can help with | Should be you / Leaflit |
|---------------|-------------------------|
| Drafting technical manifest structure | Writing the Flathub PR text & review replies |
| Metainfo XML shape, linter fixes | Choosing App ID & domain/repo |
| npm source generation commands | Confirming legal redistribution |
| Explaining reviewer comments | Owning the app long-term |

Flathub’s AI policy means **you should be the human submitter**. I’ll help you
prepare packaging files here; you review, understand, and submit them under
your/Leaflit’s names.

---

## Backup if Flathub is slow or rejects

You already have a working path:

```text
~/ASAdventurer/flatpak/dist/studio.angelsword.ASAdventurer.flatpak
```

Publish that on a GitHub Release with:

```bash
flatpak install flathub org.freedesktop.Platform//24.08
flatpak install --user studio.angelsword.ASAdventurer.flatpak
```

Many VTuber tools live happily on GitHub Releases / BOOTH / Discord for years
before (or instead of) Flathub.

---

## Next step for us together

When you’re ready, tell me:

1. Preferred **App ID** (domain-based vs `io.github.…`)  
2. GitHub **username/org + planned repo name**  
3. Whether the listing should say **official** (Leaflit) or **community**  
4. License page URL (or “create a LICENSE in the repo”)

Then we can prepare a Flathub-ready manifest + metainfo against a **real**
public source URL and get a local linter pass before you open the PR.
