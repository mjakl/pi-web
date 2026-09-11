// What a path is: the language a viewer highlights it as, whether it is media
// the browser can play, the MIME type a download carries, and the icon the
// explorer draws. Extension-only, as pi-web does; content sniffing would need
// a read before the containment check has run.

export type FileKind = "image" | "audio" | "pdf" | "docx" | "text";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
};

const DOCUMENT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const LANGUAGE: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "text",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  docx: "word",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  h: "c",
  hcl: "hcl",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  nginx: "nginx",
  m: "objectivec",
  patch: "diff",
  pdf: "pdf",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  tf: "hcl",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export function baseName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  return parts.at(-1) ?? path;
}

/** Lowercased text after the last dot, empty when the name has none. */
export function extensionOf(path: string): string {
  const name = baseName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

/** The grammar a viewer highlights with; "text" when nothing matches. */
export function languageOf(path: string): string {
  const name = baseName(path).toLowerCase();
  if (name.startsWith("dockerfile")) return "dockerfile";
  if (name.startsWith(".env")) return "bash";
  if (name === "makefile" || name === "gnumakefile") return "makefile";
  if (name === "cmakelists.txt") return "makefile";
  return LANGUAGE[extensionOf(path)] ?? "text";
}

export function fileKind(path: string): FileKind {
  const extension = extensionOf(path);
  if (extension in IMAGE_MIME) return "image";
  if (extension in AUDIO_MIME) return "audio";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  return "text";
}

/** The MIME a raw response carries; octet-stream for anything unknown. */
export function mimeOf(path: string): string {
  const extension = extensionOf(path);
  return (
    IMAGE_MIME[extension] ??
    AUDIO_MIME[extension] ??
    DOCUMENT_MIME[extension] ??
    "application/octet-stream"
  );
}

/** Markdown and HTML are worth showing rendered rather than as source. */
export function hasPreview(path: string): boolean {
  const language = languageOf(path);
  return language === "markdown" || language === "html";
}

/**
 * The Catppuccin icon a file name maps to, exactly as pi-web's `FileIcons.tsx`
 * picks it. It lives here rather than beside the SVGs because two renderers
 * need the same answer: the JSX views, and the client bundle that draws the
 * file tab strip in the browser.
 */
export type CatppuccinIcon =
  | "_file"
  | "_folder"
  | "_folder_open"
  | "bash"
  | "bun-lock"
  | "config"
  | "css"
  | "database"
  | "docker"
  | "env"
  | "eslint"
  | "git"
  | "go"
  | "graphql"
  | "html"
  | "javascript"
  | "javascript-react"
  | "json"
  | "lock"
  | "markdown"
  | "ms-word"
  | "next"
  | "npm-lock"
  | "pdf"
  | "python"
  | "rust"
  | "sass"
  | "terraform"
  | "toml"
  | "typescript"
  | "typescript-react"
  | "yaml";

const EXTENSION_ICONS: Record<string, CatppuccinIcon> = {
  ts: "typescript",
  tsx: "typescript-react",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript-react",
  py: "python",
  json: "json",
  jsonl: "json",
  css: "css",
  less: "css",
  scss: "sass",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  rs: "rust",
  go: "go",
  sql: "database",
  graphql: "graphql",
  gql: "graphql",
  tf: "terraform",
  hcl: "terraform",
  docx: "ms-word",
  pdf: "pdf",
  lock: "lock",
};

const ESLINT_CONFIGS = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.yml",
  "eslint.config.mjs",
  "eslint.config.js",
];

const NEXT_CONFIGS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
];

function specialIcon(name: string): CatppuccinIcon | undefined {
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "docker";
  if (name === ".env" || name.startsWith(".env.")) return "env";
  if ([".gitignore", ".gitattributes", ".gitmodules"].includes(name)) {
    return "git";
  }
  if (name === "package-lock.json") return "npm-lock";
  if (name === "bun.lock") return "bun-lock";
  if (NEXT_CONFIGS.includes(name)) return "next";
  if (ESLINT_CONFIGS.includes(name)) return "eslint";
  if (["yarn.lock", "pnpm-lock.yaml", "cargo.lock"].includes(name)) {
    return "lock";
  }
  if (/\.config\.(ts|js|mjs|cjs)$/.test(name)) return "config";
  return undefined;
}

/** A special name first, then the extension, then the generic file icon. */
export function catppuccinIcon(name: string): CatppuccinIcon {
  const lower = baseName(name).toLowerCase();
  return (
    specialIcon(lower) ??
    EXTENSION_ICONS[lower.split(".").pop() ?? ""] ??
    "_file"
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}
