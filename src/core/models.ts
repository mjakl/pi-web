import type { ModelOption, ThinkingChoice, ThinkingLevel } from "./ports.ts";

// Which model a new session starts on, and which of those choices are written
// back to Pi's settings as the new default.

/** Every level Pi knows, in the order a picker shows them. */
const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Pi writes the level as a plain string; only these seven are levels. */
export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as string[]).includes(value);
}

/**
 * The reasoning levels a model actually offers. Pi's `thinkingLevelMap` marks
 * an unsupported level with `null` and gives the others the name the provider
 * uses; a missing map means the model takes every level as it comes.
 */
export function thinkingChoices(
  map: Partial<Record<string, string | null>> | undefined,
): ThinkingChoice[] {
  return THINKING_LEVELS.filter((level) => map?.[level] !== null).map(
    (level) => ({ level, label: map?.[level] ?? level }),
  );
}

/** The configured default when it is still in scope, else the first model. */
export function initialModel(
  models: readonly ModelOption[],
  preferred?: { provider: string; id: string },
): ModelOption | undefined {
  const match = preferred
    ? models.find(
        (model) =>
          model.provider === preferred.provider && model.id === preferred.id,
      )
    : undefined;
  return match ?? models[0];
}

/**
 * The reasoning level a model starts on: its `enabledModels` pin, else none
 * at all. pi-web leaves an unpinned model on "auto", which is Pi deciding,
 * not a level of its own (useAgentSession.ts L2600).
 */
export function initialThinking(
  model: ModelOption | undefined,
): ThinkingLevel | undefined {
  return model?.pin;
}

export type StartupChoice = {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
};

/**
 * pi-web's `persistExplicitStartupPreferences`: only a choice the reader
 * actually made is written back, and only when Pi honoured it.
 *
 * - the default model is written when the session really started on the
 *   requested model, so a silent fallback never becomes the new default;
 * - the thinking level is written unless it was clamped to `off` because the
 *   model cannot reason at all.
 */
export function startupWrites(
  explicit: StartupChoice,
  effective: {
    model: { provider: string; modelId: string };
    thinkingLevel: ThinkingLevel;
    supportsThinking: boolean;
  },
): StartupChoice {
  const wanted = explicit.model;
  const sameModel =
    wanted !== undefined &&
    wanted.provider === effective.model.provider &&
    wanted.modelId === effective.model.modelId;
  const keepLevel =
    explicit.thinkingLevel !== undefined &&
    (effective.supportsThinking || effective.thinkingLevel !== "off");
  return {
    ...(sameModel ? { model: effective.model } : {}),
    ...(keepLevel ? { thinkingLevel: effective.thinkingLevel } : {}),
  };
}
