import type { AppEnvironment } from "@web/hono";
import type { Context } from "hono";
import { raw } from "hono/html";
import type { PropsWithChildren } from "hono/jsx";

export const HTMX_SRC = "/static/vendor/htmx.min-2.0.10.js";
export const HTMX_SSE_SRC = "/static/vendor/htmx-ext-sse.min-2.2.4.js";

// Keep the reader at the end of the conversation while a turn streams in,
// unless they scrolled up to read something earlier.
const CLIENT_SCRIPT = `
(function () {
  var stick = true;
  var log = document.getElementById("log");
  if (!log) return;
  log.addEventListener("scroll", function () {
    stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  });
  document.body.addEventListener("htmx:afterSwap", function () {
    if (stick) log.scrollTop = log.scrollHeight;
  });
  log.scrollTop = log.scrollHeight;
})();
`;

export function HtmlLayout(
  { children }: PropsWithChildren,
  context: Context<AppEnvironment>,
) {
  if (context.req.header("HX-Request") === "true") {
    return <>{children}</>;
  }
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Pi</title>
        <link rel="stylesheet" href="/static/app.css" />
        <script src={HTMX_SRC} defer></script>
        <script src={HTMX_SSE_SRC} defer></script>
      </head>
      <body class="h-dvh overflow-hidden bg-base-100 text-base-content">
        {children}
        <script>{raw(CLIENT_SCRIPT)}</script>
      </body>
    </html>
  );
}
