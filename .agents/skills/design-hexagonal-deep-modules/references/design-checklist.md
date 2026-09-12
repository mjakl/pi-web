# Design Checklist: Hexagonal Architecture and Deep Modules

Use only the sections relevant to the proposed boundary. A failed item is a reason to reconsider the proposal, not automatic proof that the design is wrong.

## 1. Applicability

- What observed change, ownership, testing, substitution, or compatibility problem does this boundary solve?
- Is the proposed abstraction smaller than the problem it addresses?
- Would a direct change be simpler and safe?
- Can the correct result be “no architecture change”?

## 2. Interface scope

- Is each material interface classified as Internal, Shared, or Published by consumer lifecycle?
- Are all Internal consumers changed through one coordinated release?
- Are Shared consumers known and able to coordinate a compatibility period?
- Are Published consumers uncoordinated, unknown, or covered by an external lifecycle promise?
- Is strict compatibility work limited to interfaces that need it?
- Does representative caller usage agree with the proposed interface and its outcomes?

## 3. Boundaries and dependencies

- The application core does not depend on delivery or persistence technology.
- Core-owned ports describe business capabilities, not transport or storage mechanisms.
- Inbound adapters handle delivery concerns without owning domain policy.
- Outbound adapters implement capabilities needed by the core.
- Transport and persistence representations are translated at their boundaries.
- Composition code is explicit and is allowed to know both core and adapters.
- Business rules are not duplicated across adapters.
- Concurrent writers own separate state where possible; locking or serialization protects only state that must genuinely be shared.

## 4. Module depth

- Each module provides one cohesive abstraction.
- The interface is simple relative to the useful complexity hidden behind it.
- The module gives callers useful leverage and keeps related decisions local.
- The deletion test shows that removing the module would spread, not erase, complexity.
- Internal implementation or test seams remain private unless callers need them.
- Names describe domain intent.
- Configuration options expose only decisions that callers must control.
- A thin wrapper exists only when it provides ownership, policy, substitution, compatibility, or a useful test boundary.
- No module or layer exists only to match the architecture pattern.

## 5. Contract semantics

Contract behavior is discoverable in code, tests, or focused documentation:

- inputs and outcomes;
- domain rejection versus technical failure;
- important security and consistency rules;
- timeout, retry, ordering, and duplicate-request behavior where relevant.

For Shared or Published interfaces, migration expectations are clear.

For Published interfaces, automated compatibility evidence matches the medium and risk. Consumer/provider tests are one option, not a universal requirement.

## 6. Documentation (conditional)

Apply this section only when the design identifies a documentation change for a later authorized publication step.

- Proposed changes update an existing authoritative document before adding another artifact.
- A proposed port catalog would include current scope and status.
- A proposed module map would be understandable without a deep code review.
- A proposed adapter map would link adapters to ports.
- Proposed flow documentation stays at the port and module level.
- Proposed decision records link to affected boundaries.
- No parallel documentation set is proposed when an authoritative location already exists.

Do not require a catalog, map, matrix, flow document, or decision index only to satisfy this checklist.

## 7. Testing and compatibility

- Core rules can be tested without starting unnecessary delivery or persistence systems.
- Use-case behavior is tested at the narrowest useful interface.
- Adapter conformance is tested when several implementations share a meaningful contract or boundary risk is high.
- End-to-end tests cover only important wiring and cross-boundary behavior.
- Compatibility checks match the interface medium and consumer lifecycle.

## 8. Warning signs

Investigate these conditions:

- Port signatures expose HTTP request objects, ORM entities, or other technology representations without a clear reason.
- The application core imports delivery or persistence framework code.
- An adapter owns domain policy.
- The module interface is large and hides little complexity.
- Contract behavior is unclear or contradicted by code and tests.
- Every interface is treated as Published in a controlled application.
- A Published interface changes without suitable compatibility evidence and migration guidance.
- Documentation is created but not connected to an authoritative maintenance process.

## 9. Comprehension check

For a material Standard or Full boundary, an implementer unfamiliar with the planning conversation can answer the relevant questions:

1. Which module owns an important business rule?
2. Which inbound port should an adapter call, or which outbound port should it implement?
3. Which consumers can be affected by an interface change?
4. Where should a new capability be added?
