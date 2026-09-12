import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { Window } from "happy-dom";
import { HTMX_SRC, HTMX_SSE_SRC } from "@web/HtmlLayout";

const client = buildSync({
  stdin: {
    contents: `
      import { setUpRequestFields } from './src/web/client/htmx.ts';
      import { setUpComposer } from './src/web/client/composer.ts';
      import { setUpToasts } from './src/web/client/toasts.ts';
      import { setUpDialogs } from './src/web/client/dialogs.ts';
      import { setUpSidebar } from './src/web/client/sidebar.ts';
      import { setUpSseStartup } from './src/web/client/sse.ts';
      setUpRequestFields(); setUpComposer(); setUpToasts(); setUpDialogs(); setUpSidebar(); setUpSseStartup();
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
})
  .outputFiles.map((file) => file.text)
  .join("\n");

export type Transport = (request: Request) => Promise<Response> | Response;

/** Separate JS realm: no tests/client/setup.ts and no fake HTMX object. */
export async function htmxBrowser(
  markup: string,
  transport: Transport,
  clientAfterHtmx = false,
) {
  const window = new Window({
    url: "http://htmx.test/sessions/s1",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.console = console;
  const requests: Request[] = [];
  const controllers: AbortController[] = [];
  window.fetch = async (input, init) => {
    const controller = new AbortController();
    controllers.push(controller);
    init?.signal?.addEventListener("abort", () => {
      controller.abort();
    });
    let body: BodyInit | undefined;
    if (init?.body instanceof window.FormData) {
      const data = new FormData();
      for (const [key, value] of init.body) {
        if (typeof value === "string") data.append(key, value);
        else
          data.append(
            key,
            new Blob([await value.arrayBuffer()], { type: value.type }),
            value.name,
          );
      }
      body = data;
    } else if (init?.body instanceof window.URLSearchParams)
      body = new URLSearchParams(init.body.toString());
    else if (typeof init?.body === "string") body = init.body;
    const url =
      typeof input === "string"
        ? input
        : "url" in input
          ? input.url
          : input.href;
    const request = new Request(new URL(url, window.location.href), {
      method: init?.method ?? "GET",
      headers: init?.headers as HeadersInit,
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    });
    requests.push(request.clone());
    return (await transport(request)) as unknown as Awaited<
      ReturnType<typeof window.fetch>
    >;
  };
  // Fetch streams are native Node streams, so their decoder must be available in the realm.
  Object.assign(window, { TextDecoder, TextEncoder });
  // happy-dom has no XPath. HTMX only uses it to find hx-on attributes;
  // provide that DOM query, not a replacement for processing or event dispatch.
  window.eval(`window.XPathEvaluator = class {
    createExpression() {
      return { evaluate(root) {
        const matches = [...root.querySelectorAll('*')].filter(element =>
          [...element.attributes].some(attr => attr.name.startsWith('hx-on') || attr.name.startsWith('data-hx-on')));
        let index = 0;
        return { iterateNext() { return matches[index++] || null; } };
      } };
    }
  };`);
  window.document.write(markup);
  for (const path of [HTMX_SRC, HTMX_SSE_SRC]) {
    window.eval(readFileSync(resolve(process.cwd(), path.slice(1)), "utf8"));
  }
  if (clientAfterHtmx) {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  window.eval(client);
  if (!clientAfterHtmx)
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    window,
    document: window.document,
    requests,
    close: async () => {
      await window.eval(
        `htmx.swap({target:document.body,sourceElement:document.body,text:'',swap:'innerHTML'})`,
      );
      controllers.forEach((controller) => {
        controller.abort();
      });
      await window.happyDOM.close();
    },
  };
}

export function page(body: string): string {
  return `<!doctype html><html><head><meta name="htmx-config" content='{"extensions":"sse","sse":{"pauseOnBackground":false},"defaultTimeout":0}'></head><body hx-status:4xx:inherited="swap:none" hx-status:5xx:inherited="swap:none">${body}</body></html>`;
}

export function controlledStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    send(data: string, event?: string, id?: string) {
      controller.enqueue(
        new TextEncoder().encode(
          `${id === undefined ? "" : `id: ${id}\n`}${event ? `event: ${event}\n` : ""}${data
            .split("\n")
            .map((line) => `data: ${line}\n`)
            .join("")}\n`,
        ),
      );
    },
    end() {
      controller.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}
