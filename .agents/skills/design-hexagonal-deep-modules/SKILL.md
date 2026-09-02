---
name: design-hexagonal-deep-modules
description: Use when the user explicitly requests architecture or boundary design; names hexagonal architecture, ports and adapters, deep modules, or module, service, or interface boundaries; or needs a blocking boundary-shape decision resolved during implementation planning. Do not use for architecture assessment, current-branch readiness review, or routine changes without an observed boundary problem.
---

# Design Hexagonal Deep Modules

Design boundaries that protect important application rules from delivery and infrastructure details. Use the smallest design that solves an observed problem.

## Select the design scope

- **Standalone boundary design:** resolve one named module, service, interface, or integration decision for an existing or proposed system.
- **Implementation planning:** use only when detailed architecture or resolution of a previously identified blocking boundary-shape decision was explicitly requested. Examine only boundaries the planned change introduces or materially changes.

Architecture design is read-only. Even when the user also authorized implementation, finish this workflow and present the design before beginning a separate editing phase. Do not broaden a named boundary decision into a codebase-wide architecture assessment.

## Applicability gate

Before proposing a new port or module, identify the problem it must solve. Valid reasons include:

- delivery or persistence technology is coupled to important application rules;
- an integration changes independently;
- tests require expensive infrastructure for core behavior;
- ownership is unclear across a material boundary;
- several implementations must follow one contract;
- separately evolving consumers need compatibility guarantees;
- an interface hides too little complexity and creates repeated coordination work.

If there is no observed change, ownership, testing, substitution, or compatibility problem, state: **No architecture change is justified.** Do not add layers only to match a pattern.

## Terms

- **Application core:** the use cases and domain rules that should not depend on delivery or persistence technology.
- **Port:** an interface owned by the application core. It defines a capability at a boundary.
- **Inbound port:** a capability that the application offers to an actor or caller.
- **Outbound port:** a capability that the application core needs from an external system.
- **Adapter:** technology-specific code that connects a port to HTTP, a database, a queue, a user interface, or another external system.
- **Composition location:** code that creates adapters and connects them to the application core for one runtime or deployable unit.
- **Deep module:** a cohesive abstraction whose interface is simple compared with the useful complexity hidden behind it.
- **Seam:** a stable boundary where a caller observes behavior or an implementation can be substituted without depending on hidden internals.
- **Leverage:** the useful behavior a module provides relative to what callers must understand.
- **Locality:** how well one behavior and its decisions stay together instead of being scattered across callers and layers.
- **Published interface:** an interface whose consumers cannot all be identified or coordinated through a managed compatibility and migration period, or whose owner has promised an external lifecycle.

## Interface scope

Use the least strict scope that is safe. Classify scope by the lifecycle of consumers, not by language visibility, packaging, protocol, or deployment type.

- **Internal:** all consumers are controlled and can change in one coordinated release.
- **Shared:** all consumers are known and can coordinate a compatibility period and migration, even when they release separately or belong to another organization.
- **Published:** consumers cannot all be identified or coordinated, or the interface has a promised external lifecycle.

A public method, library package, HTTP endpoint, or separate deployment is not automatically Published.

## Choose the amount of work

Use the smallest analysis and output needed for the risk.

### Lite

Use for a local application boundary:

- state the problem and constraints;
- identify the boundary and interface scope;
- propose the smallest useful change;
- list the main trade-off or risk.

### Standard

Use for a material application or cross-team boundary. Add only the relevant items:

- contract semantics;
- module responsibilities;
- adapter and dependency rules;
- testing approach;
- changes to existing documentation.

### Full

Use for a Published interface. A high-risk Shared interface may also need Full analysis. Add the relevant compatibility evidence, migration plan, deprecation policy, rollout plan, and rollback plan. Require each item only when the interface and delivery risk need it.

## Workflow

### 1. Define the problem and boundary

- Identify actors that start use cases.
- Identify external systems that the application calls.
- Define use cases in domain language.
- Separate application rules from delivery and infrastructure concerns.
- State why a boundary change is or is not justified.

### 2. Write caller usage before the interface

For every proposed new or materially changed interface, show one representative caller using it before defining its shape. Skip this step when no architecture change is justified.

- Show what the caller imports or receives, what it supplies, what it invokes, and which result or important failure it handles.
- Use project and domain vocabulary. One short example is enough unless materially different consumers need different usage.
- Derive the interface from the caller's work. When the usage and proposed signatures disagree, revise the interface rather than making callers coordinate hidden rules.
- Keep the sketch at the contract level. Do not add implementation bodies, scaffolding, or speculative options.

