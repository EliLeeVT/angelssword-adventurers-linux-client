#!/usr/bin/env bash
# Build, install (user), and export a one-file Flatpak bundle for AS Adventurer.
#
# Usage:
#   ./flatpak/build.sh
#   ./flatpak/build.sh --no-install
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLATPAK_DIR="$ROOT/flatpak"
MANIFEST="$FLATPAK_DIR/studio.angelsword.ASAdventurer.yml"
APP_ID="studio.angelsword.ASAdventurer"
BUILD_DIR="$FLATPAK_DIR/build"
REPO_DIR="$FLATPAK_DIR/repo"
DIST_DIR="$FLATPAK_DIR/dist"
BUNDLE="$DIST_DIR/${APP_ID}.flatpak"
STATE_DIR="$FLATPAK_DIR/.flatpak-builder"
CACHE_DIR="$FLATPAK_DIR/cache"
RUNTIME_VER="24.08"
NODE_VER="22.14.0"
DO_INSTALL=1

for arg in "$@"; do
  case "$arg" in
    --no-install) DO_INSTALL=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

need() { command -v "$1" >/dev/null 2>&1 || die "Missing required tool: $1"; }
need flatpak
need curl
need tar

[[ -f "$ROOT/server.js" && -d "$ROOT/public" ]] || die "Need server.js + public/"
if [[ ! -d "$ROOT/node_modules/express" || ! -d "$ROOT/node_modules/ws" ]]; then
  info "Installing npm deps…"
  (cd "$ROOT" && npm install --omit=dev)
fi
chmod +x "$FLATPAK_DIR/as-adventurer-launcher.sh"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  NODE_ARCH=x64;   FLATPAK_ARCH=x86_64 ;;
  aarch64) NODE_ARCH=arm64; FLATPAK_ARCH=aarch64 ;;
  *) die "Unsupported arch: $ARCH" ;;
esac

NODE_TARBALL="node-v${NODE_VER}-linux-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VER}/${NODE_TARBALL}"

info "Ensuring runtime/SDK ${RUNTIME_VER}…"
if ! flatpak info "org.freedesktop.Platform/${FLATPAK_ARCH}/${RUNTIME_VER}" &>/dev/null; then
  flatpak install -y flathub "org.freedesktop.Platform//${RUNTIME_VER}"
fi
if ! flatpak info "org.freedesktop.Sdk/${FLATPAK_ARCH}/${RUNTIME_VER}" &>/dev/null; then
  flatpak install -y flathub "org.freedesktop.Sdk//${RUNTIME_VER}"
fi

mkdir -p "$CACHE_DIR" "$DIST_DIR" "$REPO_DIR"

# Resolve a flatpak-builder command if available
BUILDER=()
if command -v flatpak-builder >/dev/null 2>&1; then
  BUILDER=(flatpak-builder)
elif flatpak info org.flatpak.Builder &>/dev/null; then
  BUILDER=(flatpak run --command=flatpak-builder --filesystem=home --share=network org.flatpak.Builder)
fi

build_with_builder() {
  info "Building with flatpak-builder…"
  rm -rf "$BUILD_DIR"
  local extra=()
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    extra+=(--user --install)
  fi
  "${BUILDER[@]}" \
    --force-clean \
    --state-dir="$STATE_DIR" \
    --repo="$REPO_DIR" \
    "${extra[@]}" \
    "$BUILD_DIR" \
    "$MANIFEST"
}

build_manual() {
  info "Building manually (flatpak build-init / export)…"
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR"

  if [[ ! -f "$CACHE_DIR/$NODE_TARBALL" ]]; then
    info "Downloading Node ${NODE_VER} (${NODE_ARCH})…"
    curl -fL --progress-bar -o "$CACHE_DIR/$NODE_TARBALL.partial" "$NODE_URL"
    mv "$CACHE_DIR/$NODE_TARBALL.partial" "$CACHE_DIR/$NODE_TARBALL"
  fi

  flatpak build-init \
    "$BUILD_DIR" \
    "$APP_ID" \
    org.freedesktop.Sdk \
    org.freedesktop.Platform \
    "$RUNTIME_VER"

  local FILES="$BUILD_DIR/files"
  mkdir -p "$FILES/bin" "$FILES/share/as-adventurer" \
    "$FILES/share/applications" "$FILES/share/metainfo" \
    "$FILES/share/icons/hicolor/64x64/apps" \
    "$FILES/share/icons/hicolor/128x128/apps" \
    "$FILES/share/icons/hicolor/256x256/apps"

  info "Installing Node…"
  tar -xJf "$CACHE_DIR/$NODE_TARBALL" -C "$CACHE_DIR"
  local NODE_EXTRACT="$CACHE_DIR/node-v${NODE_VER}-linux-${NODE_ARCH}"
  install -Dm755 "$NODE_EXTRACT/bin/node" "$FILES/bin/node"

  info "Installing app (this may take a minute — large assets)…"
  cp -a "$ROOT/server.js" "$ROOT/package.json" "$ROOT/package-lock.json" \
    "$FILES/share/as-adventurer/"
  cp -a "$ROOT/public" "$FILES/share/as-adventurer/"
  cp -a "$ROOT/node_modules" "$FILES/share/as-adventurer/"
  install -Dm755 "$FLATPAK_DIR/as-adventurer-launcher.sh" "$FILES/bin/as-adventurer"
  install -Dm644 "$FLATPAK_DIR/studio.angelsword.ASAdventurer.desktop" \
    "$FILES/share/applications/studio.angelsword.ASAdventurer.desktop"
  install -Dm644 "$FLATPAK_DIR/studio.angelsword.ASAdventurer.metainfo.xml" \
    "$FILES/share/metainfo/studio.angelsword.ASAdventurer.metainfo.xml"
  for s in 64 128 256; do
    install -Dm644 \
      "$FLATPAK_DIR/icons/hicolor/${s}x${s}/apps/studio.angelsword.ASAdventurer.png" \
      "$FILES/share/icons/hicolor/${s}x${s}/apps/studio.angelsword.ASAdventurer.png"
  done

  info "Finishing sandbox permissions…"
  flatpak build-finish "$BUILD_DIR" \
    --command=as-adventurer \
    --share=network \
    --socket=fallback-x11 \
    --socket=wayland \
    --share=ipc \
    --device=dri \
    --talk-name=org.freedesktop.portal.Desktop \
    --talk-name=org.freedesktop.portal.OpenURI

  info "Exporting to local repo…"
  mkdir -p "$REPO_DIR"
  # First-time export creates ostree repo; subsequent updates replace the app
  if [[ ! -d "$REPO_DIR/objects" ]]; then
    ostree init --mode=archive-z2 --repo="$REPO_DIR" 2>/dev/null || true
  fi
  flatpak build-export "$REPO_DIR" "$BUILD_DIR"
}

