import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "@/lib/ansi";
import { runNpx } from "@/lib/npx";
import { authorizeDirectory } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
export async function POST(req: Request) {
  try {
    const { package: pkg, scope, cwd } = await req.json() as { package?: string; scope?: string; cwd?: string };
    if (!pkg?.trim()) return Response.json({ error: "package required" }, { status: 400 });

    const isGlobal = scope !== "project";
    if (!isGlobal) {
      if (!cwd) return Response.json({ error: "cwd required for project install" }, { status: 400 });
      const authorized = await authorizeDirectory(cwd);
      if ("error" in authorized) {
        return Response.json({ error: authorized.error }, { status: authorized.status });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        return Response.json(
          { error: "Project resources must be trusted before installing project skills" },
          { status: 403 },
        );
      }
    }
    const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"];
    if (isGlobal) args.push("-g");

    console.log(`[skills/install] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: 60000,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const output = stripAnsi(stdout + stderr);
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (!success) {
      return Response.json({ error: output.slice(-300) || "Install failed" }, { status: 500 });
    }
    return Response.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = stripAnsi((err.stdout ?? "") + (err.stderr ?? ""));
    return Response.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}
