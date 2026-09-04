import { load as parseYaml } from "js-yaml";

const FRONTMATTER_OPEN_RE = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/;

function extractFrontmatter(markdown: string): string | null {
  const opening = FRONTMATTER_OPEN_RE.exec(markdown);
  if (!opening) return null;

  const closingPattern = /^---[ \t]*(?:(?:\r\n|\n|\r)|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(markdown);
  if (!closing) return null;

  return markdown
    .slice(opening[0].length, closing.index)
    .replace(/(?:\r\n|\n|\r)$/, "");
}

export function parseFrontmatter(markdown: string): Record<string, unknown> | null {
  const yaml = extractFrontmatter(markdown);
  if (yaml === null) return null;

  try {
    const parsed = parseYaml(yaml);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The remark plugin still hides a syntactically fenced malformed block.
  }

  return null;
}

export function formatFrontmatterValue(value: unknown): string {
  return formatValue(value, new WeakSet<object>());
}

function formatValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[Circular]";
    ancestors.add(value);
    try {
      return value
        .map((item) => formatValue(item, ancestors))
        .filter(Boolean)
        .join(", ");
    } finally {
      ancestors.delete(value);
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  return String(value);
}

export function getFrontmatterTitle(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
