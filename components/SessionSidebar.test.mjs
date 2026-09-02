import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes distinct active and running session sets to the shell", () => {
  assert.match(source, /onActiveSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onActiveSessionIdsChange\?\.\(activeSessionIds\)/);
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("background completion becomes unread while stopped sessions stay quiet", () => {
  assert.match(source, /completedInBackground[\s\S]*?activeSessionIds\.has\(id\)/);
  assert.match(source, /completedInBackground\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedInBackground\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(source, /data\.sessions\.map\(\(session\) => session\.id\)/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps in English", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmStop \|\| confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("manual and lifecycle refreshes request a fresh uncached inventory", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("hydrates only observed rows through one bounded serialized batch queue", () => {
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /root,\s*rootMargin: `\$\{SESSION_METADATA_OVERSCAN_PX\}px 0px`/);
  assert.match(source, /slice\(0, SESSION_METADATA_BATCH_SIZE\)/);
  assert.match(source, /metadataRequestRunningRef\.current/);
  assert.match(source, /fetch\("\/api\/sessions\/metadata"/);
  assert.match(source, /setInventoryRevision\(\(revision\) => revision \+ 1\)/);
  assert.match(source, /requeueCurrentBatch\(staleSessionIds\)/);
  assert.match(source, /refreshSessionInventoryRef\.current\(\)/);
  assert.match(sessionItemSource, /data-session-inventory-id=\{session\.id\}/);
});

test("retries a failed metadata batch once per inventory fingerprint", () => {
  assert.match(source, /metadataRetriedFingerprintRef = useRef<Map<string, string>>/);
  assert.match(source, /metadataRetriedFingerprintRef\.current\.get\(session\.id\) === fingerprint/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?drainMetadataQueueRef\.current\(\)/);
  assert.equal((source.match(/scheduleMetadataRetry\(batch\)/g) ?? []).length, 2);
});

test("keeps transcript metadata optional until a row is hydrated", () => {
  assert.match(sessionItemSource, /const storedFirstMessage = session\.firstMessage \?\? ""/);
  assert.match(sessionItemSource, /session\.messageCount === undefined/);
});

test("keeps disk-backed actions hidden while allowing active transient Stop", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{hovered && \(isActive \|\| !session\.transient\) && \(/);
  assert.match(sessionItemSource, /\{!session\.transient && \(/);
  assert.doesNotMatch(
    sessionItemSource.slice(
      sessionItemSource.indexOf("const performStop"),
      sessionItemSource.indexOf("const handleStopClick"),
    ),
    /session\.transient/,
  );
});

test("renders every filtered session with its own activity state", () => {
  assert.match(source, /filteredSessions\.map\(\(session\) => \(/);
  assert.match(source, /isSelected=\{session\.id === selectedSessionId\}/);
  assert.match(source, /isActive=\{activeSessionIds\.has\(session\.id\)\}/);
  assert.match(source, /isRunning=\{runningSessionIds\.has\(session\.id\)\}/);
  assert.match(source, /isUnread=\{unreadSessionIds\.has\(session\.id\)\}/);
});

test("active persisted rows offer Stop with confirmation and Shift bypass", () => {
  assert.match(sessionItemSource, /if \(e\.shiftKey\) void performStop\(\)/);
  assert.match(sessionItemSource, /setConfirmStop\(true\)/);
  assert.match(sessionItemSource, /method: "DELETE"/);
  assert.match(sessionItemSource, /sidebar\.stopSessionWarning/);
  assert.match(sessionItemSource, /\{isActive && \(/);
  assert.match(sessionItemSource, /finally \{\s*setStopping\(false\)/);
});

test("renders lifecycle and unread indicators independently", () => {
  assert.match(sessionItemSource, /isRunning \? <RunningSessionIndicator \/> : isActive \? <ActiveSessionIndicator \/> : <StoppedSessionIndicator \/>/);
  assert.match(sessionItemSource, /\{isUnread && <UnreadSessionIndicator \/>\}/);
});
