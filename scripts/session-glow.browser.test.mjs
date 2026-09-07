import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

// Requires an installed agent-browser and Chromium. Run separately from CI:
// npm run test:one -- scripts/session-glow.browser.test.mjs
const run = promisify(execFile);
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SessionIndicator } = await jiti.import("../components/SessionItem.tsx");

test(
  "rendered unread indicators fade without changing their shadow and respect reduced motion",
  { timeout: 60_000 },
  async () => {
    const session = `pi-glow-${randomUUID()}`;
    const browser = async (...args) => {
      const { stdout } = await run(
        "agent-browser",
        ["--session", session, "--json", ...args],
        { timeout: 20_000 },
      );
      const result = JSON.parse(stdout);
      assert.equal(result.success, true, result.error);
      return result.data;
    };
    const indicator = (unread) =>
      renderToStaticMarkup(
        React.createElement(SessionIndicator, { kind: "stopped", unread }),
      );
    const html = `<!doctype html><html><head><title>Session indicator test</title><link rel="stylesheet" href="/globals.css"></head><body><div id="unread">${indicator(true)}</div><div id="read">${indicator(false)}</div></body></html>`;
    // Serve the production stylesheet unchanged, as an asset. Assertions below
    // inspect the rendered component in Chromium, never the stylesheet's rules.
    const css = await readFile(new URL("../app/globals.css", import.meta.url));
    const server = createServer((request, response) => {
      const stylesheet = request.url === "/globals.css";
      response.setHeader("Content-Type", stylesheet ? "text/css" : "text/html");
      response.end(stylesheet ? css : html);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      await browser("open", `http://127.0.0.1:${server.address().port}`);
      await browser("set", "media", "light");
      const { result: samples } = await browser(
        "eval",
        `(() => {
      const unread = document.querySelector('#unread > span');
      const read = document.querySelector('#read > span');
      const animations = unread.getAnimations({ subtree: true });
      if (animations.length !== 1) throw new Error('Expected one applied unread animation');
      if (read.getAnimations({ subtree: true }).length !== 0) throw new Error('Read indicator must not pulse');
      const animation = animations[0];
      animation.pause();
      const duration = animation.effect.getTiming().duration;
      return [0, 0.5, 0.999].map(fraction => {
        animation.currentTime = duration * fraction;
        const style = getComputedStyle(unread, '::before');
        const rect = unread.getBoundingClientRect();
        return { opacity: Number(style.opacity), shadow: style.boxShadow,
          transform: style.transform, width: rect.width, height: rect.height };
      });
    })()`,
      );
      const [start, peak, end] = samples;
      assert.ok(start.width > 0 && start.height > 0, "indicator is rendered");
      assert.notEqual(
        start.shadow,
        "none",
        "unread indicator has a visible halo",
      );
      assert.ok(
        peak.opacity > start.opacity,
        "halo brightens during the pulse",
      );
      assert.ok(
        Math.abs(start.opacity - end.opacity) < 0.01,
        "halo fades back",
      );
      for (const sample of samples) {
        assert.equal(
          sample.shadow,
          start.shadow,
          "shadow stays fixed across frames",
        );
        assert.equal(sample.transform, "none", "halo does not scale");
        assert.equal(sample.width, start.width);
        assert.equal(sample.height, start.height);
      }
      await browser("set", "media", "light", "reduced-motion");
      const { result: reduced } = await browser(
        "eval",
        `(() => {
      const style = getComputedStyle(document.querySelector('#unread > span'), '::before');
      return { enabled: matchMedia('(prefers-reduced-motion: reduce)').matches,
        duration: parseFloat(style.animationDuration), iterations: Number(style.animationIterationCount) };
    })()`,
      );
      assert.equal(reduced.enabled, true);
      assert.equal(reduced.iterations, 1);
      assert.ok(
        reduced.duration < 0.001,
        "reduced motion disables continuous pulsing",
      );
    } finally {
      try {
        await browser("close");
      } finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  },
);
