import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { FileExplorer } = await jiti.import("./FileExplorer.tsx");

test("the file explorer browses without an upload picker", () => {
  const html = renderToStaticMarkup(
    React.createElement(FileExplorer, {
      cwd: "/project",
      onOpenFile() {},
      changesCollapsed: false,
      fileSearchOpen: true,
    }),
  );
  assert.match(html, /Search files/);
  assert.doesNotMatch(html, /type="file"|[Uu]pload/);
});
