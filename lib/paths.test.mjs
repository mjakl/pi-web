import assert from "node:assert/strict";
import test from "node:test";

const isWindows = process.platform === "win32";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./paths.ts");
}

test("toNativePath converts git's POSIX output to native separators", async () => {
  const { toNativePath } = await loadSubject();
  if (isWindows) {
    // The regression this guards: `git rev-parse --path-format=absolute` prints
    // `D:/repo` on Windows, which never string-compares equal to a session cwd.
    assert.equal(toNativePath("D:/repo/sub"), "D:\\repo\\sub");
    assert.equal(toNativePath("D:\\repo\\sub"), "D:\\repo\\sub");
  } else {
    assert.equal(toNativePath("/repo/sub"), "/repo/sub");
  }
  assert.equal(toNativePath(""), "");
});

test("samePath ignores separator style and Windows case", async () => {
  const { samePath } = await loadSubject();
  assert.equal(samePath("/a/b", "/a/b"), true);
  assert.equal(samePath("/a/b/", "/a/b"), true, "trailing separators must not matter");
  assert.equal(samePath("/a/./b", "/a/b"), true, "dot segments must not matter");
  assert.equal(samePath("/a/b", "/a/c"), false);
  assert.equal(samePath("", ""), true);
  assert.equal(samePath("", "/a"), false);

  if (isWindows) {
    assert.equal(samePath("D:/repo", "D:\\repo"), true, "separator style must not matter");
    assert.equal(samePath("d:\\repo", "D:\\repo"), true, "drive-letter case must not matter");
    assert.equal(samePath("D:\\Repo\\Sub", "d:/repo/sub"), true);
    assert.equal(samePath("D:\\repo\\", "D:/repo"), true);
    assert.equal(samePath("D:\\repo", "D:\\repo2"), false);
  } else {
    // POSIX is case-sensitive and backslash is a legal filename character.
    assert.equal(samePath("/Repo", "/repo"), false);
    assert.equal(samePath("/a\\b", "/a/b"), false);
  }
});

test("toSlashPath normalizes to forward slashes", async () => {
  const { toSlashPath } = await loadSubject();
  assert.equal(toSlashPath("D:\\repo\\sub"), "D:/repo/sub");
  assert.equal(toSlashPath("/repo/sub"), "/repo/sub");
});

test("isWindowsAbsolutePath recognizes drive and UNC paths", async () => {
  const { isWindowsAbsolutePath } = await loadSubject();
  assert.equal(isWindowsAbsolutePath("D:\\repo"), true);
  assert.equal(isWindowsAbsolutePath("d:/repo"), true);
  assert.equal(isWindowsAbsolutePath("\\\\server\\share"), true);
  assert.equal(isWindowsAbsolutePath("relative/path"), false);
});

test("isAbsolutePath accepts POSIX and Windows absolute paths on any platform", async () => {
  const { isAbsolutePath } = await loadSubject();
  assert.equal(isAbsolutePath("/repo"), true);
  assert.equal(isAbsolutePath("D:\\repo"), true);
  assert.equal(isAbsolutePath("d:/repo"), true);
  assert.equal(isAbsolutePath("\\\\server\\share"), true);
  assert.equal(isAbsolutePath("relative/path"), false);
  assert.equal(isAbsolutePath(""), false);
});

test("pathIdentityKey folds Windows casing, separators, and trailing separators", async () => {
  const { pathIdentityKey } = await loadSubject();

  const expected = pathIdentityKey("C:\\Users\\Alex\\Project\\Study\\ELM", "win32");
  assert.equal(pathIdentityKey("c:/users/ALEX/project/study/elm", "win32"), expected);
  assert.equal(pathIdentityKey("c:\\Users\\Alex\\Project\\Study\\.\\ELM\\", "win32"), expected);
  assert.equal(
    pathIdentityKey("\\\\Server\\Share\\Team\\Agent", "win32"),
    pathIdentityKey("//server/share/team/AGENT/", "win32"),
  );
  assert.equal(
    pathIdentityKey("C:\\Users\\Alex\\.pi\\sessions\\Parent.jsonl", "win32"),
    pathIdentityKey("c:/Users/Alex/.pi/sessions/parent.jsonl", "win32"),
  );
});

test("pathIdentityKey preserves case and backslashes on case-sensitive platforms", async () => {
  const { pathIdentityKey } = await loadSubject();

  assert.notEqual(pathIdentityKey("/Users/Alex/Project", "linux"), pathIdentityKey("/users/alex/project", "linux"));
  assert.notEqual(pathIdentityKey("/a\\b", "linux"), pathIdentityKey("/a/b", "linux"));
  assert.equal(pathIdentityKey("/var/lib/pi/", "linux"), "/var/lib/pi");
  assert.equal(pathIdentityKey("", "linux"), "");
});
