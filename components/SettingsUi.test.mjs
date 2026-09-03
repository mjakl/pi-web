import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { shortenPath } = await jiti.import("./SettingsUi.tsx");

test("shortens macOS and Linux home prefixes to ~ and leaves other paths alone", () => {
  assert.equal(shortenPath("/Users/pat/Projects/app"), "~/Projects/app");
  assert.equal(shortenPath("/home/pat"), "~");
  assert.equal(shortenPath("/srv/home/pat/app"), "/srv/home/pat/app");
  assert.equal(shortenPath("C:\\Users\\pat\\app"), "C:\\Users\\pat\\app");
});
