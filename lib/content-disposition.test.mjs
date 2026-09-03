import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./content-disposition.ts");
}

test("carries the exact file name and an ASCII fallback", async () => {
  const { contentDisposition } = await loadSubject();

  assert.equal(
    contentDisposition("inline", "report.pdf", "download"),
    "inline; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
  );
  assert.equal(
    contentDisposition("attachment", "Übersicht (1)*.html", "session.html"),
    "attachment; filename=\"_bersicht (1)*.html\"; filename*=UTF-8''%C3%9Cbersicht%20%281%29%2A.html",
  );
  assert.equal(
    contentDisposition("attachment", "a\"b;c\\d\r\n.txt", "download"),
    "attachment; filename=\"a_b_c_d__.txt\"; filename*=UTF-8''a%22b%3Bc%5Cd%0D%0A.txt",
  );
});

test("falls back to the caller's name when nothing printable survives", async () => {
  const { contentDisposition } = await loadSubject();

  assert.equal(
    contentDisposition("attachment", "日本語", "session.html"),
    "attachment; filename=\"___\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E",
  );
  assert.equal(
    contentDisposition("inline", "", "download"),
    "inline; filename=\"download\"; filename*=UTF-8''",
  );
});
