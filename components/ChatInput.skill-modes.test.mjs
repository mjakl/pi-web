import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildSlashCommandLayout } = await jiti.import("./ChatInput.tsx");

test("keeps normal slash ordering and includes Manual skill commands", () => {
  const manual = {
    name: "skill:alpha",
    description: "Manual skill",
    source: "skill",
  };
  const modelVisible = {
    name: "skill:beta",
    description: "Model-visible skill",
    source: "skill",
  };
  const builtin = {
    name: "compact",
    description: "Compact",
    source: "builtin",
  };

  const layout = buildSlashCommandLayout(
    [manual, modelVisible, builtin],
    { alpha: true, beta: false },
  );

  assert.deepEqual(
    layout.commands.map((command) => command.name),
    ["compact", "skill:alpha", "skill:beta"],
  );
  assert.deepEqual(
    layout.groups.flatMap((group) => group.items.map((item) => item.index)),
    [0, 1, 2],
  );
});

test("marks only Manual skill commands without muting their names", () => {
  assert.match(source, /const manual = isManualSkillCommand\(command, skillModes\)/);
  assert.match(source, /manual && \([\s\S]*?t\("skills\.mode\.manual"\)/);
  assert.doesNotMatch(source, /color:\s*manual\s*\?/);
});
