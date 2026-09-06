import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(
      MarkdownBody,
      {
        cwd: "/home/me/project",
        onOpenFile() {},
      },
      markdown,
    ),
  );
}

test("preserves currency, prose spacing, and bold text between dollar signs", () => {
  const html = renderMarkdown(
    "- **Amigo Europe mobile:** the adjusted total **increases by $0.570**. Its final curator call was retained as token usage but left **unpriced**. Adding its estimated **$2.763** charge outweighs the **$2.193** Flex saving on the draft-curator calls.",
  );

  assert.match(
    html,
    /<strong>increases by \$0\.570<\/strong>\. Its final curator call was retained as token usage but left <strong>unpriced<\/strong>\./,
  );
  assert.match(
    html,
    /<strong>\$2\.763<\/strong> charge outweighs the <strong>\$2\.193<\/strong>/,
  );
  assert.doesNotMatch(html, /katex|<math/);
});

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("keeps single-tilde CJK numeric ranges literal instead of striking them", () => {
  const html = renderMarkdown("5~7U 保证金 × 100~200倍杠杆");

  assert.doesNotMatch(html, /<del>/);
  assert.match(html, /5~7U/);
  assert.match(html, /100~200倍/);
});

test("still renders double-tilde strikethrough", () => {
  const html = renderMarkdown("~~gone~~");

  assert.match(html, /<del>gone<\/del>/);
});

test("leaves inline and display formula notation as ordinary Markdown", () => {
  for (const [source, expected] of [
    ["Formula: $x^2$.", "Formula: $x^2$."],
    ["Formula: $$x^2$$.", "Formula: $$x^2$$."],
    [String.raw`Formula: \(x^2\).`, "Formula: (x^2)."],
    ["$$\n\\frac{a}{b}\n$$", "$$\n\\frac{a}{b}\n$$"],
    [String.raw`\[\frac{a}{b}\]`, String.raw`[\frac{a}{b}]`],
    [String.raw`[ \frac{a}{b} ]`, String.raw`[ \frac{a}{b} ]`],
  ]) {
    assert.equal(
      renderMarkdown(source),
      `<div class="markdown-body"><p>${expected}</p></div>`,
    );
  }
});

test("keeps shell variables and LaTeX inside inline code literal", () => {
  const html = renderMarkdown("Use `$HOME` and `\\frac{a}{b}`");
  assert.match(html, /<code class="markdown-inline-code">\$HOME<\/code>/);
  assert.match(
    html,
    /<code class="markdown-inline-code">\\frac\{a\}\{b\}<\/code>/,
  );
});

test("does not print undefined while a code fence is still opening", () => {
  const opening = renderToStaticMarkup(
    React.createElement(
      MarkdownBody,
      { cwd: "/home/me/project", isStreaming: true },
      "```ts\n",
    ),
  );

  assert.doesNotMatch(opening, /undefined/);
  assert.doesNotMatch(renderMarkdown("```ts\n```"), /undefined/);
});

test("keeps inline code free of react-markdown metadata", () => {
  assert.doesNotMatch(renderMarkdown("some `inline` code"), /\snode=/);
});

test("keeps in-page anchors in the page and matched to their target", () => {
  // rehype-sanitize prefixes ids with user-content-, so hrefs must match.
  const anchor = renderMarkdown("[go](#sec)");
  assert.match(anchor, /href="#user-content-sec"/);
  assert.doesNotMatch(anchor, /target="_blank"/);

  assert.match(
    renderMarkdown("x[^1]\n\n[^1]: note"),
    /href="#user-content-user-content-fn-1"/,
  );
});

test("only opens a real external scheme in a new tab", () => {
  assert.match(renderMarkdown("[m](mailto:a@b.example)"), /target="_blank"/);
  // An empty href would otherwise reopen the whole app in a new tab.
  assert.doesNotMatch(renderMarkdown("[x]()"), /target="_blank"/);
  assert.doesNotMatch(renderMarkdown("[m](Makefile)"), /target="_blank"/);
});

test("serves local images through the file API and passes the session", () => {
  assert.match(
    renderMarkdown("![a](./a.png)"),
    /\/api\/files\/home\/me\/project\/a\.png\?type=read/,
  );

  const scoped = renderToStaticMarkup(
    React.createElement(
      MarkdownBody,
      { cwd: "/home/me/project", sessionId: "abc" },
      "![a](./a.png)",
    ),
  );
  assert.match(scoped, /sessionId=abc/);
});

test("shows the alt text when an image source cannot be rendered", () => {
  // A Windows drive path is stripped by the sanitizer; a src-less <img> is
  // display:block with no intrinsic size, so it would collapse to nothing.
  const html = renderMarkdown("![the alt](C:\\\\shots\\\\x.png)");

  assert.match(html, /the alt/);
  assert.doesNotMatch(html, /<img/);
});

test("leaves a remote image untouched and still blocks javascript urls", () => {
  assert.match(
    renderMarkdown("![c](https://example.com/c.png)"),
    /src="https:\/\/example\.com\/c\.png"/,
  );
  assert.doesNotMatch(
    renderMarkdown("[x](javascript:alert(1))"),
    /javascript:/i,
  );
});
