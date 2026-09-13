import { createPiModelCatalog } from "@adapters/pi/model-catalog";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTempAgent } from "./temp-agent.ts";

it("uses SDK capability holes and clamps previews without changing settings", async () => {
  const temp = await createTempAgent("web-pi-model-preview-");
  try {
    await writeFile(
      join(temp.agentDir, "models.json"),
      JSON.stringify({
        providers: {
          preview: {
            api: "openai-completions",
            baseUrl: "http://unused.invalid",
            apiKey: "fixture",
            models: [
              {
                id: "holes",
                reasoning: true,
                thinkingLevelMap: {
                  off: null,
                  minimal: null,
                  low: null,
                  medium: "balanced",
                  high: "thorough",
                  max: "maximum",
                },
              },
            ],
          },
        },
      }),
    );
    const settings = JSON.stringify({
      defaultThinkingLevel: "low",
      modelThinkingLevels: { "preview/holes": "high" },
    });
    const file = join(temp.agentDir, "settings.json");
    await writeFile(file, settings);
    const catalog = createPiModelCatalog({ agentDir: temp.agentDir });
    const model = (await catalog.list(temp.project)).models.find(
      (entry) => entry.id === "holes",
    );
    if (!model) throw new Error("Missing fixture model");
    expect(model.thinkingLevels).toEqual([
      { level: "medium", label: "balanced" },
      { level: "high", label: "thorough" },
      { level: "max", label: "maximum" },
    ]);
    expect(await catalog.resolveThinking(temp.project, model)).toBe("high");
    expect(
      await catalog.resolveThinking(temp.project, { ...model, pin: "max" }),
    ).toBe("max");
    expect(
      await catalog.resolveThinking(
        temp.project,
        { ...model, pin: "max" },
        "minimal",
      ),
    ).toBe("medium");
    expect(await catalog.resolveThinking(temp.project, model, "xhigh")).toBe(
      "max",
    );
    // A stored session without a thinking entry uses the global default, not a scope pin or per-model default.
    expect(
      await catalog.resolveThinking(
        temp.project,
        { ...model, pin: "max" },
        undefined,
        true,
      ),
    ).toBe("medium");
    expect(await readFile(file, "utf8")).toBe(settings);
  } finally {
    await temp.dispose();
  }
});
