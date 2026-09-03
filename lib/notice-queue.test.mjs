import assert from "node:assert/strict";
import test from "node:test";

const { noticeReducer } = await import("./notice-queue.ts");
const { createClientId } = await import("./client-id.ts");

const empty = { visible: [], pending: [] };

function notice(id) {
  return { id, message: `notice ${id}`, type: "info" };
}

function addAll(state, ids) {
  return ids.reduce((current, id) => noticeReducer(current, { type: "add", notice: notice(id) }), state);
}

function shape(state) {
  return {
    visible: state.visible.map((item) => [item.id, item.exiting === true]),
    pending: state.pending.map((item) => item.id),
  };
}

test("shows up to five notices, then queues the next one behind the oldest", () => {
  const full = addAll(empty, ["1", "2", "3", "4", "5"]);
  assert.deepEqual(shape(full), {
    visible: [["1", false], ["2", false], ["3", false], ["4", false], ["5", false]],
    pending: [],
  });

  const overflow = noticeReducer(full, { type: "add", notice: notice("6") });
  assert.deepEqual(shape(overflow), {
    visible: [["1", true], ["2", false], ["3", false], ["4", false], ["5", false]],
    pending: ["6"],
  });
});

test("queues new notices while one is already leaving instead of marking a second", () => {
  const leaving = noticeReducer(addAll(empty, ["1", "2"]), { type: "mark_oldest_exiting" });
  const next = noticeReducer(leaving, { type: "add", notice: notice("3") });
  assert.deepEqual(shape(next), { visible: [["1", true], ["2", false]], pending: ["3"] });
});

test("marks only the oldest notice that is not already leaving", () => {
  const once = noticeReducer(addAll(empty, ["1", "2", "3"]), { type: "mark_oldest_exiting" });
  const twice = noticeReducer(once, { type: "mark_oldest_exiting" });
  assert.deepEqual(shape(twice), { visible: [["1", true], ["2", true], ["3", false]], pending: [] });
  assert.deepEqual(noticeReducer(empty, { type: "mark_oldest_exiting" }), empty);
});

test("removing a leaving notice promotes queued notices and keeps draining", () => {
  const backlog = addAll(empty, ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(shape(backlog).pending, ["6", "7"]);

  const afterFirst = noticeReducer(backlog, { type: "remove", id: "1" });
  assert.deepEqual(shape(afterFirst), {
    visible: [["2", true], ["3", false], ["4", false], ["5", false], ["6", false]],
    pending: ["7"],
  });

  const afterSecond = noticeReducer(afterFirst, { type: "remove", id: "2" });
  assert.deepEqual(shape(afterSecond), {
    visible: [["3", false], ["4", false], ["5", false], ["6", false], ["7", false]],
    pending: [],
  });
});

test("removing with nothing queued just drops that notice", () => {
  const next = noticeReducer(addAll(empty, ["1", "2"]), { type: "remove", id: "1" });
  assert.deepEqual(next, { visible: [notice("2")], pending: [] });
});

test("notice ids are unique non-empty strings", () => {
  const ids = new Set(Array.from({ length: 50 }, () => createClientId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(typeof id === "string" && id.length > 0);
});
