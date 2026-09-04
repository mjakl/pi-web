import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { promisify } from "util";
import { contentDisposition } from "@/lib/content-disposition";
import { resolveSessionPath } from "@/lib/session-reader";

const execFileAsync = promisify(execFile);

const CODING_AGENT = "@earendil-works/pi-coding-agent";

function getPiCliPath(): string {
  const runtime = JSON.parse(process.env.PI_WEB_HOST_PI ?? "{}") as {
    packages?: Record<string, { dir?: unknown }>;
  };
  const packageDir = runtime.packages?.[CODING_AGENT]?.dir;
  if (typeof packageDir !== "string") throw new Error("Validated host Pi runtime is missing");
  return join(packageDir, "dist", "bundle", "cli.js");
}

/**
 * Patch the exported HTML to fix recursive functions that overflow
 * the call stack on deep linear session trees (e.g., 5000+ entries).
 *
 * ## Root Cause
 * pi-coding-agent's template.js uses recursive helpers to render and
 * navigate the session tree in the exported HTML:
 *
 *   1. sortChildren(node) — recursively sorts children of every node.
 *      Calls itself via node.children.forEach(sortChildren).
 *      On a 5527-entry linear chain (no branches), this recurses 5527
 *      levels deep → stack overflow.
 *
 *   2. mapNodes(node) — recursively indexes tree nodes the first time
 *      a tree item is clicked. Same depth -> same overflow.
 *
 *   3. markActive(node) — recursively marks nodes on the active path.
 *      Calls itself via markActive(child) for each child.
 *      Same depth → same overflow.
 *
 * Both functions are inlined in the HTML by pi-coding-agent at export
 * time. We cannot modify template.js directly (it's in node_modules
 * and would be overwritten on npm install). Instead, we patch the
 * generated HTML string before returning it to the client.
 *
 * ## Fix
 * Replace each recursive function with an iterative equivalent:
 *
 *   sortChildren  → explicit stack (DFS pre-order, push children in
 *                   reverse to maintain order)
 *   mapNodes      → explicit stack (DFS pre-order)
 *   markActive    → two-stack post-order (stack1 for traversal,
 *                   stack2 for processing children before parent)
 *
 * ## Line Ending Normalization
 * This file (route.ts) uses CRLF (Windows), while template.js uses LF
 * (Unix). The template strings in the backtick literals inherit the
 * file's CRLF line endings. At runtime, readFileSync() also returns
 * CRLF on Windows. We normalize everything to LF before matching.
 *
 * The helper `n(s)` strips \r\n → \n on both the HTML and the
 * replacement strings, ensuring cross-platform matching.
 */
function patchExportHtml(html: string): string {
  // Normalize line endings: route.ts is CRLF, template.js is LF.
  // Without this, the replace() below would fail on Windows.
  const n = (s: string) => s.replace(/\r\n/g, "\n");
  html = n(html);

  const replaceRequired = (source: string, name: string, search: string, replacement: string) => {
    const normalizedSearch = n(search);
    const normalizedReplacement = n(replacement);
    const matches = source.split(normalizedSearch).length - 1;
    if (matches !== 1) {
      throw new Error(`Failed to patch exported HTML: ${name} expected 1 match, found ${matches}`);
    }
    return source.replace(normalizedSearch, normalizedReplacement);
  };

  html = replaceRequired(
    html,
    "sortChildren",
    `        function sortChildren(node) {
          node.children.sort((a, b) =>
            new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
          );
          node.children.forEach(sortChildren);
        }`,
    `        function sortChildren(root) {
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            node.children.sort((a, b) =>
              new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime()
            );
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }
        }`
  );

  html = replaceRequired(
    html,
    "mapNodes",
    `          function mapNodes(node) {
            treeNodeMap.set(node.entry.id, node);
            node.children.forEach(mapNodes);
          }
          tree.forEach(mapNodes);`,
    `          const stack = [...tree].reverse();
          while (stack.length) {
            const node = stack.pop();
            treeNodeMap.set(node.entry.id, node);
            for (let i = node.children.length - 1; i >= 0; i--) {
              stack.push(node.children[i]);
            }
          }`
  );

  html = replaceRequired(
    html,
    "markActive",
    `        function markActive(node) {
          let has = activePathIds.has(node.entry.id);
          for (const child of node.children) {
            if (markActive(child)) has = true;
          }
          containsActive.set(node, has);
          return has;
        }`,
    `        function markActive(root) {
          // Post-order traversal using two stacks
          const stack1 = [root];
          const stack2 = [];
          while (stack1.length) {
            const node = stack1.pop();
            stack2.push(node);
            for (const child of node.children) {
              stack1.push(child);
            }
          }
          while (stack2.length) {
            const node = stack2.pop();
            let has = activePathIds.has(node.entry.id);
            for (const child of node.children) {
              if (containsActive.get(child)) has = true;
            }
            containsActive.set(node, has);
          }
        }`
  );

  return html;
}

async function exportSession(filePath: string, outputPath: string): Promise<void> {
  await execFileAsync(process.execPath, [getPiCliPath(), "--export", filePath, outputPath], {
    cwd: process.cwd(),
    timeout: 30_000,
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
    },
    maxBuffer: 1024 * 1024,
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const inline = new URL(req.url).searchParams.get("inline") === "1";

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const tempDir = join(tmpdir(), "pi-web-export");
    mkdirSync(tempDir, { recursive: true });

    const sessionBase = basename(filePath, ".jsonl");
    const fileName = `pi-session-${sessionBase}.html`;
    const outputPath = join(tempDir, `${randomUUID()}.html`);

    try {
      await exportSession(filePath, outputPath);

      const html = readFileSync(outputPath, "utf8");
      const patchedHtml = patchExportHtml(html);
      return new Response(patchedHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", fileName, "session.html"),
          "Cache-Control": "no-cache",
          "Content-Security-Policy": "frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        },
      });
    } finally {
      rmSync(outputPath, { force: true });
    }
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
