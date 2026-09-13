import { Composer } from "@web/views/Composer";
import { buildSync } from "esbuild";
import { Window } from "happy-dom";
import { html } from "hono/html";
import { describe, expect, it } from "vitest";

// Exercise the shipped cascade against the real view. happy-dom resolves
// responsive styles, but native textarea growth still needs a browser check.
const css = buildSync({
  entryPoints: ["src/web/styles/index.css"],
  bundle: true,
  write: false,
  external: ["/static/*"],
}).outputFiles[0]?.text;
if (!css) throw new Error("Stylesheet build produced no CSS");

describe("composer responsive sizing", () => {
  it.each([390, 640, 641, 1280])(
    "keeps the empty input compact only at mobile widths (%ipx)",
    async (width) => {
      const browser = new Window({ width, height: 800 });
      try {
        browser.document.body.innerHTML = `<style>${css}</style>${await html`${Composer({ sessionId: "s1", cwd: "/repo" })}`}`;
        const style = (selector: string) => {
          const element = browser.document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          return browser.getComputedStyle(element);
        };
        const mobile = width <= 640;
        const input = style(".composer-textarea");
        expect(parseFloat(input.minHeight)).toBe(mobile ? 0 : 72);
        expect(parseFloat(input.paddingBottom)).toBe(mobile ? 0 : 10);
        expect(input.fontSize).toBe(mobile ? "16px" : "14px");
        expect(input.maxHeight).toBe("200px");
        expect(input.getPropertyValue("field-sizing")).toBe("content");
        expect(
          browser.document.querySelector("textarea")?.getAttribute("rows"),
        ).toBe("1");
        expect(style(".composer-surface").paddingTop).toBe(
          mobile ? "8px" : "16px",
        );
        expect(style(".composer-toolbar").marginTop).toBe(
          mobile ? "4px" : "6px",
        );
        expect(style(".chat-input").paddingTop).toBe(mobile ? "4px" : "12px");
      } finally {
        await browser.happyDOM.close();
      }
    },
  );
});
