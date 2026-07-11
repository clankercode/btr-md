default:
    @just --list

# dev
run:
    just build-ui && cargo run -p pmd-app -j 2

build-ui:
    cd ui && npx esbuild src/main.ts --bundle --outdir=dist --entry-names=bundle --splitting --format=esm --platform=browser --loader:.css=file

watch:
    cargo watch -j 2 -x 'run -p pmd-app -j 2'

# tests (layered, fastest first)
build:
    cargo build --workspace -j 2

test:
    cargo test --workspace --exclude pmd-e2e -j 2

test-unit:
    cargo test -p pmd-core --lib -j 2

test-prop:
    cargo test -p pmd-core --test 'prop_*' -j 2

test-golden:
    cargo test -p pmd-core --test golden -j 2

test-theme:
    cargo test -p pmd-core --test 'theme_*' -j 2

test-ipc:
    cargo test -p pmd-app -j 2

e2e:
    ./scripts/e2e.sh

visual-review:
    ./scripts/visual-review.sh

review-and-fix:
    ./scripts/review-and-fix.sh

# themes
theme-list:
    cargo run -p pmd-app -j 2 -- --list-themes

theme-validate:
    ./scripts/theme-validate.sh

# packaging
build-release:
    cargo build --release -p pmd-app -j 2

package-appimage:
    ./scripts/package-appimage.sh

package-flatpak:
    ./scripts/package-flatpak.sh

package-all:
    just package-appimage && just package-flatpak

package-smoke:
    bash -n scripts/package-appimage.sh
    bash -n scripts/package-flatpak.sh
    bash -n scripts/capture-screenshots.sh
    bash -n scripts/install-themes.sh
    bash -n scripts/install-desktop-files.sh
    test -f packaging/linux/btr-md.1
    test -f packaging/flatpak/md.btr.app.yml
    test -d themes

# install (local desktop integration)
install-desktop:
    ./scripts/install-desktop-files.sh

# install bundled themes to ~/.local/share/btr-md/themes (todo #2)
install-themes:
    ./scripts/install-themes.sh

# full local install: build UI, compile + install the btr-md binary to
# ~/.cargo/bin, then install desktop files and themes (todo #2, #3)
install:
    just build-ui
    cargo install --path crates/pmd-app --bin btr-md --jobs 2
    ./scripts/install-desktop-files.sh
    ./scripts/install-themes.sh
    @echo "Installed btr-md to ~/.cargo/bin (ensure it is on your PATH)."

# lint / format / pre-PR
fmt:
    cargo fmt --all

lint:
    cargo clippy --workspace --all-targets -j 2 -- -D warnings

check:
    just fmt
    cargo test --workspace --exclude pmd-e2e -j 2
    cargo clippy --workspace --all-targets -j 2 -- -D warnings
    cargo check -p pmd-e2e --tests -j 2
    # Seam guard: only ui/src/backend/invoke.ts may import raw Tauri invoke.
    ! grep -rnE "from ['\"]@tauri-apps/api/core['\"]" ui/src --include="*.ts" | grep -v "backend/invoke.ts"
    cd ui && npm run typecheck
    cd ui && npm run test:unit
    cd ui && npm run build
    cd ui && npm test
    just theme-validate
    just package-smoke
    if command -v appstreamcli >/dev/null 2>&1; then appstreamcli validate --no-net packaging/linux/md.btr.app.metainfo.xml; else echo "appstreamcli skipped (not installed)"; fi
    if command -v desktop-file-validate >/dev/null 2>&1; then desktop-file-validate packaging/linux/md.btr.app.desktop; else echo "desktop-file-validate skipped (not installed)"; fi
