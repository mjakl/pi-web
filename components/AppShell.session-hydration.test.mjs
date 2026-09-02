import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("invalidates selected-session metadata when its inventory fingerprint changes", () => {
  assert.match(source, /const sameFingerprint = updated\.fileSize !== undefined/);
  assert.match(source, /sameFingerprint \? current\.firstMessage : undefined/);
});

test("clears transient state after the session is persisted", () => {
  assert.match(source, /\{ \.\.\.prev, \.\.\.full, transient: full\.transient \?\? false \}/);
  assert.match(source, /if \(selectedSession\) hydrateSelectedSession\(selectedSession\.id\)/);
});
