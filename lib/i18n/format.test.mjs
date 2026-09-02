import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatRelativeTime, formatTimestamp, interpolateMessage, translateMessage } = await createJiti(import.meta.url).import("./format.ts");

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("Hello, {name} ({count})", { name: "Pi", count: 2 }), "Hello, Pi (2)");
});

test("returns the key when an English message is missing", () => {
  assert.equal(translateMessage("common.ok"), "OK");
  assert.equal(translateMessage("missing.key"), "missing.key");
});

test("formats relative time in English", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), now), "in 5 minutes");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), now), "1 hour ago");
});

test("formats message timestamps in English with a 24-hour clock", () => {
  const now = new Date(2026, 0, 1, 13, 30);
  assert.equal(formatTimestamp(new Date(2026, 0, 1, 13, 5).getTime(), now), "13:05");
  assert.equal(formatTimestamp(new Date(2025, 11, 31, 23, 5).getTime(), now), "Dec 31, 2025 23:05");
});
