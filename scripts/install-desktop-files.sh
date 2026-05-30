#!/usr/bin/env bash
set -euo pipefail
# Install .desktop, MIME XML, icons, metainfo to ~/.local/share/

PREFIX="${DESTDIR:-$HOME}"
SHARE_DIR="$PREFIX/.local/share"

install -d "$SHARE_DIR/applications"
install -d "$SHARE_DIR/mime/packages"
install -d "$SHARE_DIR/icons/hicolor"
install -d "$SHARE_DIR/metainfo"

install -m644 packaging/linux/md.btr.app.desktop "$SHARE_DIR/applications/"
install -m644 packaging/linux/md.btr.app.mime.xml "$SHARE_DIR/mime/packages/"
install -m644 packaging/linux/md.btr.app.metainfo.xml "$SHARE_DIR/metainfo/"

for size in 16 24 32 48 64 128 256; do
  install -d "$SHARE_DIR/icons/hicolor/${size}x${size}/apps"
  if [ -f "packaging/linux/icons/${size}x${size}.png" ]; then
    install -m644 "packaging/linux/icons/${size}x${size}.png" "$SHARE_DIR/icons/hicolor/${size}x${size}/apps/md.btr.app.png"
  fi
done

if [ -f packaging/linux/icons/btr-md.svg ]; then
  install -d "$SHARE_DIR/icons/hicolor/scalable/apps"
  install -m644 packaging/linux/icons/btr-md.svg "$SHARE_DIR/icons/hicolor/scalable/apps/md.btr.app.svg"
fi

update-desktop-database "$SHARE_DIR/applications" 2>/dev/null || true
xdg-mime install --mode user packaging/linux/md.btr.app.mime.xml 2>/dev/null || true
gtk-update-icon-cache -t "$SHARE_DIR/icons/hicolor" 2>/dev/null || true

echo "Desktop files installed to $SHARE_DIR/"
