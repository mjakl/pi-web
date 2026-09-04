import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-fuzzy.ts");
}

test("distinguishes explicit filesystem paths from project searches", async () => {
  const { isFilePathQuery, buildAtInsertText, extractAtQuery } = await loadSubject();
  for (const query of ["/", "/tmp/no", "~", "~/Documents/", "..", "../", "./src/", "C:\\Users\\", "\\\\server\\share\\"]) {
    assert.equal(isFilePathQuery(query), true, query);
  }
  for (const query of ["", "report", "src/app", ".env", "~report"]) {
    assert.equal(isFilePathQuery(query), false, query);
  }
  const folder = buildAtInsertText("/tmp/my notes", true);
  assert.equal(folder.text, '@"/tmp/my notes/"');
  assert.equal(extractAtQuery(folder.text.slice(0, folder.cursorOffset)).query, "/tmp/my notes/");
  assert.equal(buildAtInsertText("/tmp/my notes/report.txt", false).text, '@"/tmp/my notes/report.txt" ');
});

test("builds closed file mentions and quotes paths containing spaces", async () => {
  const { buildAtMentionText, buildFileAtMentionsText } = await loadSubject();

  assert.equal(buildAtMentionText("notes/todo.md", false), "@notes/todo.md ");
  assert.equal(buildAtMentionText("project files/design brief.md", false), "@\"project files/design brief.md\" ");
  assert.equal(
    buildFileAtMentionsText(["notes/todo.md", "project files/design brief.md"]),
    "@notes/todo.md @\"project files/design brief.md\" ",
  );
});

test("builds line-scoped file mentions", async () => {
  const { buildFileLineMentionText } = await loadSubject();

  assert.equal(buildFileLineMentionText("src/app.ts", 12, 12), "@src/app.ts:12 ");
  assert.equal(buildFileLineMentionText("src/app.ts", 18, 12), "@src/app.ts:12-18 ");
  assert.equal(
    buildFileLineMentionText("project files/app.ts", 3, 9),
    "@\"project files/app.ts\":3-9 ",
  );
  assert.equal(buildFileLineMentionText("src/app.ts", 0, 0), "@src/app.ts:1 ");
});
