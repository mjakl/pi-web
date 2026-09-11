import type { ToolView } from "@core/ports";

// What the session is actually running with: the tools it may call and the
// prompt it was given. Both come from the live session and nothing is started
// to fetch them — a stopped session simply says so.

function Panel({ title, children }: { title: string; children?: unknown }) {
  return (
    <dialog data-modal open>
      <div>
        <div>
          <h2>{title}</h2>
          <form method="dialog">
            <button aria-label="Close">✕</button>
          </form>
        </div>
        {children}
      </div>
      <form method="dialog">
        <button aria-label="Close">close</button>
      </form>
    </dialog>
  );
}

export function SystemPromptPanel({ prompt }: { prompt: string | undefined }) {
  return (
    <Panel title="System prompt">
      {prompt === undefined ? (
        <p>System prompt has not loaded yet. Start the session to see it.</p>
      ) : prompt === "" ? (
        <p>System prompt is empty (tools are disabled).</p>
      ) : (
        <pre>{prompt}</pre>
      )}
    </Panel>
  );
}

function ToolDetail({ tool }: { tool: ToolView }) {
  return (
    <div>
      <div>
        <h3>Description</h3>
        <p>{tool.description}</p>
      </div>
      <div>
        <h3>Parameters ({String(tool.parameters.length)})</h3>
        {tool.parameters.length === 0 ? (
          <p>None</p>
        ) : (
          <ul>
            {tool.parameters.map((parameter) => (
              <li>
                <span>{parameter.name}</span> <span>{parameter.type}</span>{" "}
                <span>{parameter.required ? "Required" : "Optional"}</span>
                {parameter.description === undefined ? null : (
                  <p>{parameter.description}</p>
                )}
                {parameter.enum === undefined ? null : (
                  <p>Allowed: {parameter.enum.join(", ")}</p>
                )}
                {parameter.default === undefined ? null : (
                  <p>Default: {parameter.default}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {tool.promptGuidelines === undefined ? null : (
        <div>
          <h3>Prompt guidelines</h3>
          <ul>
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
        <p>
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
        <p>No active tools</p>
      ) : (
        <div>
          <ul>
            {active.map((tool) => (
              <li>
                <button
                  type="button"
                  class="menu-item"
                  aria-current={tool.name === shown?.name ? "true" : "false"}
                  hx-get={`/sessions/${sessionId}/tools?tool=${encodeURIComponent(tool.name)}`}
                  hx-target="#dialogs"
                  hx-swap="innerHTML"
                >
                  <span>{tool.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div>{shown ? <ToolDetail tool={shown} /> : null}</div>
        </div>
      )}
    </Panel>
  );
}
