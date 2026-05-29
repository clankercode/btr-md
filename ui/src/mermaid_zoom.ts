// Fullscreen zoom/pan overlay for rendered mermaid diagrams.
//
// SECURITY: all DOM here is post-sanitize work built via createElement /
// textContent. The only user-derived node is the already-rendered, already-
// sanitized mermaid <svg>; we only clone it (cloneNode) and serialize it for
// download — never re-parse or innerHTML it.

const SCALE_MIN = 0.05;
const SCALE_MAX = 40;
const FIT_MARGIN = 0.9;

export function addMermaidExpandButton(container: HTMLElement): void {
  // Idempotent: a single expand button per container.
  if (container.querySelector(":scope > button.pmd-mermaid-expand")) return;

  const svg = container.querySelector("svg");
  if (!svg) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pmd-mermaid-expand";
  button.textContent = "Expand";
  button.title = "Open diagram in fullscreen viewer";
  button.addEventListener("click", () => {
    // Re-query at click time: re-renders replace the svg node.
    const current = container.querySelector("svg");
    if (current) openMermaidOverlay(current as SVGSVGElement);
  });
  container.appendChild(button);
}

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) {
    return { width: box.width, height: box.height };
  }
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 1, height: rect.height || 1 };
}

function openMermaidOverlay(svg: SVGSVGElement): void {
  // Single instance: a second overlay would stack on the first and leak its
  // document keydown listener (only removed via that overlay's own close()).
  if (document.querySelector(".pmd-mermaid-overlay")) return;

  const { width: natW, height: natH } = naturalSize(svg);

  const overlay = document.createElement("div");
  overlay.className = "pmd-mermaid-overlay";

  const stage = document.createElement("div");
  stage.className = "pmd-mermaid-stage";
  stage.style.transformOrigin = "0 0";

  // Deep clone of the already-sanitized svg, sized to its intrinsic size.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.style.width = `${natW}px`;
  clone.style.height = `${natH}px`;
  clone.style.maxWidth = "none";
  clone.style.display = "block";
  stage.appendChild(clone);
  overlay.appendChild(stage);

  // --- transform state -----------------------------------------------------
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let baseScale = 1;
  let baseTx = 0;
  let baseTy = 0;

  function apply(): void {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function fit(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min((vw * FIT_MARGIN) / natW, (vh * FIT_MARGIN) / natH);
    scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));
    tx = (vw - natW * scale) / 2;
    ty = (vh - natH * scale) / 2;
    baseScale = scale;
    baseTx = tx;
    baseTy = ty;
    apply();
  }

  // --- zoom about pointer ---------------------------------------------------
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.001);
    const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale * factor));
    // Overlay is fixed at 0,0 so clientX/Y are already in stage coordinates.
    const cx = (e.clientX - tx) / scale;
    const cy = (e.clientY - ty) / scale;
    tx = e.clientX - cx * newScale;
    ty = e.clientY - cy * newScale;
    scale = newScale;
    apply();
  }
  stage.addEventListener("wheel", onWheel, { passive: false });

  // --- pointer drag to pan --------------------------------------------------
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  stage.addEventListener("pointerdown", (e: PointerEvent) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    tx = startTx + dx;
    ty = startTy + dy;
    apply();
  });
  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // --- close path -----------------------------------------------------------
  function close(): void {
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener("keydown", onKeydown);

  // Clicking the bare backdrop closes, but only if no drag occurred.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !moved) close();
  });

  // --- controls bar ---------------------------------------------------------
  const controls = document.createElement("div");
  controls.className = "pmd-mermaid-controls";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Reset zoom";
  resetBtn.addEventListener("click", () => {
    scale = baseScale;
    tx = baseTx;
    ty = baseTy;
    apply();
  });

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "Download";
  downloadBtn.title = "Download diagram as SVG";
  downloadBtn.addEventListener("click", () => {
    // Serialize the ORIGINAL svg (already sanitized) for download.
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.title = "Close viewer (Esc)";
  closeBtn.addEventListener("click", close);

  controls.append(resetBtn, downloadBtn, closeBtn);
  overlay.appendChild(controls);

  document.body.appendChild(overlay);
  fit();
}
