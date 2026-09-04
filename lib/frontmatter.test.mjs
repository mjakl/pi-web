import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatFrontmatterValue,
  getFrontmatterTitle,
  parseFrontmatter,
} from "./frontmatter.ts";

describe("parseFrontmatter", () => {
  it("accepts the same common fence variants as remark-frontmatter", () => {
    const cases = [
      "---\ntitle: Demo\n---\nbody",
      "\uFEFF---\ntitle: Demo\n---\nbody",
      "---   \ntitle: Demo\n---\t\nbody",
      "---\r\ntitle: Demo\r\n---\r\nbody",
      "---\rtitle: Demo\r---\rbody",
    ];

    for (const markdown of cases) {
      assert.deepEqual(parseFrontmatter(markdown), { title: "Demo" });
    }
  });

  it("returns null for an empty or malformed fenced block", () => {
    assert.equal(parseFrontmatter("---\n---\nbody"), null);
    assert.equal(parseFrontmatter("---\n[invalid\n---\nbody"), null);
  });

  it("ignores a fence that does not open the document", () => {
    assert.equal(parseFrontmatter("body\n---\ntitle: Not frontmatter\n---"), null);
  });
});

describe("frontmatter value formatting", () => {
  it("does not recurse forever through YAML aliases", () => {
    const data = parseFrontmatter("---\nloop: &loop\n  - *loop\n---\n");
    assert.ok(data);
    assert.equal(formatFrontmatterValue(data.loop), "[Circular]");
  });

  it("uses scalar titles and leaves structured titles for the metadata rows", () => {
    assert.equal(getFrontmatterTitle("  Demo  "), "Demo");
    assert.equal(getFrontmatterTitle(1984), "1984");
    assert.equal(getFrontmatterTitle(false), "false");
    assert.equal(getFrontmatterTitle(["Demo"]), null);
  });
});
