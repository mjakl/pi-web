# Provenance

## Origin

This skill was promoted from the self-written project skill at `.agents/skills/design-hexagonal-deep-modules/` in `ACalmCo/remy`, copied from commit `12af4b3958b1c68c162b7a40f86ea0601f1442d3`.

Its bundled offline source digest synthesizes ideas from Alistair Cockburn, John Ousterhout, Joshua Bloch, Martin Fowler, AWS guidance, Netflix, Arho Huttunen, codecentric, the C4 model, and contract-testing literature. Exact optional links remain in `references/provenance-optional.md`.

The 2026 catalog review also consulted:

- `mattpocock/skills` `codebase-design` and `improve-codebase-architecture` at `8b78b531ab965735c5dc74f6f7a219e1e37326df`;
- `cursor/plugins` pstack `architect` and `principle-separate-before-serializing-shared-state` at `fd6dd6f7276956a532bb78a748a8d2818b6eb5f4`.

## Catalog adaptation

- Preserved the Internal / Shared / Published strictness model and the rule to use the least strict safe contract.
- Defined scope by consumer lifecycle instead of code visibility, packaging, protocol, or deployment type.
- Added an applicability gate that permits the result “No architecture change is justified.”
- Preserved offline-first, self-contained references.
- Reframed contracts and architecture documents as optional artifacts selected by risk.
- Replaced universal service contract-test rules with compatibility evidence appropriate to the interface medium.
- Clarified dependency direction, adapter responsibilities, composition code, and the meaning of module depth.
- Added leverage, locality, the deletion test, private internal seams, and a portable design-it-twice option from the Matt Pocock review.
- Adapted pstack's caller-first design sketch for every proposed interface: show representative use before signatures, derive the contract from caller work, and omit implementation scaffolding.
- Adapted pstack's shared-state principle conditionally: separate writer ownership first, and use a single writer, locking, or serialization only when shared state is a real invariant.
- Rejected pstack's mandatory multi-model arena, hard-coded models, implementation phases, scaffold commits, and planned intermediate breakage.
- Rejected proactive architecture scanning, mandatory HTML reports, fixed vocabulary, and refactoring without concrete pressure.
- During implementation planning, require an explicit request for architecture design or to resolve a previously identified blocking boundary-shape decision. This keeps detailed port and adapter design out of routine planning while allowing it before implementation when needed.
- Keep the skill focused on standalone boundary design and explicit architecture phases during implementation planning. It does not perform focused or codebase-wide architecture assessment; readiness review belongs to a separate workflow.
- Treat architecture documentation as a separate authorized publication step. Design may identify documentation gaps but does not authorize file or implementation changes.

## Standing decisions

- Do not apply hexagonal architecture or interface ceremony without concrete change pressure.
- Do not treat every code-level public interface as published to independent consumers.
- Prefer deep modules with small interfaces and hidden implementation complexity.
- Keep the skill independently installable and usable without web access.
