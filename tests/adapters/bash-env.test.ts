import { sanitizeCommandEnvironment } from "@adapters/pi/bash-env";
import { describe, expect, it } from "vitest";

describe("sanitizeCommandEnvironment", () => {
  it("drops the server's own variables and keeps everything else", () => {
    const clean = sanitizeCommandEnvironment(
      {
        PATH: "/usr/bin",
        PORT: "30141",
        NODE_ENV: "production",
        WEB_PI_RUNTIME: "fake",
        PI_SESSION_ID: "abc",
        HOME: "/home/dev",
      },
      "/home/dev/.pi/agent",
      "linux",
    );
    expect(clean["PORT"]).toBeUndefined();
    expect(clean["NODE_ENV"]).toBeUndefined();
    expect(clean["WEB_PI_RUNTIME"]).toBeUndefined();
    expect(clean["PI_SESSION_ID"]).toBe("abc");
    expect(clean["HOME"]).toBe("/home/dev");
  });

  it("prepends the agent's bin directory to PATH exactly once", () => {
    const bin = "/home/dev/.pi/agent/bin";
    const first = sanitizeCommandEnvironment(
      { PATH: "/usr/bin" },
      "/home/dev/.pi/agent",
      "linux",
    );
    expect(first["PATH"]).toBe(`${bin}:/usr/bin`);
    const again = sanitizeCommandEnvironment(
      { PATH: first["PATH"] ?? "" },
      "/home/dev/.pi/agent",
      "linux",
    );
    expect(again["PATH"]).toBe(`${bin}:/usr/bin`);
  });

  it("matches variable names case-insensitively on Windows", () => {
    const clean = sanitizeCommandEnvironment(
      { Path: "C:\\bin", Port: "1", node_env: "production" },
      "C:\\agent",
      "win32",
    );
    expect(clean["Port"]).toBeUndefined();
    expect(clean["node_env"]).toBeUndefined();
    // `join` uses the host's separator; only the PATH key casing and the
    // Windows delimiter are the platform behaviour under test here.
    expect(clean["Path"]).toMatch(/^C:.agent.bin;C:\\bin$/);
  });
});
