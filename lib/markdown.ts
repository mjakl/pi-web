import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

const markdownSanitizeSchema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

// Parse YAML frontmatter into a `yaml` node before the GFM plugin runs, so
// the raw metadata never leaks into the rendered output (without it, the opening
// `---` becomes an <hr> and the closing `---` turns the YAML into a setext heading).
// singleTilde:false requires ~~double~~ tildes for strikethrough. A single `~`
// is the standard CJK numeric-range separator (e.g. "5~7U", "100~200倍"), and
// GFM's default single-tilde strikethrough silently mangled such ranges (#385).
const remarkGfmOptions = { singleTilde: false } as const;

export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [
  [remarkFrontmatter, ["yaml"]],
  [remarkGfm, remarkGfmOptions],
];
export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];
