#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d themes ]]; then
    echo "[theme-validate] no themes directory yet; skipping until theme manifests land"
    exit 0
fi

if [[ ! -f crates/pmd-core/tests/theme_validate.rs ]]; then
    echo "[theme-validate] themes exist but crates/pmd-core/tests/theme_validate.rs is missing" >&2
    exit 1
fi

cargo test -p pmd-core --test theme_validate -j 2
