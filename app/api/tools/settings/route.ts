import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";
import { errorMessage } from "@/lib/error-message";

export async function GET() {
  try {
    return Response.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: await readPowerShellToolEnabled(),
    });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (process.platform !== "win32") {
    return Response.json({ error: "PowerShell tool settings are only available on Windows" }, { status: 404 });
  }

  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    return Response.json({
      isWindows: true,
      powerShellEnabled: await writePowerShellToolEnabled(body.enabled),
    });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: 500 },
    );
  }
}
