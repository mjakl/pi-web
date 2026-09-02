import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useI18n.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("uses only English messages and clears the retired locale preference", () => {
  assert.match(source, /import \{ enMessages \} from "@\/lib\/i18n\/messages\/en"/);
  assert.match(source, /window\.localStorage\.removeItem\(LOCALE_STORAGE_KEY\)/);
  assert.doesNotMatch(source, /navigator\.language|navigator\.languages|setLocale|supportedLocales/);
  assert.doesNotMatch(source, /document\.documentElement\.lang/);
  assert.match(layoutSource, /<html lang="en"/);
});
