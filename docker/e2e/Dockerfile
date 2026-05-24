FROM rust:bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev libsoup-3.0-dev \
        cage seatd dbus webkit2gtk-driver xauth xvfb xwayland \
        fonts-inter fonts-jetbrains-mono \
        fonts-noto fonts-noto-mono fonts-dejavu \
        fontconfig libfontconfig1-dev \
        pkg-config build-essential \
        libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
        ca-certificates curl imagemagick socat xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Pin fontconfig for screenshot determinism
COPY docker/e2e/fontconfig.conf /etc/fonts/local.conf

# Install tauri-driver
RUN cargo install tauri-driver --locked

RUN useradd --create-home --shell /bin/bash pmd
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Build inputs
WORKDIR /work
COPY . /work
RUN cargo build --release -p pmd-app -j 2

# Determinism env (applied at runtime via cmd, but kept here for clarity)
ENV PATH=/usr/local/cargo/bin:$PATH \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
    WLR_BACKENDS=headless \
    WLR_RENDERER=pixman \
    WLR_LIBINPUT_NO_DEVICES=1 \
    XDG_RUNTIME_DIR=/tmp/preview-md-xdg-runtime

USER pmd

CMD ["bash", "-lc", "mkdir -p \"$XDG_RUNTIME_DIR\" && chmod 700 \"$XDG_RUNTIME_DIR\" && Xvfb :99 -screen 0 1100x720x24 -nolisten tcp & xvfb_pid=$!; export DISPLAY=:99; /usr/local/cargo/bin/tauri-driver --port 4445 --native-port 4446 --native-driver /usr/bin/WebKitWebDriver & driver_pid=$!; socat TCP-LISTEN:4444,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:4445 & proxy_pid=$!; wait -n \"$driver_pid\" \"$proxy_pid\"; status=$?; kill \"$driver_pid\" \"$proxy_pid\" \"$xvfb_pid\" 2>/dev/null || true; exit \"$status\""]
