# Port Contract Template

Use this template only when a boundary needs a written contract. A simple Internal contract may be clear enough in code and tests.

Keep the contract short. Complete the required core first. Add conditional sections only when they affect behavior or compatibility.

## Required core

### 1. Identity and scope

- Port name
- Direction: Inbound or Outbound
- Scope: Internal, Shared, or Published
- Status: Draft, Active, or Deprecated

Scope is based on consumer lifecycle:

- **Internal:** all consumers can change in one coordinated release.
- **Shared:** all consumers are known and can coordinate migration, even when they release separately or belong to another organization.
- **Published:** consumers cannot all be identified or coordinated, or the interface has a promised external lifecycle.

Language visibility, package type, protocol, and deployment type do not decide scope by themselves.

### 2. Purpose

- Purpose in one or two sentences
- Work included
- Work excluded

### 3. Caller usage

Show one representative caller using the proposed interface. Include what it receives or imports, what it supplies, what it invokes, and which result or important failure it handles. Keep the example short and derive the operations below from it.

### 4. Operations

For each operation, define only the fields that apply:

| Operation | Command, query, or event | Input | Output or domain outcome | Preconditions | Important failures |
|---|---|---|---|---|---|
| | | | | | |

Describe behavior in domain terms. Distinguish a domain rejection from a technical failure.

### 5. Required rules

- Domain rules and invariants
- Security or authorization rules
- Ordering or consistency rules that callers can observe
- Duplicate-request, retry, or idempotency behavior when relevant

## Conditional sections

### Consumers and adapters

Add for a Shared or Published interface, for several implementations, or when ownership is unclear:

- Known consumers
- Expected adapters or implementations
- Owning team or decision owner

### Operational behavior

Add only behavior that is part of the contract:

- timeout;
- retry;
- concurrency;
- consistency;
- latency or throughput target;
- ordering guarantee.

### Evolution and migration

Add when consumers evolve separately:

- changes that are compatible;
- breaking-change process;
- compatibility period;
- migration path;
- deprecation policy for Published interfaces.

### Compatibility evidence

Choose evidence appropriate to the medium and risk:

- adapter conformance tests;
- service consumer/provider contract tests;
- library source or binary compatibility checks;
- message or stored-data schema checks;
- representative old-client tests.

State who owns and runs each check.

### Examples

Add examples only when they explain behavior that the contract text does not make clear.

### Open questions

Record unresolved decisions and risks that block safe use or evolution of the port.

## Quality check

- The purpose is cohesive.
- The contract is understandable without reading implementation details.
- Representative caller usage and the operations agree.
- Inputs, outcomes, important failures, and required rules are clear.
- Technology details do not leak into a core-owned interface without a concrete reason.
- Compatibility work matches the interface scope and medium.
- The document contains no unused sections completed only for formality.
