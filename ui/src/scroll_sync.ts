import type { EditorView } from "@codemirror/view";

export function attachScrollSync(view: EditorView, preview: HTMLElement) {
  view.dom.addEventListener("scroll", sync);
  view.dom.addEventListener("input", sync);
  function sync() {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head).number;
    const all = preview.querySelectorAll<HTMLElement>("[data-src-start]");
    let chosen: HTMLElement | null = null;
    for (const el of all) {
      const s = +(el.dataset.srcStart!); const e = +(el.dataset.srcEnd!);
      if (s <= line && line <= e) { chosen = el; break; }
      if (s <= line) chosen = el;
    }
    if (chosen) {
      requestAnimationFrame(() => chosen!.scrollIntoView({ block: "start", behavior: "instant" }));
    }
  }
}
