import {
  contextUsage,
  formatTokens,
  parseWarnTokens,
} from "@core/context-usage";
import { describe, expect, it } from "vitest";

describe("contextUsage", () => {
  it("derives percent and level from one formula", () => {
    expect(
      contextUsage({ tokens: 50_000, contextWindow: 100_000 }),
    ).toMatchObject({
      percent: 50,
      level: "ok",
    });
    expect(contextUsage({ tokens: 65_000, contextWindow: 100_000 }).level).toBe(
      "warn",
    );
    expect(contextUsage({ tokens: 90_000, contextWindow: 100_000 }).level).toBe(
      "critical",
    );
  });

  it("reports unknown instead of guessing", () => {
    expect(
      contextUsage({ tokens: null, contextWindow: 100_000 }),
    ).toMatchObject({
      percent: null,
      level: "unknown",
    });
    expect(
      contextUsage({ tokens: 10, contextWindow: 0 }).contextWindow,
    ).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(128_000)).toBe("128k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });
});

describe("the reader's own token threshold", () => {
  it("warns once the count passes it, whatever the window says", () => {
    const big = { tokens: 120_000, contextWindow: 1_000_000 };
    // 12 % of a huge window, but past the point where answers get worse.
    expect(contextUsage(big).level).toBe("warn");
    expect(contextUsage({ ...big, warnTokens: 200_000 }).level).toBe("ok");
    // The percent rules still win where they are stricter.
    expect(
      contextUsage({
        tokens: 90_000,
        contextWindow: 100_000,
        warnTokens: 200_000,
      }).level,
    ).toBe("critical");
  });

  it("takes only a positive whole number from the cookie", () => {
    expect(parseWarnTokens("50000")).toBe(50_000);
    expect(parseWarnTokens("0")).toBe(100_000);
    expect(parseWarnTokens("-5")).toBe(100_000);
    expect(parseWarnTokens("1e40")).toBe(100_000);
    expect(parseWarnTokens(undefined)).toBe(100_000);
  });
});