### 3. Define only the ports that are needed

- Name a port by purpose, such as `PlaceOrder`, not by technology, such as `RestOrderController`.
- Keep each port cohesive.
- Define inputs, outputs, domain outcomes, important errors, and required security or consistency rules.
- Keep HTTP, database, and framework types out of core-owned port signatures.
- Classify the port as Internal, Shared, or Published.

Use [the contract template](references/interface-contract-template.md) when the boundary is complex enough to need a written contract. A simple Internal contract may remain in code and tests.

### 4. Design deep modules

- Give each module one cohesive abstraction.
- Keep its interface smaller and simpler than the complexity it hides.
- Hide orchestration and special cases when they exist.
- Avoid configuration options that expose internal decisions without a clear need.
- Remove pass-through wrappers that add no ownership, policy, substitution, compatibility, or useful test boundary.
- Keep a thin wrapper when it provides one of those benefits.
- Judge depth through leverage and locality, not implementation size.
- Apply the deletion test: if removing a module only spreads its complexity into callers, it was providing useful ownership; if the complexity disappears, it may have been a pass-through.
- Keep internal test or implementation seams private when callers do not need them. A useful internal seam does not automatically belong in a public interface.
- When several actors may mutate the same state, first determine whether each can own separate state. Add a single writer, locking, or serialization only when one shared state is a real invariant; instructions to take turns are not synchronization.
- For an expensive or difficult-to-reverse interface decision, design two genuinely different options and compare their caller knowledge, locality, compatibility, and testing cost. Recommend one option and give the deciding reason. Do this sequentially when independent workers are unavailable.

Do not add complexity only to make a module appear deep.

### 5. Define adapters and dependencies

- Inbound adapters handle delivery concerns and call inbound ports. They may perform protocol checks, authentication, rate limiting, and tracing, but they do not own domain policy.
- Outbound adapters implement outbound ports.
- Translate transport and persistence representations at their boundaries. Avoid redundant mapping inside the core.
- Adapters depend on core-owned ports. The application core does not depend on delivery or persistence technology.
- Composition code may depend on both sides so it can assemble the system.
- Keep the proposed material dependency graph acyclic across boundaries.
- State whether each important dependency rule is enforced by module visibility, types, linting, tests, or only convention. Do not add enforcement tooling without an observed need.
- Use one explicit composition location per runtime or deployable unit when practical.

### 6. Plan compatibility evidence

Match compatibility checks to the interface medium and risk:

- behavioral conformance tests for adapters;
- consumer/provider contract tests for service boundaries;
- source or binary compatibility checks for libraries;
- schema compatibility checks for messages and stored data;
- representative old-client tests when needed.

For Internal interfaces, coordinated tests may be enough. For Shared interfaces, document the compatibility period and migration. For Published interfaces, require automated compatibility evidence appropriate to the medium.

### 7. Update documentation only when needed

During design, identify missing or stale architecture documentation without editing it. When the user explicitly authorized architecture documentation changes, update an existing authoritative document before creating a new file and create only the smallest missing material needed to make the boundary safe and understandable.

Read [documentation options](references/architecture-documentation-pack.md) only when architecture documentation is missing, stale, or explicitly requested. The reference describes desired artifacts; it does not authorize file changes.

### 8. Check the design

Use [the design checklist](references/design-checklist.md). Check that:

- the new boundary solves the stated problem;
- application rules stay independent of delivery and persistence technology;
- interfaces expose domain behavior instead of technology details;
- representative caller usage and the proposed interface agree;
- module interfaces remain small relative to hidden complexity;
- concurrent writers have separate ownership unless shared state is a real invariant;
- compatibility work matches the actual consumer lifecycle;
- migration and rollback work matches real delivery risk.

Revise the proposed design before implementation expands. Do not edit implementation during the design phase.

## Output

Report only the sections needed for the selected amount of work:

1. Problem, context, and constraints
2. Decision on whether an architecture change is justified
3. Caller usage, boundary, and interface scope
4. Port or module design
5. Adapter and dependency rules
6. Compatibility, migration, testing, or documentation changes
7. Risks, trade-offs, and rollback when relevant

Use the bundled [offline source notes](references/source-pack-offline.md) for background reasoning. If a durable document needs citations and external access is allowed, cite the original sources listed in [optional provenance links](references/provenance-optional.md), not this installed skill.
