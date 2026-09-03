"use client";

import { useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { ImagePreview } from "./ImagePreview";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";

interface MarkdownBodyProps {
  children: string;
  sessionId?: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, sessionId }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      // react-markdown passes undefined for an empty <code>, which happens on
      // the frame a fence opens mid-stream. String(undefined) printed the word.
      const raw = children == null ? "" : String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      // rehype-sanitize prefixes ids with user-content-, but leaves hrefs
      // alone, so an in-page anchor has to be prefixed to match its target.
      if (href?.startsWith("#")) {
        return <a href={`#user-content-${href.slice(1)}`} {...props}>{children}</a>;
      }
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        // Only a real external scheme earns a new tab. Everything else stays
        // in place rather than navigating the app away from itself.
        const external = /^(https?|mailto):/i.test(href ?? "");
        return (
          <a href={href} {...props} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const query = new URLSearchParams({ type: "read" });
      // Without the session, a path outside every allowed root is a 403 even
      // though the session that wrote it is allowed to read it.
      if (sessionId) query.set("sessionId", sessionId);
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?${query}`
        : src;
      // A src the sanitizer stripped renders as a zero-height block, so show
      // the alt text instead of nothing.
      if (typeof imageSrc !== "string" || imageSrc === "") return <>{alt}</>;
      return (
        <ImagePreview src={imageSrc} alt={alt ?? ""}>
          {/* Dynamic local paths are served directly by the file API. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />
        </ImagePreview>
      );
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, sessionId]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
