type Mermaid = {
  initialize(config: Record<string, unknown>): void;
  parse(text: string): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
};

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

let loading: Promise<Mermaid> | undefined;
let counter = 0;

function isDark(): boolean {
  return (
    document.documentElement.getAttribute("data-theme")?.includes("dark") ===
    true
  );
}

async function library(): Promise<Mermaid> {
  const source = document.body.dataset["mermaidSrc"];
  if (source === undefined) throw new Error("Diagram support is not built");
  loading ??= (
    import(/* @vite-ignore */ source) as Promise<{ default: Mermaid }>
  ).then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: isDark() ? "dark" : "default",
    });
    return module.default;
  });
  return loading;
}

function zoomDialog(svg: string): void {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  let zoom = 1;
  dialog.innerHTML = `<div class="modal-box max-w-[95vw]">
    <div class="mb-2 flex items-center gap-2">
      <button type="button" class="btn btn-xs" data-zoom="out">−</button>
      <span data-zoom-readout>100%</span>
      <button type="button" class="btn btn-xs" data-zoom="in">+</button>
      <button type="button" class="btn btn-xs" data-zoom="fit">Fit</button>
      <span class="flex-1"></span>
      <button type="button" class="btn btn-xs" data-zoom="close">Close</button>
    </div>
    <div class="overflow-auto" data-zoom-canvas></div>
  </div>`;
  const canvas = dialog.querySelector<HTMLElement>("[data-zoom-canvas]");
  const readout = dialog.querySelector<HTMLElement>("[data-zoom-readout]");
  if (canvas) canvas.innerHTML = svg;
  const apply = () => {
    if (canvas) canvas.style.width = `${String(zoom * 100)}%`;
    if (readout) readout.textContent = `${String(Math.round(zoom * 100))}%`;
  };
  apply();
  dialog.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest("[data-zoom]");
    const kind = action?.getAttribute("data-zoom");
    if (kind === null || kind === undefined) {
      if (event.target === dialog) dialog.close();
      return;
    }
    if (kind === "close") dialog.close();
    else if (kind === "fit") zoom = 1;
    else if (kind === "in") zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP);
    else zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP);
    apply();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}

async function preview(block: HTMLElement): Promise<void> {
  const code = block.querySelector("code")?.textContent ?? "";
  const target = block.querySelector<HTMLElement>(".mermaid-preview");
  const source = block.querySelector<HTMLElement>("pre");
  const button = block.querySelector<HTMLButtonElement>(
    "[data-mermaid-toggle]",
  );
  if (!target || !source || !button) return;
  if (!target.hidden) {
    target.hidden = true;
    source.hidden = false;
    button.textContent = "Preview";
    return;
  }
  source.hidden = true;
  target.hidden = false;
  button.textContent = "Source";
  if (block.dataset["rendered"] === code) return;
  target.textContent = "Rendering diagram...";
  try {
    const mermaid = await library();
    await mermaid.parse(code);
    counter += 1;
    const { svg } = await mermaid.render(`mermaid-${String(counter)}`, code);
    target.innerHTML = svg;
    block.dataset["rendered"] = code;
    target.addEventListener("click", () => {
      zoomDialog(target.innerHTML);
    });
  } catch {
    target.textContent = "Invalid Mermaid diagram";
  }
}

export function setUpMermaid(): void {
  document.body.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest(
      "[data-mermaid-toggle]",
    );
    const block = button?.closest<HTMLElement>("[data-mermaid]");
    if (!block) return;
    void preview(block);
  });
}
