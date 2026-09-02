# Provenance

## Intent

Provide one general testing skill rather than separate testing, TDD, regression, and test-audit workflows.

## Sources

- `mattpocock/skills` `tdd` at `8b78b531ab965735c5dc74f6f7a219e1e37326df`
- `cursor/plugins` pstack `principle-make-operations-idempotent` at `fd6dd6f7276956a532bb78a748a8d2818b6eb5f4`
- Self-written Remy testing and testing-audit guidance
- User preference for outside-in tests at stable seams, following the classic TDD vocabulary

## Durable decisions

- The central rule is: test observable behavior through the smallest stable seam used by a real caller.
- Outside-in does not mean every test must be end-to-end.
- Keep one primary test owner for each behavior and avoid duplicated assertions across layers.
- Preserve Matt's behavior focus, independent expected values, vertical slices, and external-boundary mocking.
- Use one `testing` skill with TDD and regression branches instead of a separate `tdd` skill.
- Use a complete red-green-refactor loop. Refactoring is part of TDD after green.
- Do not require user confirmation for every seam. Ask only when the boundary choice is material.
- Keep a planning-stage test concept distinct from detailed test design: required behavior and evidence constraints do not by themselves trigger seam, fixture, double, or framework selection.
- Adapt pstack's repeated-run and interruption questions without imposing universal idempotence: when repetition or partial execution is realistic, establish whether the contract must converge, resume, roll back, or reject safely, then test representative boundaries and final observable state.
- Follow project testing commands and conventions before generic taxonomy.
- Keep the skill independently installable and free of named skill dependencies.
