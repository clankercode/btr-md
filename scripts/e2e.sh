#!/usr/bin/env bash
# scripts/e2e.sh — run the WebDriver smoke / screenshot suite inside the
# Docker e2e harness. See spec §9 (E2E driver setup) for the rationale.
#
# Networking:
#   PMD_E2E_NETWORK=bridge  (default) use Docker's default bridge with
#                           -p 4444:4444; this avoids host abstract X11 socket
#                           collisions while the container runs Xwayland.
#   PMD_E2E_NETWORK=host    container shares the host net stack; useful only
#                           when Docker port publishing is unavailable.
#
# In both modes we poll http://localhost:4444/status until tauri-driver is
# accepting connections, then run `cargo test -p pmd-e2e` from the host.
set -euo pipefail

NETWORK_MODE="${PMD_E2E_NETWORK:-bridge}"
case "$NETWORK_MODE" in
    host)
        NET_ARGS=(--network=host)
        ;;
    bridge)
        NET_ARGS=(--network=bridge -p 4444:4444)
        ;;
    *)
        echo "PMD_E2E_NETWORK must be host|bridge (got: $NETWORK_MODE)" >&2
        exit 2
        ;;
esac

echo "[e2e] building Docker image btr-md-e2e:dev (includes release app)"
docker build -f docker/e2e/Dockerfile -t btr-md-e2e:dev .

mkdir -p tests/screenshots/run-smoke

RUN_ARGS=(
    "${NET_ARGS[@]}"
    -v "$PWD/tests:/work/tests"
    -v "$PWD/ui:/work/ui:ro"
)

if [[ -d themes ]]; then
    RUN_ARGS+=(-v "$PWD/themes:/work/themes:ro")
fi

echo "[e2e] starting container (network=$NETWORK_MODE)"
CID=$(docker run -d --rm "${RUN_ARGS[@]}" btr-md-e2e:dev)

cleanup() {
    echo "[e2e] stopping container $CID"
    docker logs "$CID" 2>&1 | tail -n 80 || true
    docker stop "$CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[e2e] waiting for tauri-driver on http://localhost:4444/status"
for attempt in $(seq 1 60); do
    if curl --max-time 2 -sf http://localhost:4444/status >/dev/null; then
        echo "[e2e] tauri-driver is up (after ${attempt} poll(s))"
        break
    fi
    if [[ "$attempt" == "60" ]]; then
        echo "[e2e] tauri-driver did not become ready within 30s" >&2
        exit 1
    fi
    sleep 0.5
done

echo "[e2e] running pmd-e2e test suite"
# Serialize hard: tauri-driver allows only one active session. Use cargo -j 1 so
# integration test binaries do not overlap, and --test-threads=1 within each.
PMD_E2E_CONTAINER_ID="$CID" cargo test -p pmd-e2e -j 1 -- --nocapture --test-threads=1
