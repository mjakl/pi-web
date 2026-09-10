import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every `path/like/this.ext` mentioned in the docs must exist, so guidance
// cannot silently point at files that moved.
const roots = ["AGENTS.md", "README.md", "docs"];
const pattern = /`((?:src|tests|scripts|docs|static)\/[\w./-]+)`/g;

// docs/specs quotes pi-web paths; they are not claims about this checkout.
const skipped = ["docs/specs"];

function* markdownFiles(path: string): Generator<string> {
  if (!existsSync(path) || skipped.includes(path)) return;
  if (statSync(path).isDirectory()) {
    for (const child of readdirSync(path))
      yield* markdownFiles(join(path, child));
  } else if (path.endsWith(".md")) {
    yield path;
  }
}

const missing: string[] = [];
for (const root of roots) {
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (target && !existsSync(target)) missing.push(`${file}: ${target}`);
    }
  }
}
if (missing.length > 0) {
  process.stderr.write(
    `Missing paths referenced in docs:\n${missing.join("\n")}\n`,
  );
  process.exit(1);
}
