#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/packaging/flatpak/md.btr.app.yml"
BUILD_DIR="$ROOT_DIR/build-flatpak"

if ! command -v flatpak-builder >/dev/null 2>&1; then
    echo "flatpak-builder is required to build the Flatpak package." >&2
    echo "Install it with your distribution package manager, then rerun: just package-flatpak" >&2
    exit 1
fi

mkdir -p "$BUILD_DIR"
flatpak-builder --force-clean "$BUILD_DIR" "$MANIFEST"
