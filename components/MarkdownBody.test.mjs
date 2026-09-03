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
const { normalizeDisplayMath } = await jiti.import("../lib/markdown.ts");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

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

test("renders LaTeX parenthesis delimiters as inline math", () => {
  const html = renderMarkdown(String.raw`射线为 \(r_c = K^{-1}p\)。`);

  assert.match(html, /class="katex"/);
  assert.match(html, /r_c/);
});

test("renders paired LaTeX bracket delimiters as display math", () => {
  const html = renderMarkdown(String.raw`\[
P(\lambda)=o_b+\lambda r_b
\]`);
  const oneLineHtml = renderMarkdown(String.raw`\[P(\lambda)=o_b+\lambda r_b\]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /lambda/);
  assert.match(oneLineHtml, /class="katex-display"/);
});

test("renders model-emitted bracket-only formula lines as display math", () => {
  const html = renderMarkdown(String.raw`平均一致性：

[ C(x) = \frac{2}{T(T-1)} \sum_{i<j} S(\hat{y}^{(i)}, \hat{y}^{(j)}) ]`);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /\\sum/);
});

test("leaves an unmatched LaTeX bracket delimiter unchanged", () => {
  const markdown = String.raw`before
\[
x + y
after`;

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside Markdown code", () => {
  const markdown = "    \\(indented\\)\n\n`code\n\\(inline\\)`\n\n```text\n\\[\nfenced\n\\]\n```";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize LaTeX delimiters inside raw HTML code", () => {
  const markdown = "<code>\\(inline\\)</code>\n\n<pre>\n\\(block\\)\n</pre>";

  assert.equal(normalizeDisplayMath(markdown), markdown);
});

test("does not normalize escaped delimiters or link destinations", () => {
  const escaped = String.raw`Literal: \\(x+y\\).`;
  const link = String.raw`[docs](https://example.com/\(manual\))`;

  assert.equal(normalizeDisplayMath(escaped), escaped);
  assert.equal(normalizeDisplayMath(link), link);
});

test("does not print undefined while a code fence is still opening", () => {
  const opening = renderToStaticMarkup(
    React.createElement(MarkdownBody, { cwd: "/home/me/project", isStreaming: true }, "```ts\n"),
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

  assert.match(renderMarkdown("x[^1]\n\n[^1]: note"), /href="#user-content-user-content-fn-1"/);
});

test("only opens a real external scheme in a new tab", () => {
  assert.match(renderMarkdown("[m](mailto:a@b.example)"), /target="_blank"/);
  // An empty href would otherwise reopen the whole app in a new tab.
  assert.doesNotMatch(renderMarkdown("[x]()"), /target="_blank"/);
  assert.doesNotMatch(renderMarkdown("[m](Makefile)"), /target="_blank"/);
});

test("serves local images through the file API and passes the session", () => {
  assert.match(renderMarkdown("![a](./a.png)"), /\/api\/files\/home\/me\/project\/a\.png\?type=read/);

  const scoped = renderToStaticMarkup(
    React.createElement(MarkdownBody, { cwd: "/home/me/project", sessionId: "abc" }, "![a](./a.png)"),
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
  assert.match(renderMarkdown("![c](https://example.com/c.png)"), /src="https:\/\/example\.com\/c\.png"/);
  assert.doesNotMatch(renderMarkdown("[x](javascript:alert(1))"), /javascript:/i);
});
