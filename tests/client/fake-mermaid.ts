// What `src/web/client/mermaid.ts` loads by URL in the tests: a diagram
// library that records its calls on the page and rejects code saying "bad".

export type MermaidCalls = { initialize: unknown[]; render: string[] };

export function mermaidCalls(): MermaidCalls {
  const holder = globalThis as { mermaidCalls?: MermaidCalls };
  holder.mermaidCalls ??= { initialize: [], render: [] };
  return holder.mermaidCalls;
}

export default {
  initialize(config: unknown): void {
    mermaidCalls().initialize.push(config);
  },
  parse(code: string): Promise<void> {
    return code.includes("bad")
      ? Promise.reject(new Error("parse error"))
      : Promise.resolve();
  },
  render(_id: string, code: string): Promise<{ svg: string }> {
    mermaidCalls().render.push(code);
    return Promise.resolve({ svg: `<svg><title>${code}</title></svg>` });
  },
};
