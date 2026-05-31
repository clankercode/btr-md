#!/usr/bin/env bash
#
# capture-screenshots.sh — capture placeholder/marketing screenshots of btr.md
# for the AppStream metainfo (<screenshots>).
#
# RUN MANUALLY, LATER. This is NOT part of `just check` and is intentionally not
# executed by CI or the packaging smoke. WebKitGTK has no reliable headless
# screenshot path, so capture is best-effort and assumes a real, on-screen
# `just run` build on a live X11/Wayland session.
#
# It launches the app on a sample markdown document (one that exercises the
# features the captions advertise — tables, code, Mermaid, KaTeX, themes), waits
# for the window to settle, then grabs the active window with whatever screenshot
# tool is available. Output filenames match the <image> URLs in
# packaging/linux/md.btr.app.metainfo.xml:
#
#   screenshots/main.png      live split-view preview
#   screenshots/diagrams.png  Mermaid + KaTeX
#   screenshots/themes.png    theme picker
#
# The generated PNGs are placeholders flagged for replacement with curated
# marketing shots before Flathub / AppStream submission.
#
# Usage:
#   ./scripts/capture-screenshots.sh                 # uses a generated sample doc
#   SAMPLE_DOC=/path/to/doc.md ./scripts/capture-screenshots.sh
#
# Requires (best-effort, auto-detected): one of grim+slurp (Wayland),
# gnome-screenshot, spectacle, or import (ImageMagick / X11). Plus a built
# `btr-md` binary (run `just run` once, or `just build-release`).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/screenshots"
SETTLE_SECS="${SETTLE_SECS:-4}"

mkdir -p "$OUT_DIR"

# --- locate the app binary -------------------------------------------------
BIN=""
for candidate in \
    "$ROOT_DIR/target/release/btr-md" \
    "$ROOT_DIR/target/debug/btr-md" \
    "$(command -v btr-md 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        BIN="$candidate"
        break
    fi
done
if [[ -z "$BIN" ]]; then
    echo "error: no btr-md binary found. Build one first, e.g. 'just build-release' or 'just run'." >&2
    exit 1
fi

# --- sample document -------------------------------------------------------
SAMPLE_DOC="${SAMPLE_DOC:-}"
CLEANUP_DOC=0
if [[ -z "$SAMPLE_DOC" ]]; then
    SAMPLE_DOC="$(mktemp --suffix=.md)"
    CLEANUP_DOC=1
    cat > "$SAMPLE_DOC" <<'MD'
# btr.md — sample document

Fast, secure markdown editing with a live preview.

## Table

| Feature | Status |
| ------- | ------ |
| Preview | yes    |
| Themes  | yes    |

## Code

```rust
fn main() {
    println!("hello, btr.md");
}
```

## Math

$$ e^{i\pi} + 1 = 0 $$

## Diagram

```mermaid
flowchart LR
    A[Edit] --> B[Render] --> C[Preview]
```
MD
fi
cleanup() {
    if [[ "$CLEANUP_DOC" == "1" ]]; then rm -f "$SAMPLE_DOC"; fi
}
trap cleanup EXIT

# --- screenshot tool -------------------------------------------------------
try_shot() {
    local tool="$1"
    local out="$2"
    case "$tool" in
    grim)
        # Wayland: full output (slurp region selection would need interaction).
        grim "$out"
        ;;
    gnome-screenshot)
        gnome-screenshot -w -f "$out"
        ;;
    spectacle)
        spectacle -a -b -n -o "$out"
        ;;
    import)
        # ImageMagick (X11): grab the active window.
        import -window "$(xdotool getactivewindow 2>/dev/null || echo root)" "$out"
        ;;
    esac
}

shoot() {
    # shoot <output-path>: grab the current/active window, best-effort.
    local out="$1"
    local tool
    local found=0

    for tool in grim gnome-screenshot spectacle import; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            continue
        fi
        found=1
        if try_shot "$tool" "$out"; then
            return 0
        fi
        echo "[capture] WARNING: $tool failed; trying next screenshot backend" >&2
    done

    if [[ "$found" == "0" ]]; then
        echo "error: no screenshot tool found (tried grim, gnome-screenshot, spectacle, import)." >&2
    fi
    return 1
}

echo "[capture] launching $BIN on $SAMPLE_DOC"
"$BIN" "$SAMPLE_DOC" &
APP_PID=$!
trap '{ kill "$APP_PID" 2>/dev/null || true; cleanup; }' EXIT

echo "[capture] waiting ${SETTLE_SECS}s for the window to render"
sleep "$SETTLE_SECS"

# NOTE: capturing three *distinct* views (split preview / diagrams / theme
# picker) cannot be fully automated headlessly — the UI state must be driven by
# hand (open the theme picker, scroll to the diagram, etc.). This script grabs
# the default view three times as placeholders; recapture each manually after
# putting the app in the right state, or replace with curated marketing shots.
for name in main diagrams themes; do
    out="$OUT_DIR/$name.png"
    echo "[capture] grabbing $out (placeholder — set the UI state by hand for the real shot)"
    shoot "$out" || echo "[capture] WARNING: failed to capture $name" >&2
    sleep 1
done

echo "[capture] done. Placeholder PNGs in $OUT_DIR/ — replace with curated shots before submission."
