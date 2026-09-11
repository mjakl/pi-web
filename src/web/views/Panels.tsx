import type { ToolView } from "@core/ports";

// What the session is actually running with: the tools it may call and the
// prompt it was given. Both come from the live session and nothing is started
// to fetch them — a stopped session simply says so.

function Panel({ title, children }: { title: string; children?: unknown }) {
  return (
    <dialog class="modal" data-modal open>
      <div class="modal-box max-w-3xl">
        <div class="mb-3 flex items-center gap-2">
          <h2 class="flex-1 text-lg font-semibold">{title}</h2>
          <form method="dialog">
            <button class="btn btn-ghost btn-sm" aria-label="Close">
              ✕
            </button>
          </form>
        </div>
        {children}
      </div>
      <form method="dialog" class="modal-backdrop">
        <button aria-label="Close">close</button>
      </form>
    </dialog>
  );
}

export function SystemPromptPanel({ prompt }: { prompt: string | undefined }) {
  return (
    <Panel title="System prompt">
      {prompt === undefined ? (
        <p class="text-sm text-base-content/60">
          System prompt has not loaded yet. Start the session to see it.
        </p>
      ) : prompt === "" ? (
        <p class="text-sm text-base-content/60">
          System prompt is empty (tools are disabled).
        </p>
      ) : (
        <pre class="max-h-[min(600px,75dvh)] overflow-auto rounded bg-base-200 p-3 font-mono text-xs whitespace-pre-wrap">
          {prompt}
        </pre>
      )}
    </Panel>
  );
}

function ToolDetail({ tool }: { tool: ToolView }) {
  return (
    <div class="flex flex-col gap-3 text-sm">
      <div>
        <h3 class="text-xs text-base-content/50">Description</h3>
        <p class="whitespace-pre-wrap">{tool.description}</p>
      </div>
      <div>
        <h3 class="text-xs text-base-content/50">
          Parameters ({String(tool.parameters.length)})
        </h3>
        {tool.parameters.length === 0 ? (
          <p class="text-xs opacity-60">None</p>
        ) : (
          <ul class="flex flex-col gap-2 text-xs">
            {tool.parameters.map((parameter) => (
              <li>
                <span class="font-mono font-medium">{parameter.name}</span>{" "}
                <span class="opacity-60">{parameter.type}</span>{" "}
                <span
                  class={`badge badge-xs ${parameter.required ? "badge-primary" : "badge-ghost"}`}
                >
                  {parameter.required ? "Required" : "Optional"}
                </span>
                {parameter.description === undefined ? null : (
                  <p class="opacity-70">{parameter.description}</p>
                )}
                {parameter.enum === undefined ? null : (
                  <p class="opacity-60">Allowed: {parameter.enum.join(", ")}</p>
                )}
                {parameter.default === undefined ? null : (
                  <p class="opacity-60">Default: {parameter.default}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {tool.promptGuidelines === undefined ? null : (
        <div>
          <h3 class="text-xs text-base-content/50">Prompt guidelines</h3>
          <ul class="list-disc pl-4 text-xs">
            {tool.promptGuidelines.map((line) => (
              <li>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Only the tools this turn may call: an inactive one cannot be reached. */
export function ToolsPanel({
  sessionId,
  tools,
  selected,
}: {
  sessionId: string;
  tools: ToolView[] | undefined;
  selected?: string;
}) {
  if (tools === undefined) {
    return (
      <Panel title="Tools">
        <p class="text-sm text-base-content/60">
          Tool definitions have not loaded yet. Start the session to see them.
        </p>
      </Panel>
    );
  }
  const active = tools.filter((tool) => tool.active);
  const shown = active.find((tool) => tool.name === selected) ?? active[0];
  return (
    <Panel title={`Tools (${String(active.length)})`}>
      {active.length === 0 ? (
        <p class="text-sm text-base-content/60">No active tools</p>
      ) : (
        <div class="flex max-h-[min(600px,70dvh)] flex-col gap-3 md:flex-row">
          <ul class="menu w-full shrink-0 flex-nowrap overflow-y-auto p-0 text-sm md:w-48">
            {active.map((tool) => (
              <li>
                <button
                  type="button"
                  class={`rounded-none ${tool.name === shown?.name ? "menu-active" : ""}`}
                  hx-get={`/sessions/${sessionId}/tools?tool=${encodeURIComponent(tool.name)}`}
                  hx-target="#dialogs"
                  hx-swap="innerHTML"
                >
                  <span class="truncate font-mono text-xs">{tool.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div class="min-w-0 flex-1 overflow-y-auto">
            {shown ? <ToolDetail tool={shown} /> : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
