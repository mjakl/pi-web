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

const ICON_BY_LANGUAGE: Record<string, string> = {
  bash: "code",
  c: "code",
  cpp: "code",
  csharp: "code",
  css: "code",
  dart: "code",
  diff: "code",
  dockerfile: "config",
  elixir: "code",
  go: "code",
  graphql: "code",
  haskell: "code",
  hcl: "config",
  html: "code",
  ini: "config",
  java: "code",
  javascript: "code",
  json: "config",
  jsx: "code",
  kotlin: "code",
  less: "code",
  lua: "code",
  makefile: "config",
  markdown: "doc",
  nginx: "config",
  objectivec: "code",
  perl: "code",
  php: "code",
  powershell: "code",
  protobuf: "code",
  python: "code",
  r: "code",
  ruby: "code",
  rust: "code",
  scala: "code",
  scss: "code",
  sql: "config",
  swift: "code",
  toml: "config",
  tsx: "code",
  typescript: "code",
  word: "doc",
  xml: "code",
  yaml: "config",
};

/**
 * One of a handful of symbols the panel defines inline. A per-language icon
 * set would be prettier; it would also be a few hundred vendored SVGs.
 */
export function iconOf(path: string, isDir: boolean): string {
  if (isDir) return "folder";
  const kind = fileKind(path);
  if (kind !== "text") return kind === "docx" ? "doc" : kind;
  return ICON_BY_LANGUAGE[languageOf(path)] ?? "file";
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}
