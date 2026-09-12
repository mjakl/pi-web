# Provenance

## Intent

Provide one narrow GitHub issue workflow for durable, PR-sized change requests without introducing a tracker abstraction, triage system, or local execution queue.

## Sources

Reviewed from `mattpocock/skills` at `8b78b531ab965735c5dc74f6f7a219e1e37326df`:

- `setup-matt-pocock-skills`
- `to-spec`
- `triage`

## Durable decisions

- Keep GitHub issues independent from local `tk` tickets. Connect them only when the user explicitly requests it.
- Follow repository issue templates and conventions before catalog defaults.
- Use a small outcome-focused issue structure instead of a fixed specification system.
- Do not add canonical triage roles, automatic labels, external pull-request intake, or out-of-scope records.
- Require confirmation before every issue mutation.
- Keep the skill independently installable. It requires authenticated `gh`, not another skill.
