import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { getMessagePreview } = await jiti.import("./message-preview.ts");

test("collapses whitespace without interpreting Markdown or removing Unicode", () => {
  assert.equal(
    getMessagePreview("  **Grüße**\n\t | Name |   😀  "),
    "**Grüße** | Name | 😀",
  );
  assert.equal(getMessagePreview("\n\t   "), "");
});
test("bounds the preview at 100 characters including the ellipsis without splitting Unicode", () => {
  assert.equal(getMessagePreview("a".repeat(100)), "a".repeat(100));
  assert.equal(getMessagePreview("a".repeat(101)), "a".repeat(99) + "…");
  assert.equal(getMessagePreview("😀".repeat(101)), "😀".repeat(99) + "…");
  assert.equal(getMessagePreview("x".repeat(100) + " \n  "), "x".repeat(100));
});
test("combines text blocks and ignores images, including image-only messages", () => {
  const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
  assert.equal(getMessagePreview([image]), "");
  assert.equal(
    getMessagePreview([
      { type: "text", text: "One" },
      image,
      { type: "text", text: "Two\nlines" },
    ]),
    "One Two lines",
  );
});
