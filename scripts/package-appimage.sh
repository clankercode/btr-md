#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS_DIR="$ROOT_DIR/build-deps"
APPDIR="$ROOT_DIR/build-appimage/PreviewMd.AppDir"
APPRUN="$ROOT_DIR/build-appimage/AppRun"
DIST_DIR="$ROOT_DIR/dist"
LINUXDEPLOY="$DEPS_DIR/linuxdeploy-x86_64.AppImage"
APPIMAGE_PLUGIN="$DEPS_DIR/linuxdeploy-plugin-appimage-x86_64.AppImage"
OUT="$DIST_DIR/PreviewMd-x86_64.AppImage"

LINUXDEPLOY_URL="${LINUXDEPLOY_URL:-https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage}"
APPIMAGE_PLUGIN_URL="${APPIMAGE_PLUGIN_URL:-https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage}"

download() {
    local url="$1"
    local dest="$2"
    local name="$3"

    if [[ -x "$dest" ]]; then
        return
    fi

    mkdir -p "$DEPS_DIR"
    echo "[appimage] downloading $name"
    if command -v curl >/dev/null 2>&1; then
        curl -fL "$url" -o "$dest" || {
            echo "failed to download $name from $url" >&2
            echo "Set LINUXDEPLOY_URL or APPIMAGE_PLUGIN_URL to a reachable AppImage, or place $dest manually." >&2
            exit 1
        }
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$dest" "$url" || {
            echo "failed to download $name from $url" >&2
            echo "Install curl/wget or place $dest manually." >&2
            exit 1
        }
    else
        echo "curl or wget is required to fetch $name; place it at $dest manually." >&2
        exit 1
    fi
    chmod +x "$dest"
}

install_icons() {
    for icon in "$ROOT_DIR"/packaging/linux/icons/*x*.png; do
        [[ -f "$icon" ]] || continue
        local size
        size="$(basename "$icon" .png)"
        install -Dm644 "$icon" "$APPDIR/usr/share/icons/hicolor/$size/apps/dev.previewmd.App.png"
    done
    install -Dm644 "$ROOT_DIR/packaging/linux/icons/preview-md.svg" \
        "$APPDIR/usr/share/icons/hicolor/scalable/apps/dev.previewmd.App.svg"
    install -Dm644 "$ROOT_DIR/packaging/linux/icons/256x256.png" "$APPDIR/.DirIcon"
}

download "$LINUXDEPLOY_URL" "$LINUXDEPLOY" "linuxdeploy"
download "$APPIMAGE_PLUGIN_URL" "$APPIMAGE_PLUGIN" "linuxdeploy-plugin-appimage"
export PATH="$DEPS_DIR:$PATH"

echo "[appimage] building release binary"
cargo build --release -j 2 -p pmd-app

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/preview-md"
cat > "$APPRUN" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(dirname "$(readlink -f "$0")")"
export APPDIR="$HERE"
exec "$HERE/usr/bin/preview-md" "$@"
EOF
chmod +x "$APPRUN"
install -Dm644 "$ROOT_DIR/packaging/linux/dev.previewmd.App.desktop" \
    "$APPDIR/usr/share/applications/dev.previewmd.App.desktop"
install -Dm644 "$ROOT_DIR/packaging/linux/dev.previewmd.App.metainfo.xml" \
    "$APPDIR/usr/share/metainfo/dev.previewmd.App.metainfo.xml"
install -Dm644 "$ROOT_DIR/packaging/linux/dev.previewmd.App.mime.xml" \
    "$APPDIR/usr/share/mime/packages/dev.previewmd.App.mime.xml"
install -Dm644 "$ROOT_DIR/packaging/linux/preview-md.1" \
    "$APPDIR/usr/share/man/man1/preview-md.1"
cp -a "$ROOT_DIR/themes" "$APPDIR/usr/share/preview-md/themes"
install_icons

mkdir -p "$DIST_DIR"
rm -f "$OUT"
echo "[appimage] preparing AppDir with linuxdeploy"
APPIMAGE_EXTRACT_AND_RUN=1 \
"$LINUXDEPLOY" \
    --appdir "$APPDIR" \
    --desktop-file "$APPDIR/usr/share/applications/dev.previewmd.App.desktop" \
    --icon-file "$APPDIR/usr/share/icons/hicolor/scalable/apps/dev.previewmd.App.svg" \
    --custom-apprun "$APPRUN"

install -Dm755 "$ROOT_DIR/target/release/preview-md" "$APPDIR/usr/bin/preview-md"

echo "[appimage] running linuxdeploy appimage plugin"
LINUXDEPLOY_OUTPUT_VERSION="${VERSION:-0.1.0}" \
LDAI_OUTPUT="$OUT" \
APPIMAGE_EXTRACT_AND_RUN=1 \
"$APPIMAGE_PLUGIN" \
    --appdir "$APPDIR"

if [[ ! -f "$OUT" ]]; then
    echo "linuxdeploy completed but did not produce $OUT" >&2
    exit 1
fi

echo "[appimage] wrote $OUT"
