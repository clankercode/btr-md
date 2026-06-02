#!/usr/bin/env bash
set -euo pipefail
# Install the bundled themes to the per-user XDG data dir (todo #2).
#
# A binary placed on PATH by `cargo install` (or `just install`) has no Tauri
# resource directory alongside it, so the app cannot find the themes that ship
# next to a packaged build. find_theme_roots() searches
# $XDG_DATA_HOME/btr-md/themes for exactly this case; populate it here.

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/btr-md/themes"

install -d "$DEST"
cp -R themes/. "$DEST/"

echo "Themes installed to $DEST/"