if [[ ${#BUILDER[@]} -gt 0 ]]; then
  # Builder path — if it fails, fall back to manual
  if ! build_with_builder; then
    info "flatpak-builder failed; falling back to manual build…"
    build_manual
  fi
else
  build_manual
fi

# Install from local repo if builder didn't --install, or manual path
if [[ "$DO_INSTALL" -eq 1 ]]; then
  info "Installing (user scope)…"
  flatpak --user remote-delete --force as-adventurer-local 2>/dev/null || true
  flatpak --user remote-add --if-not-exists --no-gpg-verify \
    as-adventurer-local "file://$REPO_DIR"
  # Refresh remote URL if it already existed with wrong path
  flatpak --user remote-modify --no-gpg-verify \
    --url="file://$REPO_DIR" as-adventurer-local 2>/dev/null || true

  if flatpak info --user "$APP_ID" &>/dev/null; then
    flatpak --user update -y "$APP_ID" || \
      flatpak --user install -y --reinstall as-adventurer-local "$APP_ID"
  else
    flatpak --user install -y as-adventurer-local "$APP_ID"
  fi
fi

info "Creating single-file .flatpak bundle…"
flatpak build-bundle \
  "$REPO_DIR" \
  "$BUNDLE" \
  "$APP_ID" \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo

# When built with org.flatpak.Builder (itself a Flatpak), the exported
# .desktop Exec line can become "/app/bin/flatpak run …", which does not
# exist on the host. Patch exports + install a host menu entry.
fix_desktop_entries() {
  local flatpak_bin host_desktop exported
  flatpak_bin="$(command -v flatpak)"
  [[ -x "$flatpak_bin" ]] || return 0

  # Patch any exported copies that still point inside the Builder sandbox
  while IFS= read -r exported; do
    [[ -f "$exported" ]] || continue
    if grep -q '^Exec=/app/bin/flatpak' "$exported" 2>/dev/null; then
      info "Fixing broken Exec in $exported"
      sed -i "s|^Exec=/app/bin/flatpak|Exec=${flatpak_bin}|" "$exported"
    fi
  done < <(find "${HOME}/.local/share/flatpak" -path "*${APP_ID}*" -name "${APP_ID}.desktop" 2>/dev/null)

  # Host-level launcher (reliable for KDE/GNOME app menus)
  host_desktop="${HOME}/.local/share/applications/${APP_ID}.desktop"
  mkdir -p "$(dirname "$host_desktop")"
  cat >"$host_desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AS Adventurer
GenericName=VTuber Expression Overlay
Comment=Real-time GIFtuber overlay for OBS — face tracking, mic, and emotes
Exec=${flatpak_bin} run ${APP_ID}
Icon=${APP_ID}
Terminal=false
Categories=AudioVideo;Graphics;Network;
Keywords=vtuber;gif;overlay;obs;streaming;face;tracking;
StartupNotify=true
StartupWMClass=ASAdventurer
X-Flatpak=${APP_ID}
EOF
  update-desktop-database "${HOME}/.local/share/applications" 2>/dev/null || true
  kbuildsycoca6 2>/dev/null || kbuildsycoca5 2>/dev/null || true
  info "Desktop entry: $host_desktop"
}

if [[ "$DO_INSTALL" -eq 1 ]]; then
  fix_desktop_entries
fi

echo ""
echo "  ════════════════════════════════════════════════"
echo "   AS Adventurer Flatpak ready"
echo "  ════════════════════════════════════════════════"
echo "   Launch:   flatpak run ${APP_ID}"
echo "   Menu:     “AS Adventurer” in your app launcher"
echo "   Bundle:   ${BUNDLE}"
echo "   Size:     $(du -h "$BUNDLE" | cut -f1)"
echo ""
echo "   Share with friends:"
echo "     flatpak install --user ${APP_ID}.flatpak"
echo "   (needs Flathub org.freedesktop.Platform//${RUNTIME_VER} once)"
echo "  ════════════════════════════════════════════════"
echo ""
