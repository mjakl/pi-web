import type { ExtensionWidget } from "@core/ports";
import {
  type ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";

/** A theme that applies no colours: extensions may read it, nothing draws it. */
class PlainTextTheme extends Theme {
  constructor() {
    super(
      {
        text: "",
        muted: "",
        thinkingXhigh: "",
        searchMatchText: "",
      } as ConstructorParameters<typeof Theme>[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string {
    return text;
  }
  override bg(...[, text]: Parameters<Theme["bg"]>): string {
    return text;
  }
  override bold(text: string): string {
    return text;
  }
  override italic(text: string): string {
    return text;
  }
  override underline(text: string): string {
    return text;
  }
  override inverse(text: string): string {
    return text;
  }
  override strikethrough(text: string): string {
    return text;
  }
  override getFgAnsi(): string {
    return "";
  }
  override getBgAnsi(): string {
    return "";
  }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string {
    return (text) => text;
  }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();

export type HeadlessUiSink = {
  notify(level: "info" | "warning" | "error", message: string): void;
  setStatus(key: string, text: string | undefined): void;
  /** `undefined` removes the widget; an empty array keeps an inert chip. */
  setWidget(
    key: string,
    lines: string[] | undefined,
    placement: ExtensionWidget["placement"],
  ): void;
};

/**
 * Extension UI without a terminal. Dialogs are answered as cancelled so an
 * extension that asks a question degrades instead of hanging the turn;
 * notifications and status texts are forwarded to the session status.
 */
// ponytail: dialogs auto-cancel; add a pending-request store when an
// extension the user relies on needs answers from the browser.
export function createHeadlessUi(sink: HeadlessUiSink): ExtensionUIContext {
  const cancelled = (title: string) => {
    sink.notify(
      "warning",
      `Extension dialog "${title}" is not supported here.`,
    );
  };
  return {
    select(title) {
      cancelled(title);
      return Promise.resolve(undefined);
    },
    confirm(title) {
      cancelled(title);
      return Promise.resolve(false);
    },
    input(title) {
      cancelled(title);
      return Promise.resolve(undefined);
    },
    editor(title) {
      cancelled(title);
      return Promise.resolve(undefined);
    },
    custom() {
      return Promise.reject(new Error("Custom extension UI is not supported"));
    },
    notify(message, type) {
      sink.notify(type ?? "info", message);
    },
    onTerminalInput() {
      return () => {};
    },
    setStatus(key, text) {
      sink.setStatus(key, text);
    },
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    // Line widgets are rendered as chips with a panel. A widget whose content
    // is a terminal component needs a headless pi-tui to render; until then it
    // keeps an inert chip so the reader sees the extension is there.
    setWidget(
      key: string,
      content: unknown,
      options?: { placement?: ExtensionWidget["placement"] },
    ) {
      sink.setWidget(
        key,
        content === undefined
          ? undefined
          : Array.isArray(content)
            ? content
            : [],
        options?.placement ?? "aboveEditor",
      );
    },
    setFooter() {},
    setHeader() {},
    setTitle() {},
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    theme: PLAIN_TEXT_THEME,
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: false, error: "Themes are not supported here" };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
}
