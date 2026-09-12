import { describe, expect, it } from "vitest";
import { mermaidCalls } from "./fake-mermaid.ts";
import { click, flush, mount, query } from "./helpers.ts";

// Diagram previews: the library loads by URL on the first preview, a block
// flips between source and diagram, and a rendered diagram zooms in a dialog.

const LIBRARY = "/tests/client/fake-mermaid.ts";

async function load(
  code = "flowchart LR; A --- B",
  src: string | null = LIBRARY,
) {
  mermaidCalls().initialize.length = 0;
  mermaidCalls().render.length = 0;
  mount(
    '<div data-mermaid><button type="button" data-mermaid-toggle>Preview</button>' +
      `<pre><code class="language-mermaid">${code}</code></pre>` +
      '<div class="mermaid-block" hidden></div></div>',
  );
  if (src !== null) document.body.dataset["mermaidSrc"] = src;
  const { setUpMermaid } = await import("@web/client/mermaid");
  setUpMermaid();
}

/** The library import and the two awaits after it take a few turns. */
async function rendered(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await flush();
}

describe("mermaid previews", () => {
  it("renders on the first preview and flips back to the source", async () => {
    await load();
    click(query("[data-mermaid-toggle]"));
    expect(query(".mermaid-block").textContent).toBe("Rendering diagram...");
    await rendered();
    expect(mermaidCalls().initialize[0]).toEqual(
      expect.objectContaining({ securityLevel: "strict", theme: "default" }),
    );
    expect(query(".mermaid-block svg title").textContent).toBe(
      "flowchart LR; A --- B",
    );
    expect(query(".mermaid-block").hidden).toBe(false);
    expect(query("pre").hidden).toBe(true);
    expect(query("[data-mermaid-toggle]").textContent).toBe("Source");
    click(query("[data-mermaid-toggle]"));
    expect(query("pre").hidden).toBe(false);
    expect(query(".mermaid-block").hidden).toBe(true);
    click(query("[data-mermaid-toggle]"));
    await rendered();
    expect(mermaidCalls().render).toHaveLength(1);
  });

  it("says when the diagram is invalid", async () => {
    await load("graph bad");
    click(query("[data-mermaid-toggle]"));
    await rendered();
    expect(query(".mermaid-block").textContent).toBe("Invalid Mermaid diagram");
    expect(
      query(".mermaid-block").classList.contains("mermaid-block-error"),
    ).toBe(true);
  });

  it("fails the same way when the library was not built", async () => {
    await load("flowchart LR; A --- B", null);
    click(query("[data-mermaid-toggle]"));
    await rendered();
    expect(query(".mermaid-block").textContent).toBe("Invalid Mermaid diagram");
  });

  it("zooms a rendered diagram in a modal", async () => {
    await load();
    click(query("[data-mermaid-toggle]"));
    await rendered();
    click(query(".mermaid-block"));
    const dialog = document.querySelector("dialog[data-modal]");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("no dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("[data-zoom-canvas] svg")).not.toBeNull();
    const readout = () =>
      dialog.querySelector("[data-zoom-readout]")?.textContent;
    click(query('[data-zoom="in"]'));
    expect(readout()).toBe("125%");
    click(query('[data-zoom="out"]'));
    click(query('[data-zoom="out"]'));
    expect(readout()).toBe("75%");
    for (let step = 0; step < 12; step += 1) click(query('[data-zoom="in"]'));
    expect(readout()).toBe("300%");
    click(query('[data-zoom="fit"]'));
    expect(readout()).toBe("100%");
    expect(
      dialog.querySelector<HTMLElement>("[data-zoom-canvas]")?.style.width,
    ).toBe("100%");
    click(query('[data-zoom="close"]'));
    await flush();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
