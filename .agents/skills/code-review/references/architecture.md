# Architecture review lens

Use this lens only for the audited branch and the system areas it materially affects.

## Boundaries and ownership

Check whether the branch:

- moves business policy into delivery, persistence, framework, or integration code;
- makes core behavior depend on transport, ORM, storage, or UI types;
- lets technology-specific adapters define a capability that should be owned by application policy;
- introduces a port or seam without real substitution, integration, testing, ownership, or compatibility pressure;
- scatters adapter construction and dependency wiring instead of using a clear composition location;
- leaks adapter or framework representations across the boundary instead of translating them there;
- creates duplicated ownership of one workflow or invariant;
- adds a broad coordinator, service, or manager that mostly passes work onward;
- spreads one conceptual change across unrelated modules;
- exposes internal details that callers now need to coordinate;
- puts state mutation in a shared constructor, connection opener, or helper whose other callers did not request it.

Trace all callers of changed shared helpers. A locally reasonable side effect can be a systemic defect when another caller has a different lifecycle.

## Module depth and cognitive load

Look for concrete degradation:

- an interface grows faster than the capability it provides;
- a new abstraction moves complexity without hiding or owning it;
- repeated orchestration appears in several call sites;
- understanding one changed behavior requires unrelated modules or modes;
- configuration exposes decisions that should remain internal;
- a wrapper adds no ownership, policy, substitution, compatibility, or useful test seam.

Use the deletion test: if removing a new module only spreads its complexity into callers, it may be earning its place. If its complexity disappears, it may be a pass-through layer.

Do not flag an abstraction because it is small. Flag it only when it increases coordination or hides no useful decision.

## State and lifecycle ownership

Check whether state is:

- duplicated or manually synchronized;
- derived but stored without a reliable invalidation rule;
- wider or longer-lived than the behavior requires;
- split across process, database, cache, and UI without one owner;
- represented by flags whose combinations create invalid states;
- mutated at the wrong lifecycle level.

Prefer one structural enforcement point for an invariant. Do not recommend moving state unless the target location improves ownership and failure semantics.

## Interfaces and compatibility

For changed interfaces:

- identify real consumers and their release lifecycle;
- verify inputs, outputs, errors, and side effects remain coherent;
- check migrations or compatibility when consumers cannot change together;
- avoid treating every code-level public method as a published external contract.

## Evidence threshold

An architecture finding must identify current change pressure, such as repeated coordination, unsafe state ownership, a compatibility failure, an unusable test boundary, or measurable cognitive load. Put plausible evolution ideas without enough evidence under gaps, not confirmed findings.
