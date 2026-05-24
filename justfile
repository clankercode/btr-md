default:
    @just --list

# dev
run:
    just build-ui && cargo run -p pmd-app -j 2

build-ui:
    cd ui && npx esbuild src/main.ts --bundle --outfile=dist/bundle.js --format=esm --platform=browser --loader:.css=file

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

e2e-update-baselines:
    ./scripts/e2e.sh --update

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

# install (local desktop integration)
install-desktop:
    ./scripts/install-desktop-files.sh

# lint / format / pre-PR
fmt:
    cargo fmt --all

lint:
    cargo clippy --workspace --all-targets -j 2 -- -D warnings

check:
    just fmt && just lint && just test && just theme-validate
