# Make Chat only a persisted resource policy

Pi Web treats an explicitly empty tool selection as **Chat only**, not merely as
an AgentSession whose active tool array happens to be empty.

For a normal session, Chat only loads no extensions, skills, prompt templates,
themes, or Pi base system prompt. Its exact system prompt is the ordered content
of the context files discovered by Pi's default loader, including global and
project `AGENTS.md`, `AGENTS.override.md`, and `CLAUDE.md` files. Pi Web does not
add its own prefix, suffix, or current-working-directory text.

Pi's native session format does not persist the active tool selection. Normal
sessions therefore append versioned `pi-web:tool-selection` custom entries:

```json
{
  "type": "custom",
  "customType": "pi-web:tool-selection",
  "data": { "version": 1, "tools": [] }
}
```

The latest valid entry is authoritative. No entry means a legacy session and
retains Pi's default behavior; an empty `tools` array means Chat only; a nonempty
array restores the selected built-in tools. The stored array is the user's
selection before extension tools are added.

The persisted selection must be resolved before `createAgentSessionServices()`
so Chat only never imports or executes session extensions. The exact system
prompt must also be reapplied after Pi's `before_agent_start` phase, because the
SDK rebuilds its base prompt immediately before the model call.

Changing among nonempty tool presets can update an existing wrapper. Crossing
the Chat-only boundary must append the new selection and rebuild the wrapper:
normal wrappers have already loaded extensions, while Chat-only wrappers do not
have those resources available to enable in place. Persisted sessions retain
their id and JSONL file. An unpersisted empty composer session may be discarded
and recreated with a new internal id.
