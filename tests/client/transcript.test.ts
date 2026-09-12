import { describe, expect, it, vi } from "vitest";
import {
  byId,
  click,
  device,
  flush,
  htmxEvent,
  mount,
  query,
  setGeometry,
} from "./helpers.ts";

// The transcript's scroll position: following the tail while a turn streams,
// holding still when an older page is prepended, the jump button, and the
// copy buttons and highlighter that run on settled content.

async function load(content = ""): Promise<HTMLElement> {
  mount(
    `<main data-session-id="s1"><div id="log"><div id="messages">${content}</div><div id="turn"></div></div>` +
      '<button type="button" id="jump-to-latest" hidden></button></main>',
  );
  const view = byId("log");
  setGeometry(view, { scrollHeight: 2000, clientHeight: 500 });
  const { setUpTranscript } = await import("@web/client/transcript");
  setUpTranscript();
  return view;
}

describe("following the tail", () => {
  it("starts at the end with the jump button hidden", async () => {
    const view = await load();
    expect(view.scrollTop).toBe(2000);
    expect(byId("jump-to-latest").hidden).toBe(true);
  });

  it("shows the jump button once the reader scrolls up, and stops following", async () => {
    const view = await load();
    view.scrollTop = 1000;
    view.dispatchEvent(new Event("scroll"));
    expect(byId("jump-to-latest").hidden).toBe(false);
    setGeometry(view, { scrollHeight: 2400 });
    htmxEvent(byId("turn"), "htmx:afterSwap");
    expect(view.scrollTop).toBe(1000);
  });

  it("follows again from the end, but only for the log and the turn", async () => {
    const view = await load();
    view.scrollTop = 1000;
    view.dispatchEvent(new Event("scroll"));
    view.scrollTop = 1500;
    view.dispatchEvent(new Event("scroll"));
    expect(byId("jump-to-latest").hidden).toBe(true);
    setGeometry(view, { scrollHeight: 2400 });
    byId("messages").insertAdjacentHTML("beforeend", '<div id="card"></div>');
    htmxEvent(byId("card"), "htmx:afterSwap");
    expect(view.scrollTop).toBe(1500);
    htmxEvent(byId("messages"), "htmx:afterSwap");
    expect(view.scrollTop).toBe(2400);
  });

  it("keeps the reader's place when an older page is prepended", async () => {
    const view = await load('<div class="load-earlier"></div>');
    view.scrollTop = 100;
    view.dispatchEvent(new Event("scroll"));
    htmxEvent(query(".load-earlier"), "htmx:beforeSwap");
    setGeometry(view, { scrollHeight: 3000 });
    htmxEvent(byId("messages"), "htmx:afterSwap");
    expect(view.scrollTop).toBe(1100);
  });

  it("jumps to the end smoothly, or at once for reduced motion", async () => {
    const view = await load();
    const scrollTo = vi.spyOn(view, "scrollTo").mockImplementation(() => {});
    click(byId("jump-to-latest"));
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 2000,
      behavior: "smooth",
    });
    device({ prefersReducedMotion: "reduce" });
    click(byId("jump-to-latest"));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: "auto" });
  });
});

describe("copy buttons", () => {
  it("copies a message and shows Copied for a moment", async () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await load(
      '<div><div data-copy-source>the answer</div><button type="button" data-copy>Copy</button></div>',
    );
    click(query("[data-copy]"));
    await flush();
    expect(write).toHaveBeenCalledWith("the answer");
    expect(query("[data-copy]").textContent).toBe("Copied");
    expect(query("[data-copy]").dataset["copied"]).toBe("1");
    vi.advanceTimersByTime(1500);
    expect(query("[data-copy]").textContent).toBe("Copy");
    expect(query("[data-copy]").dataset["copied"]).toBeUndefined();
  });

  it("keeps a two-icon button's markup and does not open the summary it sits in", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await load(
      "<details><summary><span data-copy-source>x</span>" +
        '<button type="button" data-copy><span data-copy-idle>a</span><span data-copy-done hidden>b</span></button></summary></details>',
    );
    expect(click(query("[data-copy]")).defaultPrevented).toBe(true);
    await flush();
    expect(
      query("[data-copy]").querySelector("[data-copy-idle]"),
    ).not.toBeNull();
    expect(query("[data-copy]").dataset["copied"]).toBe("1");
  });

  it("copies a code block without its line numbers", async () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await load(
      '<div class="markdown-code-block"><button type="button" data-copy-code>Copy</button>' +
        '<pre><code class="language-ts">const a = 1;\nconst b = 2;\n</code></pre></div>',
    );
    click(query("[data-copy-code]"));
    await flush();
    expect(write).toHaveBeenCalledWith("const a = 1;\nconst b = 2;");
  });

  it("does nothing visible when the clipboard refuses", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("no"),
    );
    await load(
      '<div><div data-copy-source>x</div><button type="button" data-copy>Copy</button></div>',
    );
    click(query("[data-copy]"));
    await flush();
    expect(query("[data-copy]").dataset["copied"]).toBeUndefined();
  });
});

describe("highlighting", () => {
  it("colours settled fences with numbered lines and leaves the running turn alone", async () => {
    await load(
      '<pre><code class="language-ts">const a = 1;\nlet b = "x";\n</code></pre>' +
        '<pre><code class="language-nonsense">plain &lt;b&gt;\n</code></pre>',
    );
    byId("turn").innerHTML =
      '<pre><code class="language-ts">streaming</code></pre>';
    htmxEvent(byId("turn"), "htmx:afterSwap");
    const [typed, unknown] =
      document.querySelectorAll<HTMLElement>("#messages code");
    expect(typed?.dataset["highlighted"]).toBe("1");
    expect(typed?.querySelectorAll(".linenumber")).toHaveLength(2);
    expect(typed?.querySelector(".hljs-keyword")).not.toBeNull();
    expect(typed?.style.getPropertyValue("--linenumber-width")).toBe("1.25em");
    expect(unknown?.innerHTML).toContain("plain &lt;b&gt;");
    expect(unknown?.querySelectorAll(".linenumber")).toHaveLength(1);
    expect(query("#turn code").dataset["highlighted"]).toBeUndefined();
  });
});
