import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { enMessages } = await jiti.import("../lib/i18n/messages/en.ts");

test("keeps skill order within each source group", () => {
  assert.match(source, /grpSkills\.map\(renderSkillRow\)/);
  assert.doesNotMatch(source, /orderSkillsBy/);
});

test("presents Manual skills with normal text and a mode label", () => {
  assert.match(source, /<ConfigSidebarText className="is-grow">/);
  assert.match(source, /manual && \([\s\S]*?className="skill-mode-badge"[\s\S]*?t\("skills\.mode\.manual"\)/);
  assert.doesNotMatch(source, /ConfigSidebarText[^>]*is-muted/);
  assert.doesNotMatch(source, /<ConfigStatusDot/);
  assert.match(cssSource, /\.skill-mode-badge \{/);
});

test("shows positive skill modes and labels each switch action", () => {
  assert.equal(enMessages["skills.mode.modelVisible"], "Model-visible");
  assert.equal(enMessages["skills.mode.manual"], "Manual");
  assert.equal(enMessages["skills.action.switchToManual"], "Switch to Manual");
  assert.equal(enMessages["skills.action.switchToModelVisible"], "Switch to Model-visible");

  assert.match(source, /manual \? t\("skills\.action\.switchToModelVisible"\) : t\("skills\.action\.switchToManual"\)/);
  assert.match(source, /manual \? t\("skills\.mode\.manual"\) : t\("skills\.mode\.modelVisible"\)/);
});
