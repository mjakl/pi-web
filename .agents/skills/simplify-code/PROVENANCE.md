# Provenance

## Intent

Provide a focused mutation workflow for making already-working code easier to understand while preserving observable behavior. Keep it distinct from read-only review, defect diagnosis, architecture design, testing strategy, and commit creation.

## Source

- Repository: <https://github.com/addyosmani/agent-skills>
- Upstream skill: `skills/code-simplification`
- Initial partial source review: `b4eb0728de5df7235ecc9eb94bece0cf0e87f1f5..df1edb2e05487d0aa6d93c747141e0aed1187f25`
- First adapted revision: `df1edb2e05487d0aa6d93c747141e0aed1187f25`

The catalog skill is an independent adaptation, not a maintained copy of the upstream skill.

The 2026 catalog review also consulted `cursor/plugins` pstack `principle-minimize-reader-load` at `fd6dd6f7276956a532bb78a748a8d2818b6eb5f4`.

## Durable decisions

- Require explicit authorization to edit. Complexity identified during review is not itself permission to refactor.
- Preserve caller-observable outputs, errors, side effects, state transitions, ordering, and required performance characteristics. Internal structure may change when no supported contract depends on it.
- Understand callers, tests, project conventions, and relevant historical constraints before editing. Ask when important behavior cannot be determined safely.
- Scope simplification to the user-identified paths or coherent change. Exclude drive-by cleanup, feature work, unrelated fixes, dependency changes, public-contract changes, architecture redesign, commits, and pushes unless separately authorized.
- Judge simplification by reduced concepts, branches, duplication, indirection, navigation cost, or hidden mutable state a reader must track. Reject fixed line-count, layer-count, time, and nesting thresholds as automatic refactoring rules.
- Treat a large file as an inspection signal rather than a defect. Permit extraction of cohesive private modules when one file combines separable responsibilities and the split reduces reader load without changing public contracts or dependency direction.
- Prefer small, reversible edits with focused checks. Revert attempts that fail validation, require compensating behavior changes, or merely relocate complexity.
- Preserve behavioral test expectations. Permit structural test updates only when they assert private implementation details changed by the authorized refactor.
- Omit upstream's automatic commit step, rigid size rules, broad smell-to-refactor mappings, and language-specific recipes whose semantics depend on context.
- Keep the skill independently installable and require deliberate invocation in supported harnesses. It does not invoke or require review, testing, architecture, or Git skills.

## Catalog policy exception

Manual-only invocation is a deliberate harness-specific exception to the catalog's portable-frontmatter default. Pi and Claude Code honor `disable-model-invocation: true`; Codex honors `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The skill remains explicitly invocable in each harness, and review cannot load it automatically. Other clients may ignore these controls and continue to rely on the description's explicit authorization boundary.

Future source reviews should preserve these decisions unless a deliberate catalog change records new rationale.
