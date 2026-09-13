import type { LiveStatus } from "@core/ports";
import {
  EarlierPage,
  Item,
  type ItemActions,
  Items,
  LoadEarlier,
  StarButton,
  ToolBody,
  TurnFragment,
} from "@web/views/Items";
import { HistoryActionButtons } from "@web/views/transcript/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  answerItem,
  fixtureCalls,
  liveItems,
  settledItems,
} from "./fixtures/transcript-items.ts";

// The transcript is a pixel port of pi-web, so its markup is pinned: every
// public view renders the fixture items and the result has to match
// fixtures/transcript-items.html byte for byte. A change to the markup
// updates the fixture on purpose (`vitest -u`), never by accident.

const actions: ItemActions = {
  sessionId: "s1",
  cwd: "/repo/one",
  starred: new Set(["a2"]),
};

const status: LiveStatus = {
  running: true,
  compacting: false,
  bashRunning: false,
  streaming: { tokens: 42, tokensPerSecond: 12.34 },
  model: null,
  thinkingLevel: "off",
  thinkingLevels: [],
  contextTokens: null,
  queue: [],
  compaction: null,
  compactionError: null,
  tools: [
    { id: "call-running", name: "grep", progress: "3 files" },
    { id: "call-sub4", name: "subagent", progress: "reading" },
  ],
  retry: null,
  hasSystemPrompt: false,
  hasActiveTools: false,
  statuses: {},
  widgets: [],
  dialog: null,
  custom: null,
  title: null,
  editorText: [],
  notices: [],
};

const html = (node: unknown) => String(node);

function render(label: string, node: unknown): string {
  return `<!-- ${label} -->\n${html(node)}\n`;
}

describe("transcript items", () => {
  beforeAll(() => {
    // Times render in the reader's zone and say "today" relative to now;
    // both are pinned so the fixture reads the same on every machine.
    vi.useFakeTimers({
      now: new Date("2026-01-05T15:00:00.000Z"),
      toFake: ["Date"],
    });
    // Pin the calendar-day comparison as well as the displayed text. A UTC
    // timestamp near midnight can otherwise be "today" only on this host.
    vi.spyOn(Date.prototype, "getFullYear").mockImplementation(
      function (this: Date) {
        return this.getUTCFullYear();
      },
    );
    vi.spyOn(Date.prototype, "getMonth").mockImplementation(
      function (this: Date) {
        return this.getUTCMonth();
      },
    );
    vi.spyOn(Date.prototype, "getDate").mockImplementation(
      function (this: Date) {
        return this.getUTCDate();
      },
    );
    // The options the views pass name every component, so Intl's format is
    // what the locale methods return, minus the reader's zone.
    const utc = (locale: unknown, options: unknown) =>
      new Intl.DateTimeFormat(locale as string, {
        ...(options as Intl.DateTimeFormatOptions),
        timeZone: "UTC",
      });
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(
      function (this: Date, locale, options) {
        return utc(locale, options).format(this);
      },
    );
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(
      function (this: Date, locale, options) {
        return utc(locale, options).format(this);
      },
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders every view of the fixture exactly as pinned", async () => {
    const html = [
      render(
        "settled, grouped",
        <Items items={settledItems} actions={actions} />,
      ),
      render(
        "settled, read-only",
        <Items items={settledItems} actions={{ ...actions, readOnly: true }} />,
      ),
      render("settled, no actions", <Items items={settledItems} />),
      render(
        "running turn",
        <TurnFragment items={liveItems} actions={actions} status={status} />,
      ),
      render(
        "finished turn",
        <TurnFragment
          items={liveItems}
          actions={actions}
          status={{ ...status, running: false, tools: [], streaming: null }}
        />,
      ),
      render(
        "shell running",
        <TurnFragment
          items={liveItems}
          actions={actions}
          status={{ ...status, running: false, bashRunning: true, tools: [] }}
        />,
      ),
      render(
        "no status",
        <TurnFragment items={liveItems} actions={actions} status={null} />,
      ),
      render(
        "earlier page, busy",
        <EarlierPage
          items={settledItems.slice(0, 3)}
          actions={{ ...actions, busy: true }}
          hasMore
          oldestId="u1"
          leaf="a5"
        />,
      ),
      render(
        "last page",
        <EarlierPage
          items={settledItems.slice(0, 1)}
          actions={actions}
          hasMore={false}
        />,
      ),
      render("load earlier", <LoadEarlier sessionId="s1" before="u1" />),
      render("star", <StarButton entryId="a2" actions={actions} />),
      render("unstarred", <StarButton entryId="a1" actions={actions} />),
      render(
        "tool body, budgeted",
        <ToolBody call={fixtureCalls.longTextCall} actions={actions} />,
      ),
      render(
        "tool body, full",
        <ToolBody call={fixtureCalls.longTextCall} actions={actions} full />,
      ),
      render(
        "diff body, no actions",
        <ToolBody call={fixtureCalls.editCall} />,
      ),
      render(
        "lone item, starrable with written files",
        <Item
          item={answerItem}
          actions={actions}
          starrable
          written={["/repo/one/src/app.ts"]}
        />,
      ),
    ].join("");
    await expect(html).toMatchFileSnapshot("./fixtures/transcript-items.html");
  });

  it("uses the branch and plus icons for history actions", () => {
    const buttons = html(
      <HistoryActionButtons entryId="a1" actions={actions} />,
    );

    expect(buttons).toMatch(
      /aria-label="New branch"[\s\S]*?<path d="M6 3v12M18 9a9 9 0 0 1-9 9"><\/path>[\s\S]*?New branch/,
    );
    expect(buttons).toMatch(
      /title="New session[^>]*>[\s\S]*?<svg width="11" height="11" viewBox="0 0 12 12"[\s\S]*?<line x1="6" y1="1" x2="6" y2="11"><\/line>[\s\S]*?New session/,
    );
  });

  it("cuts a long diff to the row budget, whole files first", () => {
    const cut = html(
      <ToolBody call={fixtureCalls.longDiffCall} actions={actions} />,
    );
    // 210 rows in the first file: 200 kept, and the second file is dropped
    // rather than shown as a torso.
    expect(cut.match(/display:contents/g)).toHaveLength(200);
    expect(cut).not.toContain("src/tail.ts");
    expect(cut).toContain("view full output");
    const full = html(
      <ToolBody call={fixtureCalls.longDiffCall} actions={actions} full />,
    );
    expect(full.match(/display:contents/g)).toHaveLength(211);
    expect(full).toContain("src/tail.ts");
    expect(full).not.toContain("view full output");
  });
});
