# Interface-First Documentation Options

Goal: help contributors understand and change the system from contracts and boundaries without requiring deep implementation dives.

This reference describes desired documentation, not authorization to edit it. During design, identify gaps. Create or update files only when the user separately authorized documentation changes.

Do not create a full documentation pack by default. First update existing authoritative documentation. Add only the smallest missing documents justified by the task and the interface strictness model.

A contributor should be able to answer the relevant questions:

1. What capabilities exist?
2. What are the important inbound and outbound ports?
3. Which adapters call an inbound port or implement an outbound port?
4. Where do business rules live?
5. What is stable versus changeable?
6. How do critical flows run end to end?

## Candidate documents

Use these names as examples, not a required numbered structure.

### Overview

- Problem, scope, non-goals, constraints, and domain glossary

### System context

- Actors and external systems
- System boundary and context diagram

### Port catalog

- Relevant inbound and outbound ports
- Links to contracts
- Status and scope: Internal / Shared / Published
- Scope based on consumer lifecycle, not code visibility or protocol

### Module map

For each relevant module:

- responsibility sentence;
- exposed module interface;
- hidden decisions and invariants;
- inbound and outbound dependencies.

### Adapter matrix

- Adapter to port relationship: calls an inbound port or implements an outbound port
- Technology-specific concerns
- Failure, timeout, and retry behavior

### Dependency rules

- Allowed dependency directions
- Forbidden imports or boundary crossings
- Enforcement through tests, linting, or review

### Key flows

Document only critical flows:

- sequence through ports and modules rather than framework internals;
- happy path;
- important failure path.

### Interface evolution policy

Add when Shared or Published interfaces make compatibility material:

- rules by scope;
- compatibility expectations;
- versioning and deprecation for Published interfaces;
- migration guidance;
- automated compatibility evidence appropriate to the interface medium.

### Test strategy

Document only the testing decisions that affect the boundary:

- direct domain tests at the narrowest useful interface;
- use-case tests through inbound ports when that is the useful behavior boundary;
- adapter conformance tests when several implementations share a contract or boundary risk is high;
- minimal end-to-end tests for important wiring.

### ADR index or decision links

- Relevant decisions and status
- Links from decisions to affected ports and modules

### Optional views

Add only when useful:

- observability by port;
- risk register;
- glossary;
- C4 diagrams at the smallest useful level.

## Selection guidance

- **Lite:** normally update no architecture documents unless the change would otherwise leave a critical boundary unexplained.
- **Standard:** update the existing port/module/adapter documentation touched by the change; add at most the missing views needed for safe implementation.
- **Full:** for Published interfaces or high-risk Shared interfaces, include relevant evolution, migration, and compatibility evidence. Add rollout and rollback guidance only when deployment or data risk requires it.

## Quality rules

- Use domain terms before framework jargon.
- Keep documents short, linked, and authoritative.
- Keep diagrams synchronized with contracts and modules.
- Link adapters to the port contracts they call or implement.
- Update relevant documentation in the same change as architecture-affecting code.
- Avoid parallel documentation sets that can drift.

## Done check

For the scope being changed, a reviewer can:

- trace each critical flow through the ports and adapters it actually uses;
- identify where a change belongs without broad code reading;
- assess compatibility risk for changed Shared or Published ports.
