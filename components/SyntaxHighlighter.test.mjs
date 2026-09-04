import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { CodeBlock } = await jiti.import("./MermaidBlock.tsx");

// Every language app/api/files/[...path]/route.ts can return from getLanguage(),
// minus the three that are not Prism grammars ("text", "pdf", "word"). The file
// viewer asks the highlighter for exactly these, so all of them must be
// registered in SyntaxHighlighter.ts. Add a case here when that map grows.
const FILE_VIEWER_LANGUAGES = {
  typescript: "const x: number = 1;",
  javascript: "const x = 1;",
  python: "def f(): return 1",
  ruby: "def f; 1; end",
  go: "func main() {}",
  rust: "fn main() {}",
  java: "class A {}",
  kotlin: "fun main() {}",
  swift: "let x = 1",
  c: "int main(void) { return 0; }",
  cpp: "int main() { return 0; }",
  csharp: "class A { }",
  html: "<p>hi</p>",
  css: "a { color: red; }",
  json: '{"a": 1}',
  yaml: "a: 1",
  toml: "a = 1",
  xml: "<a>b</a>",
  markdown: "# hi",
  bash: "echo hi",
  sql: "SELECT 1;",
  graphql: "{ a }",
  dockerfile: "FROM node",
  hcl: 'a = "b"',
  makefile: "all:\n\techo hi",
};

// Fence languages that only ever reach the chat transcript.
const TRANSCRIPT_LANGUAGES = {
  tsx: "const A = () => <b/>;",
  jsx: "const A = () => <b/>;",
  diff: "+added\n-removed",
  ini: "[a]\nb=1",
  php: "<?php echo 1; ?>",
  lua: "local x = 1",
  perl: "my $x = 1;",
  powershell: "$x = 1",
  r: "x <- 1",
  scala: "val x = 1",
  dart: "void main() {}",
  elixir: "def f, do: 1",
  haskell: "main = return ()",
  objectivec: "@interface A @end",
  protobuf: "message A { }",
  nginx: "server { }",
  scss: "a { b: 1; }",
  less: "a { b: 1; }",
  regex: "[a-z]+",
  git: "+ added line\n- removed line",
};

function render(code, lang) {
  return renderToStaticMarkup(React.createElement(CodeBlock, { code, lang }));
}

for (const [lang, code] of Object.entries({ ...FILE_VIEWER_LANGUAGES, ...TRANSCRIPT_LANGUAGES })) {
  test(`tokenizes ${lang}`, () => {
    assert.match(render(code, lang), /class="token/, `${lang} produced no tokens`);
  });
}

test("aliases declared by a grammar keep working", () => {
  assert.match(render("const x: number = 1;", "ts"), /class="token/);
  assert.match(render("a: 1", "yml"), /class="token/);
});

test("an unregistered language renders as plain text instead of failing", () => {
  const html = render("MOVE X TO Y.", "cobol");

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /MOVE X TO Y\./);
});
