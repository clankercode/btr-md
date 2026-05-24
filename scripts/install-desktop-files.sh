#!/usr/bin/env bash
set -euo pipefail
# Install .desktop, MIME XML, icons, metainfo to ~/.local/share/

DESTDIR="${DESTDIR:-}"

install -d "$DESTDIR~/.local/share/applications"
install -d "$DESTDIR~/.local/share/mime/packages"
install -d "$DESTDIR~/.local/share/icons/hicolor"
install -d "$DESTDIR~/.local/share/metainfo"

install -m644 packaging/linux/dev.previewmd.App.desktop "$DESTDIR~/.local/share/applications/"
install -m644 packaging/linux/dev.previewmd.App.mime.xml "$DESTDIR~/.local/share/mime/packages/"
install -m644 packaging/linux/dev.previewmd.App.metainfo.xml "$DESTDIR~/.local/share/metainfo/"

for size in 16 24 32 48 64 128 256; do
  install -d "$DESTDIR~/.local/share/icons/hicolor/${size}x${size}/apps"
  if [ -f "packaging/linux/icons/${size}x${size}.png" ]; then
    install -m644 "packaging/linux/icons/${size}x${size}.png" "$DESTDIR~/.local/share/icons/hicolor/${size}x${size}/apps/dev.previewmd.App.png"
  fi
done

if [ -f packaging/linux/icons/preview-md.svg ]; then
  install -d "$DESTDIR~/.local/share/icons/hicolor/scalable/apps"
  install -m644 packaging/linux/icons/preview-md.svg "$DESTDIR~/.local/share/icons/hicolor/scalable/apps/dev.previewmd.App.svg"
fi

update-desktop-database "$DESTDIR~/.local/share/applications" 2>/dev/null || true
xdg-mime install --mode user packaging/linux/dev.previewmd.App.mime.xml 2>/dev/null || true
gtk-update-icon-cache -t "$DESTDIR~/.local/share/icons/hicolor" 2>/dev/null || true

echo "Desktop files installed to ~/.local/share/"
