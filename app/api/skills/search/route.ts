import type { SkillSearchResult } from "@/lib/api-types";
import { errorMessage } from "@/lib/error-message";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

interface SkillsApiSkill {
  id?: string;
  name?: string;
  source?: string;
  installs?: number;
}

interface SkillsApiResponse {
  skills?: SkillsApiSkill[];
}

function parseLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

  const data = (await res.json()) as SkillsApiResponse;
  return (data.skills ?? [])
    .slice()
    .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0))
    .map((skill) => {
      const name = skill.name?.trim();
      const source = skill.source?.trim();
      const slug = skill.id?.trim();
      if (!name || (!source && !slug)) return null;

      const pkg = `${source || slug}@${name}`;
      return {
        package: pkg,
        installs: formatInstalls(skill.installs),
        url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
      };
    })
    .filter((skill): skill is SkillSearchResult => skill !== null);
}

// POST /api/skills/search  body: { query: string, limit?: number }
export async function POST(req: Request) {
  try {
    const { query, limit: rawLimit } = await req.json() as { query?: string; limit?: unknown };
    if (!query?.trim()) return Response.json({ error: "query required" }, { status: 400 });
    const limit = parseLimit(rawLimit);

    const results = await searchSkillsApi(query.trim(), limit);
    return Response.json({ results });
  } catch (e: unknown) {
    // skills.sh is the only source of truth for search. SkillsConfig renders
    // this error; a bad gateway is the honest status for an upstream failure.
    return Response.json({ error: errorMessage(e) }, { status: 502 });
  }
}
