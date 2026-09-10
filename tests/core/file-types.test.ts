import {
  extensionOf,
  fileKind,
  formatBytes,
  hasPreview,
  iconOf,
  languageOf,
  mimeOf,
} from "@core/file-types";
import { describe, expect, it } from "vitest";

describe("languageOf", () => {
  it("recognises the special file names before any extension", () => {
    expect(languageOf("/repo/Dockerfile")).toBe("dockerfile");
    expect(languageOf("/repo/Dockerfile.web")).toBe("dockerfile");
    expect(languageOf("/repo/.env.local")).toBe("bash");
    expect(languageOf("/repo/Makefile")).toBe("makefile");
  });

  it("maps extensions and falls back to text", () => {
    expect(languageOf("a/b/app.tsx")).toBe("tsx");
    expect(languageOf("a/b/app.YML")).toBe("yaml");
    expect(languageOf("notes.docx")).toBe("word");
    expect(languageOf("report.pdf")).toBe("pdf");
    expect(languageOf("LICENSE")).toBe("text");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("fileKind and mimeOf", () => {
  it("dispatches media by extension", () => {
    expect(fileKind("a.png")).toBe("image");
    expect(fileKind("a.mp3")).toBe("audio");
    expect(fileKind("a.pdf")).toBe("pdf");
    expect(fileKind("a.docx")).toBe("docx");
    expect(fileKind("a.ts")).toBe("text");
    expect(mimeOf("a.svg")).toBe("image/svg+xml");
    expect(mimeOf("a.ts")).toBe("application/octet-stream");
  });
});

describe("hasPreview and iconOf", () => {
  it("offers a preview for markdown and html only", () => {
    expect(hasPreview("readme.md")).toBe(true);
    expect(hasPreview("page.html")).toBe(true);
    expect(hasPreview("main.ts")).toBe(false);
  });

  it("picks one of the panel's symbols", () => {
    expect(iconOf("src", true)).toBe("folder");
    expect(iconOf("main.ts", false)).toBe("code");
    expect(iconOf("tsconfig.json", false)).toBe("config");
    expect(iconOf("logo.png", false)).toBe("image");
    expect(iconOf("LICENSE", false)).toBe("file");
  });
});

describe("formatBytes", () => {
  it("uses one decimal above a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
