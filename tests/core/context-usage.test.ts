import { contextUsage, formatTokens } from "@core/context-usage";
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
