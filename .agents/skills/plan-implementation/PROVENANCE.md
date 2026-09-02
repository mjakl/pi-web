# Provenance

## Intent

Provide one repository-grounded, read-only implementation plan for a settled PR-sized change. Own enabling-refactor and implementation sequencing while leaving product clarification, initiative mapping, detailed architecture shape, test implementation, and code changes outside the workflow.

## Sources consulted

### Addy Osmani

Repository: <https://github.com/addyosmani/agent-skills> at `df1edb2e05487d0aa6d93c747141e0aed1187f25`

- `planning-and-task-breakdown`
- `incremental-implementation`
- `spec-driven-development`
- `doubt-driven-development`

### Matt Pocock

Repository: <https://github.com/mattpocock/skills> at `8b78b531ab965735c5dc74f6f7a219e1e37326df`

- `to-tickets`
- `codebase-design`
- `to-spec`
- `improve-codebase-architecture`

### Catalog sources

- `design-hexagonal-deep-modules` applicability, ownership, compatibility, and anti-ceremony decisions
- `testing` stable behavioral evidence principles
- `lets-clarify` contract-evidence and bounded-acceptance-criteria decisions
- Former focused `code-review` and branch-wide `code-audit` lifecycle and evidence rules

The catalog skill is an independent synthesis, not a maintained copy of any source.

## Durable decisions

- Trigger for an explicitly requested implementation plan for one settled PR-sized change, including the planning phase of a combined plan-and-implement request. Return only a concise route when the change is obvious. Do not replace one-decision clarification, multi-PR initiative mapping, general architecture review, or implementation-only work.
- Keep the planning workflow read-only and conversation-first. A combined plan-and-implement request authorizes a later implementation phase, not edits inside planning. A durable plan artifact is a separate publication step after analysis and explicit path/content confirmation.
- Ground every plan in current repository ownership, callers, interfaces, tests, configuration, data, operations, and relevant history. Treat file lists as estimates and state material gaps.
- Use repository evidence to verify the affected contract against the settled specification. Treat an omitted dimension as a specification gap only when evidence shows it materially applies; surface the gap instead of inventing behavior, and make it blocking only when the answer changes implementation.
- Use “make the change easy, then make the easy change” only when an enabling refactor has concrete payoff for the requested behavior. Separate behavior-preserving prefactoring from behavior-changing implementation.
- Adapt Matt's expand–contract guidance as expand–migrate–contract for wide compatibility-preserving transitions. Do not force ordinary changes into that sequence.
- Adapt Addy's dependency ordering, vertical slicing, contract-first and risk-first alternatives, explicit assumptions, success criteria, scope discipline, safe rollout concerns, and reversibility. Treat feature flags as one contextual exposure mechanism rather than a universal rule. Reject fixed task sizes, line thresholds, mandatory plan files, automatic tracker publication, scheduled checkpoint cadence, and automatic execution or commits.
- Carry a small self-contained architecture-pressure gate, not detailed port, adapter, or module design. When detailed architecture was also explicitly requested, complete it as a distinct read-only phase; otherwise record blocking shape decisions without requiring or invoking another skill.
- Define a test concept as required behavior and coverage constraints. Do not choose new frameworks, private hooks, fixtures, doubles, or detailed test seams during planning.
- Embed focused verification and risk triggers in the plan itself so implementation can detect drift without invoking a review skill. Merely completing an increment is not a review trigger.
- Adapt doubt-driven work as bounded self-challenge of assumptions and falsifying evidence. Reject mandatory fresh-context reviewers, subagents, cross-model escalation, and repeated approval loops.
- Keep the skill independently installable. Require deliberate invocation in supported harnesses; detailed implementation planning is an explicit phase rather than an automatic response to repository work. Do not name or require sibling catalog skills in its executable instructions.

## Catalog policy exception

Manual-only invocation is a deliberate harness-specific exception to the catalog's portable-frontmatter default. Pi and Claude Code honor `disable-model-invocation: true`; Codex honors `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The skill remains explicitly invocable in each harness. Other clients may ignore these controls and continue to rely on the description.

Future source reviews should preserve these decisions unless a deliberate catalog change records new rationale.
