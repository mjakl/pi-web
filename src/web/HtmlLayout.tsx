import { DARK_THEME, LIGHT_THEME, THEME_KEY } from "@web/client/theme";
import type { AppEnvironment } from "@web/hono";
import type { Context } from "hono";
import { raw } from "hono/html";
import type { PropsWithChildren } from "hono/jsx";

export const HTMX_SRC = "/static/vendor/htmx.min-2.0.10.js";
export const HTMX_SSE_SRC = "/static/vendor/htmx-ext-sse.min-2.2.4.js";

// The stored theme has to reach <html> before the first paint, so this one
// cannot wait for the module bundle. src/web/client/main.ts owns the rest.
const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
document.documentElement.setAttribute("data-theme",t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)?${JSON.stringify(DARK_THEME)}:${JSON.stringify(LIGHT_THEME)})}catch(e){}`;

export function HtmlLayout(
  { children }: PropsWithChildren,
  context: Context<AppEnvironment>,
) {
  if (context.req.header("HX-Request") === "true") {
    return <>{children}</>;
  }
  const assets = context.get("assets");
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Pi</title>
        <script>{raw(THEME_SCRIPT)}</script>
        <link rel="stylesheet" href={assets.css} />
        <script src={HTMX_SRC} defer></script>
        <script src={HTMX_SSE_SRC} defer></script>
        <script type="module" src={assets.js}></script>
      </head>
      <body
        class="h-dvh overflow-hidden bg-base-100 text-base-content"
        data-mermaid-src={assets.mermaid}
      >
        {children}
      </body>
    </html>
  );
}
