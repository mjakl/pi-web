import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-lazy-load.ts");
}

test("restores the viewport after prepending content", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  const savedDistance = captureScrollDistance(2000, 500);

  assert.equal(savedDistance, 1500);
  assert.equal(restoreScrollTop(2500, savedDistance), 1000);
});

test("restores top and bottom boundary positions", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 0)), 1000);
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 2000)), 3000);
});

test("distinguishes appended output from prepended history", async () => {
  const { didPrependHistory } = await loadSubject();

  assert.equal(didPrependHistory("first-visible", "first-visible"), false);
  assert.equal(didPrependHistory("first-visible", "older-message"), true);
});

test("keeps live follow attached until the user scrolls away", async () => {
  const { CHAT_SCROLL_TAIL_TOLERANCE, getLiveFollowAttached, isScrollAtTail } = await loadSubject();

  assert.equal(CHAT_SCROLL_TAIL_TOLERANCE, 8);
  assert.deepEqual(
    [392, 391.99, 400].map((scrollTop) => isScrollAtTail(scrollTop, 600, 1000)),
    [true, false, true],
  );
  assert.equal(isScrollAtTail(0, 600, 400), true);

  assert.equal(getLiveFollowAttached(true, 400, 400, 600, 1040), true);
  assert.equal(getLiveFollowAttached(true, 400, 380, 600, 1000), false);
  assert.equal(getLiveFollowAttached(false, 380, 370, 600, 1000), false);
  assert.equal(getLiveFollowAttached(false, 280, 303, 600, 1000), false);
  assert.equal(getLiveFollowAttached(false, 391, 392, 600, 1000), true);
});

test("omits tail while the server default already covers what is loaded", async () => {
  const { getSnapshotTail, SESSION_TAIL_DEFAULT } = await loadSubject();

  assert.equal(getSnapshotTail(0), null);
  assert.equal(getSnapshotTail(1), null);
  assert.equal(getSnapshotTail(SESSION_TAIL_DEFAULT), null);
});

test("asks for the loaded history so a reload does not snap the transcript shut", async () => {
  const { getSnapshotTail, SESSION_TAIL_DEFAULT } = await loadSubject();

  assert.equal(getSnapshotTail(SESSION_TAIL_DEFAULT + 1), SESSION_TAIL_DEFAULT + 1);
  assert.equal(getSnapshotTail(423), 423);
});

test("clamps to the tail the route accepts", async () => {
  const { getSnapshotTail, SESSION_TAIL_MAX } = await loadSubject();

  assert.equal(getSnapshotTail(SESSION_TAIL_MAX), SESSION_TAIL_MAX);
  assert.equal(getSnapshotTail(SESSION_TAIL_MAX + 5000), SESSION_TAIL_MAX);
});
