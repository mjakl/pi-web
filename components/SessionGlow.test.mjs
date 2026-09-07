import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

test("the unread halo pulses without animating paint or layout properties", async () => {
  const window = new Window();
  try {
    const style = window.document.createElement("style");
    style.textContent = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
    window.document.head.append(style);
    const animation = [...style.sheet.cssRules].find(
      (rule) => rule.name === "session-notification-halo",
    );
    assert.ok(animation);
    assert.equal(animation.cssRules.length, 2);
    for (const frame of animation.cssRules) {
      assert.equal(frame.style.length, 1);
      assert.equal(frame.style.item(0), "opacity");
    }
    assert.deepEqual(
      [...animation.cssRules].map((frame) => frame.style.opacity),
      ["0.25", "1"],
    );
  } finally {
    await window.happyDOM.close();
  }
});
