import { parseOptions } from "@/cli";
import { describe, expect, it } from "vitest";

describe("web-pi flags", () => {
  it("asks for nothing by default", () => {
    expect(parseOptions([])).toEqual({ help: false, version: false, env: {} });
  });

  it("turns flags into the environment loadConfig already reads", () => {
    expect(
      parseOptions(["--host", "1.2.3.4", "--port", "8080", "--runtime", "fake"])
        .env,
    ).toEqual({
      WEB_PI_HOST: "1.2.3.4",
      WEB_PI_PORT: "8080",
      WEB_PI_RUNTIME: "fake",
    });
  });

  it("binds every interface for --lan, and lets an explicit host win", () => {
    expect(parseOptions(["--lan"]).env).toEqual({ WEB_PI_HOST: "0.0.0.0" });
    expect(parseOptions(["--lan", "--host", "::1"]).env).toEqual({
      WEB_PI_HOST: "::1",
    });
  });

  it("reports help and version without starting anything", () => {
    expect(parseOptions(["--help"]).help).toBe(true);
    expect(parseOptions(["--version"]).version).toBe(true);
  });

  it("points a mistyped flag or a stray argument at --help", () => {
    expect(() => parseOptions(["--prot", "8080"])).toThrow(/web-pi --help/);
    expect(() => parseOptions(["8080"])).toThrow(/web-pi --help/);
  });
});
