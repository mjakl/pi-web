import { configureHttpDispatcher, HTTP_IDLE_TIMEOUT_MS } from "@/http";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A proxy sees the whole URL in the request line; a direct connection does not.
let proxy: Server;
let seen: string[] = [];

beforeAll(async () => {
  proxy = createServer((request, response) => {
    seen.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("through the proxy");
  });
  await new Promise<void>((resolve) => {
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env["HTTP_PROXY"] = `http://127.0.0.1:${String(port)}`;
  delete process.env["NO_PROXY"];
  delete process.env["no_proxy"];
  configureHttpDispatcher();
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    proxy.close(() => {
      resolve();
    });
  });
});

describe("the server's HTTP dispatcher", () => {
  it("sends fetches through HTTP_PROXY", async () => {
    seen = [];
    const response = await fetch("http://pi.invalid/models");
    expect(await response.text()).toBe("through the proxy");
    // Absolute form: proof the request went to the proxy, not to the host.
    expect(seen).toEqual(["http://pi.invalid/models"]);
  });

  it("gives up on a silent server after the idle timeout", async () => {
    // The default is undici's own 300 s, long enough for a streaming turn to
    // pause between tokens; this proves the value is wired, not just passed.
    expect(HTTP_IDLE_TIMEOUT_MS).toBe(300_000);
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => {
      silent.listen(0, "127.0.0.1", resolve);
    });
    const address = silent.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env["NO_PROXY"] = "127.0.0.1";
    configureHttpDispatcher(50);
    try {
      await expect(
        fetch(`http://127.0.0.1:${String(port)}/wait`),
      ).rejects.toThrow();
    } finally {
      delete process.env["NO_PROXY"];
      configureHttpDispatcher();
      silent.closeAllConnections();
      await new Promise<void>((resolve) => {
        silent.close(() => {
          resolve();
        });
      });
    }
  });
});
