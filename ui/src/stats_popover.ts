import type { StructureCounts } from "./document_contracts.ts";
import { clampMenuPosition } from "./context_menu.ts";

export interface StatsRow {
  label: string;
  value: string;
}

const WORDS_PER_MINUTE = 200;
const ROW_LABELS = [
  "Words",
  "Bytes",
  "Sentences",
  "Paragraphs",
  "Headings",
  "Links",
  "Images",
  "Code blocks",
  "Mermaid blocks",
  "Math",
  "Reading time",
];

const num = (x: number): string => x.toLocaleString();

export function readingTimeMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.ceil(words / WORDS_PER_MINUTE);
}

export function statsRows(counts: StructureCounts | null): StatsRow[] {
  if (!counts) {
    return ROW_LABELS.map((label) => ({ label, value: "—" }));
  }
  return [
    { label: "Words", value: num(counts.words) },
    { label: "Bytes", value: num(counts.bytes) },
    { label: "Sentences", value: num(counts.sentences) },
    { label: "Paragraphs", value: num(counts.paragraphs) },
    { label: "Headings", value: num(counts.headings) },
    { label: "Links", value: num(counts.links) },
    { label: "Images", value: num(counts.images) },
    { label: "Code blocks", value: num(counts.code_blocks) },
    { label: "Mermaid blocks", value: num(counts.mermaid_blocks) },
    { label: "Math", value: num(counts.math_spans + counts.math_blocks) },
    { label: "Reading time", value: `${readingTimeMinutes(counts.words)} min` },
  ];
}

let openPopoverEl: HTMLElement | null = null;
let removeDismissListeners: (() => void) | null = null;

export function closeStatsPopover(): void {
  removeDismissListeners?.();
  removeDismissListeners = null;
  openPopoverEl?.remove();
  openPopoverEl = null;
}

export function openStatsPopover(
  x: number,
  y: number,
  counts: StructureCounts | null
): void {
  closeStatsPopover();

  const popover = document.createElement("div");
  popover.className = "pmd-dropdown-menu pmd-stats-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Document statistics");

  for (const row of statsRows(counts)) {
    const rowEl = document.createElement("div");
    rowEl.className = "pmd-stats-row";

    const label = document.createElement("span");
    label.className = "pmd-stats-label";
    label.textContent = row.label;

    const value = document.createElement("span");
    value.className = "pmd-stats-value";
    value.textContent = row.value;

    rowEl.append(label, value);
    popover.append(rowEl);
  }

  popover.style.position = "fixed";
  popover.style.visibility = "hidden";
  document.body.appendChild(popover);

  const rect = popover.getBoundingClientRect();
  const { left, top } = clampMenuPosition(
    { x, y },
    { w: rect.width, h: rect.height },
    { w: window.innerWidth, h: window.innerHeight }
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "visible";
  openPopoverEl = popover;

  const dismiss = (ev: Event) => {
    if (ev.type === "mousedown" && popover.contains(ev.target as Node)) return;
    if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Escape") return;
    closeStatsPopover();
  };

  removeDismissListeners = () => {
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", dismiss, true);
  };
  window.addEventListener("mousedown", dismiss, true);
  window.addEventListener("keydown", dismiss, true);
}
