import { bracketedPaste, terminalKeyData } from "@core/terminal-input";
import { describe, expect, it } from "vitest";

function key(
  name: string,
  modifiers: Partial<Record<"alt" | "ctrl" | "meta" | "shift", boolean>> = {},
) {
  return terminalKeyData({
    key: name,
    altKey: modifiers.alt ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
  });
}

describe("terminal key encoding", () => {
  it("maps the arrows and the editing keys to their VT sequences", () => {
    expect(key("ArrowUp")).toBe("\u001B[A");
    expect(key("ArrowDown")).toBe("\u001B[B");
    expect(key("ArrowRight")).toBe("\u001B[C");
    expect(key("ArrowLeft")).toBe("\u001B[D");
    expect(key("Home")).toBe("\u001B[H");
    expect(key("End")).toBe("\u001B[F");
    expect(key("PageUp")).toBe("\u001B[5~");
    expect(key("Delete")).toBe("\u001B[3~");
    expect(key("Escape")).toBe("\u001B");
    expect(key("Backspace")).toBe("\u007F");
  });

  it("maps Ctrl+letter to its control byte", () => {
    expect(key("c", { ctrl: true })).toBe("\u0003");
    expect(key("a", { ctrl: true })).toBe("\u0001");
    expect(key("?", { ctrl: true })).toBe("\u007F");
  });

  it("prefixes Alt with escape, and Alt+arrow with word motion", () => {
    expect(key("b", { alt: true })).toBe("\u001Bb");
    expect(key("ArrowLeft", { alt: true })).toBe("\u001Bb");
    expect(key("ArrowRight", { alt: true })).toBe("\u001Bf");
    expect(key("Backspace", { alt: true })).toBe("\u001B\u007F");
  });

  it("separates Enter from Shift+Enter and Tab from Shift+Tab", () => {
    expect(key("Enter")).toBe("\r");
    expect(key("Enter", { shift: true })).toBe("\n");
    expect(key("Tab")).toBe("\t");
    expect(key("Tab", { shift: true })).toBe("\u001B[Z");
  });

  it("leaves the browser its own shortcuts and ordinary typing", () => {
    expect(key("k", { meta: true })).toBeNull();
    expect(key("v", { ctrl: true })).toBeNull();
    expect(key("a")).toBeNull();
    expect(key("Shift")).toBeNull();
  });

  it("wraps a paste so a component can tell it from typing", () => {
    expect(bracketedPaste("hi")).toBe("\u001B[200~hi\u001B[201~");
  });
});
