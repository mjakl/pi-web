import { NextResponse } from "next/server";
import { readSessionRowMetadata } from "@/lib/session-metadata";
import {
  SESSION_METADATA_BATCH_SIZE,
  type SessionMetadataFingerprint,
} from "@/lib/session-metadata-types";
import { resolveSessionPath } from "@/lib/session-reader";

interface MetadataRequestEntry extends SessionMetadataFingerprint {
  id: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function parseEntries(value: unknown): MetadataRequestEntry[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > SESSION_METADATA_BATCH_SIZE) return null;
  const entries: MetadataRequestEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const { id, fileSize, modified } = candidate as Record<string, unknown>;
    if (
      typeof id !== "string"
      || !SESSION_ID_PATTERN.test(id)
      || typeof fileSize !== "number"
      || !Number.isSafeInteger(fileSize)
      || fileSize < 0
      || typeof modified !== "string"
      || !Number.isFinite(Date.parse(modified))
    ) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, fileSize, modified });
  }
  return entries.length > 0 ? entries : null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const entries = parseEntries((body as { sessions?: unknown } | null)?.sessions);
  if (!entries) {
    return NextResponse.json(
      { error: `sessions must contain 1-${SESSION_METADATA_BATCH_SIZE} valid inventory entries` },
      { status: 400 },
    );
  }

  const metadata = [];
  const staleSessionIds: string[] = [];
  for (const entry of entries) {
    try {
      const filePath = await resolveSessionPath(entry.id);
      if (!filePath) {
        staleSessionIds.push(entry.id);
        continue;
      }
      const result = await readSessionRowMetadata(filePath, entry.id, entry);
      if (result) metadata.push(result);
      else staleSessionIds.push(entry.id);
    } catch {
      staleSessionIds.push(entry.id);
    }
  }

  return NextResponse.json(
    { metadata, staleSessionIds },
    { headers: { "Cache-Control": "no-store" } },
  );
}
