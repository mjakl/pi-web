import { renderMarkdown } from "@web/markdown";
import { describe, expect, it } from "vitest";

describe("renderMarkdown", () => {
  it("shows raw HTML as text instead of running it", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n\n**bold**");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("gives a code block a language header and a copy button", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain('<span class="markdown-code-lang">ts</span>');
    expect(html).toContain("data-copy-code");
    expect(html).toContain('<code class="language-ts"');
    expect(html).toContain("const a = 1;");
  });

  it("gives fenced code its own body inside the shared Markdown wrapper", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain('<div class="markdown-code-block">');
    expect(html).toContain(
      '<pre class="markdown-code-body"><code class="language-ts">const a = 1;</code></pre>',
    );
  });

  it("marks a mermaid fence for the preview toggle, disabled while live", () => {
    expect(renderMarkdown("```mermaid\ngraph TD;\n```")).toContain(
      "data-mermaid-toggle",
    );
    expect(
      renderMarkdown("```mermaid\ngraph TD;\n```", { live: true }),
    ).toContain("disabled");
  });

  it("prefixes heading ids and rewrites anchors to match", () => {
    const html = renderMarkdown("# Some Heading\n\n[go](#some-heading)");
    expect(html).toContain('id="user-content-some-heading"');
    expect(html).toContain('href="#user-content-some-heading"');
  });

  it("opens web links in a new tab and keeps local paths as text", () => {
    const html = renderMarkdown("[a](https://x.dev) [b](./src/main.ts)", {
      cwd: "/repo",
    });
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-file-path="/repo/src/main.ts"');
    expect(html).not.toContain('href="./src/main.ts"');
  });

  it("wraps tables so a wide one scrolls instead of stretching", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain('<div class="markdown-table-wrap"><table>');
  });

  it("leaves a single tilde alone and keeps double-tilde strikethrough", () => {
    const html = renderMarkdown("~10~20 and ~~gone~~");
    expect(html).toContain("~10~20");
    expect(html).toContain("<del>gone</del>");
  });

  it("drops frontmatter instead of rendering it", () => {
    expect(renderMarkdown("---\ntitle: x\n---\n\nbody")).not.toContain("title");
  });

  it("prints the source of a document too large to parse", () => {
    const html = renderMarkdown(`# head\n${"x".repeat(100_001)}`);
    expect(html).toContain("<details");
    expect(html).toContain("Message content is very large");
    expect(html).not.toContain("<h1");
  });
});
