/** Cut an actual route response, not a synthetic HTMX event. */
export function disconnectable(
  transport: (request: Request) => Promise<Response> | Response,
) {
  const connections: { disconnect(): void; request: Request }[] = [];
  return {
    connections,
    request: async (request: Request): Promise<Response> => {
      if (!new URL(request.url).pathname.endsWith("/events"))
        return transport(request);
      const abort = new AbortController();
      request.signal.addEventListener("abort", () => {
        abort.abort();
      });
      const response = await transport(
        new Request(request, { signal: abort.signal }),
      );
      if (!response.body) return response;
      const reader = response.body.getReader();
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const disconnect = () => {
            if (closed) return;
            closed = true;
            controller.close();
            abort.abort();
            void reader.cancel();
          };
          connections.push({ disconnect, request });
          void (async () => {
            try {
              while (!closed) {
                const next = await reader.read();
                if (closed) break;
                if (next.done) {
                  disconnect();
                  break;
                }
                controller.enqueue(next.value);
              }
            } catch (error) {
              if (!closed) {
                closed = true;
                controller.error(error);
              }
            }
          })();
        },
        cancel() {
          closed = true;
          abort.abort();
          return reader.cancel();
        },
      });
      return new Response(body, {
        headers: response.headers,
        status: response.status,
      });
    },
  };
}
