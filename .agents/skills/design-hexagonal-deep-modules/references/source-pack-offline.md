# Offline Source Notes

These notes summarize the sources that informed this skill. Use them for background reasoning when web access is not needed. The rules in `SKILL.md` are authoritative for this skill.

For durable or published work that needs citations, use the original sources listed in `provenance-optional.md`.

## 1. Alistair Cockburn: hexagonal architecture

Main ideas:

- The important distinction is inside versus outside the application.
- Application rules should not depend on user interface or database technology.
- The application communicates through ports.
- Adapters connect ports to specific technology.
- One port can have several adapters, such as HTTP, a batch job, a test adapter, or a database adapter.

Limit: the pattern adds value only when the boundary protects meaningful behavior or change. It does not require a port for every function.

## 2. John Ousterhout: deep modules

Main ideas:

- A deep module has a simple interface relative to the complexity it hides.
- A large collection of narrow, shallow interfaces increases cognitive load.
- A useful general interface can be simpler than many special-purpose interfaces.
- Unnecessary options and special cases make an interface harder to use.

Limit: depth does not mean adding internal complexity. A simple problem may need only a simple module.

## 3. Joshua Bloch: API design

Main ideas:

- Start from real use cases.
- Keep an interface small, clear, and difficult to misuse.
- Test the design by writing caller code early.
- Do not expose implementation details without a caller need.
- Names and documentation are part of the interface.

Limit: strict API process should match the number and independence of consumers.

## 4. Martin Fowler: public versus published interfaces

Main ideas:

- A code-level public interface is not always published to independent consumers.
- Published interfaces need stronger compatibility and migration rules.
- Publish only the surface that needs an external lifecycle promise.

Consumer lifecycle is more important than language visibility, packaging, protocol, or deployment type.

## 5. AWS guidance: uses and costs of hexagonal architecture

Main ideas:

- The pattern can improve isolation, testability, and replacement of external systems.
- It is most useful when clients or dependencies change independently.
- Costs include more abstractions, translation code, maintenance work, and concepts that contributors must learn.

This is a trade-off, not a default architecture requirement.

## 6. Netflix case study: replaceable data sources

Main ideas:

- Inward dependencies helped isolate source-specific code.
- Core behavior was separated from transport and data-source details.
- Layered tests covered core behavior, adapters, and important wiring.

Limit: this is one case study. Its source-switching choices are not universal rules.

## 7. Arho Huttunen: practical implementation and testing

Main ideas:

- Start from use cases and domain rules.
- Keep delivery and persistence framework dependencies outside the application core where practical.
- In-memory adapters can support fast use-case tests.
- Test adapters separately when their boundary behavior is important.
- Keep broad end-to-end tests limited.

Limit: a core can use appropriate general-purpose libraries. It does not need to be free of every framework or dependency.

## 8. codecentric: layered and inward dependencies

Main ideas:

- Traditional layers can still leak technology concerns into business rules.
- Data-model-first design can distort domain design.
- Inward dependencies protect core behavior from technology changes.
- A modular monolith with clear boundaries is often a useful starting point.

Limit: separate domain and persistence models only when the isolation is worth the mapping and maintenance cost.

## 9. C4 model: levels of architecture communication

Main ideas:

- Architecture can be shown at system context, container, component, and code levels.
- Readers should be able to move from a broad context to the relevant detail.

Select only the levels needed for the audience and decision. Do not create every diagram by default.

## 10. Fowler and Clemson: service contract testing

Main ideas:

- Consumer and provider tests can verify expectations at a service boundary.
- Different consumers can depend on different parts of the service contract.
- Contract tests can provide faster feedback than a full multi-service test.

Scope: this guidance is primarily about service consumer/provider boundaries. Other interface media need different compatibility evidence.

## 11. Chris Richardson: service integration contract tests

Main ideas:

- Full end-to-end tests across many services are slow and fragile.
- Consumer-authored contract tests can give isolated feedback.
- Contract tests complement a small number of wiring tests.

Scope: use this approach when it fits a service integration. Do not treat it as the only compatibility method for libraries, schemas, commands, or file formats.
