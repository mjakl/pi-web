import { staticAssets } from "@web/assets";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function staticRoot(css: string, js: string): string {
  root = mkdtempSync(join(tmpdir(), "web-pi-static-"));
  writeFileSync(join(root, "app.css"), css);
  writeFileSync(join(root, "client.js"), js);
  return root;
}

describe("static asset URLs", () => {
  it("stamps each asset with a hash of its content", () => {
    const first = staticAssets(staticRoot("a{}", "let a"));
    expect(first.css).toMatch(/^\/static\/app\.css\?v=[0-9a-f]{8}$/);
    expect(first.js).toMatch(/^\/static\/client\.js\?v=[0-9a-f]{8}$/);
    expect(staticAssets(root).css).toBe(first.css);
    expect(staticAssets(staticRoot("b{}", "let a")).css).not.toBe(first.css);
  });

  it("still produces a URL when nothing is built yet", () => {
    expect(staticAssets("/nonexistent")).toEqual({
      css: "/static/app.css?v=dev",
      js: "/static/client.js?v=dev",
      mermaid: "/static/mermaid.js?v=dev",
    });
  });
});
