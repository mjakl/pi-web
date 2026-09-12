---
name: plan-implementation
description: Use when the user explicitly asks to plan one settled, PR-sized repository change before editing, including the planning phase of a plan-and-implement request. Do not use for an unresolved decision, a multi-PR initiative, general architecture design or review, or an implementation-only request.
disable-model-invocation: true
compatibility: Requires Git for repository and history inspection. Project-specific planning may require read access to referenced issues or documentation.
---

# Plan Implementation

Plan one settled change deeply enough that implementation can proceed in coherent, verifiable increments. Make difficult changes easier before writing code, without turning planning into speculative architecture or a second task tracker.

## Boundaries

- The planning phase is read-only. Do not edit code, tests, configuration, documentation, issues, tickets, or plan files while following this workflow.
- A planning-only request does not authorize implementation, staging, commits, or pushes.
- When the user asks to plan and implement, complete this workflow and resolve blocking decisions first. Then end the planning workflow before beginning the separately authorized implementation phase.
- Keep the output in the conversation by default. When the user explicitly requests a durable plan artifact, finish the analysis in read-only mode, show the proposed path and content, and treat writing it as a separate authorized publication step after this workflow ends.
- Plan one coherent PR-sized outcome. When the request still contains unresolved product decisions, identify the blockers instead of guessing. When it spans several independently useful pull requests or sessions, state that initiative mapping is needed before implementation planning.
- If the implementation is obvious and carries no meaningful structural, lifecycle, compatibility, or verification uncertainty, provide a concise route and stop rather than manufacturing ceremony.

## 1. Establish the change

Read the supplied issue, ticket, specification, conversation, and project instructions. Confirm:

- observable outcome and acceptance criteria;
- intended users or system behavior;
- explicit non-goals;
- constraints and settled decisions;
- assumptions whose failure would change the implementation;
- one coherent pull-request boundary.

Ask only for decisions that materially block the plan. Investigate repository facts rather than asking the user to recall them.

## 2. Ground the plan in the repository

Inspect the current implementation before proposing changes:

- composition locations and ownership;
- relevant modules, callers, interfaces, and data flows;
- representative tests and project-native verification commands;
- schemas, configuration, migrations, generated artifacts, and operational paths;
- similar existing behavior and canonical utilities;
- recent history when an unusual structure may preserve a compatibility, performance, platform, or lifecycle constraint.

Cite concrete paths and symbols. Treat likely file lists as evidence-based estimates, not promises. State material areas that were not inspected.

## 3. Verify the affected contract

Use repository evidence to determine which dimensions materially apply, then check those dimensions against the settled specification. When an applicable dimension lacks an acceptance criterion, name the gap instead of resolving it silently in the plan:

- inputs, outputs, errors, and external effects;
- invariants and state transitions;
- ordering, retries, cancellation, concurrency, and resource ownership;
- trust boundaries and sensitive operations;
- data compatibility and migration states;
- expected scale or performance constraints;
- known consumers and their release lifecycle;
- rollout, exposure, and reversal constraints when incomplete or irreversible states can reach users.

An omitted dimension is a specification gap only when repository evidence shows that it materially applies. Report the gap as a blocking question when its answer changes the implementation; ignore or briefly mark dimensions that are genuinely inapplicable.

Separate observable requirements from implementation choices. Surface uncertainty rather than freezing an unsupported design into the plan.

## 4. Identify obstacles and enabling refactors

State what in the current structure makes the requested behavior difficult, duplicated, risky, or hard to verify.

Include a behavior-preserving enabling refactor only when it has a concrete payoff for this change. For each one, explain:

- the present obstacle;
- the complexity or risk it removes;
- the behavior that must remain unchanged;
- why it should precede the behavior-changing work;
- how its safety will be verified.

Keep enabling refactors separate from feature changes. Prefer existing ownership, interfaces, and utilities. Do not plan unrelated cleanup.

For a wide mechanical migration that cannot remain green as one direct replacement, use expand–migrate–contract:

1. add the new form beside the old;
2. migrate consumers in coherent batches while both forms work;
3. remove the old form only after every consumer has moved.

Use this sequence only when the actual blast radius requires it.

## 5. Apply the architecture-pressure gate

Before planning a new module boundary, port, adapter, abstraction, or test seam, identify the concrete pressure it must solve:

- policy is coupled to delivery, persistence, framework, or integration code;
- ownership or state responsibility is unclear;
- an integration or consumer evolves independently;
- core behavior cannot be verified without expensive infrastructure;
- multiple implementations need one meaningful contract;
- compatibility or migration cannot be coordinated safely;
- repeated orchestration or caller knowledge shows that an interface hides too little.

If no such pressure exists, preserve the current boundary and say that no architecture change is justified.

When pressure exists, record the actors, ownership, dependency direction, consumers, compatibility constraints, and unresolved design decision. Do not invent the detailed port, adapter, interface, or module shape inside this workflow. If the user also requested detailed architecture design, finish that as a distinct read-only design phase before finalizing dependent implementation steps. Otherwise, mark an unsettled shape that changes implementation order as a blocking decision.

## 6. Create the test concept

Define the evidence the implementation must eventually provide without prescribing test code or tooling:

- caller-visible behaviors that must be demonstrated;
- important errors, edge states, and lifecycle scenarios;
- integration or external boundaries that evidence must include;
- compatibility states that must remain supported;
- relevant existing test conventions and repository-native checks;
- behavior or environment that cannot be verified locally.

Do not select new test frameworks, private hooks, fixtures, doubles, or detailed seam design. Record coverage constraints and expected evidence; detailed test design belongs to the implementation phase when the concrete boundary is known.

## 7. Sequence coherent increments

Choose the sequence that best reduces uncertainty:

- **vertical-first** for independently useful caller-visible behavior;
- **contract-first** when known consumers must coordinate against a settled interface;
- **risk-first** when one technical assumption could invalidate the approach;
- **prefactor-first** when current structure makes the behavior change unnecessarily difficult;
- **expand–migrate–contract** for a wide compatibility-preserving transition.

For each increment, provide:

1. the complete outcome it adds or enables;
2. prerequisites and decisions it depends on; for each material dependency, state whether it blocks starting or integration, its current state, and the event or decision that resolves it;
3. likely paths or symbols involved;
4. contract and state affected;
5. behavior-preserving versus behavior-changing classification;
6. expected verification evidence; where the result is not obvious, state the expected signal before and after the increment;
7. risk triggers that require a pause before continuing.

Each increment should leave the working state coherent. When partial delivery could reach users, plan a conservative default and an explicit exposure strategy; a feature flag is one option, not an automatic requirement. For destructive or difficult-to-reverse work, identify the practical rollback, roll-forward, or containment path. Do not impose fixed file counts, line counts, time estimates, commit cadence, or mandatory checkpoints.

## 8. Embed risk-triggered implementation checks

Attach checks to the plan so implementation can detect drift without scheduling a general review after every increment.

Routine progress checks are:

- run the focused verification whose behavior changed;
- inspect the current diff for scope drift;
- compare the result with the increment's outcome and non-goals;
- avoid repeating a successful check when relevant code has not changed.

Require a pause and explicit reconsideration when implementation:

- changes a public or independently consumed contract;
- changes a schema, migration, stored representation, or destructive operation;
- changes authentication, authorization, or another trust boundary;
- changes concurrency, retry, cancellation, startup, shutdown, or resource ownership;
- introduces or moves an architectural boundary or state owner;
- creates material performance or cost risk;
- deviates materially from the confirmed plan;
- cannot produce the planned verification evidence;
- discovers an assumption that invalidates later increments.

A pause examines the specific decision and affected contract. It is not a scheduled full review, and merely completing an increment is not a trigger.

## 9. Challenge and report the plan

Before presenting the plan:

- identify assumptions most likely to be wrong;
- state what evidence would falsify the approach;
- check that every enabling refactor pays for this change;
- check that behavior-changing increments follow required foundations;
- check that important failure, migration, and lifecycle states have owners;
- identify reversal or rollback points;
- confirm that every acceptance criterion is covered by an implementation increment and its verification evidence;
- remove unsupported precision and unrelated work.

Do not rely on chat-only facts that an implementer cannot recover from cited repository evidence, the settled specification, or a labeled assumption. Do not duplicate the full specification merely to make the plan stand alone.

Use this default output, omitting empty sections:

```markdown
## Outcome and constraints
<PR-sized result, acceptance criteria, non-goals, and assumptions.>

## Repository evidence
<Current ownership, relevant paths and symbols, existing patterns, and uninspected areas.>

## Structural obstacles and decisions
<Concrete obstacles, justified enabling refactors, and blocking architecture decisions.>

## Test concept
<Required behaviors, failure/lifecycle evidence, compatibility coverage, and project checks.>

## Implementation sequence
1. <Outcome, likely scope, dependencies, verification, and risk triggers>

## Risks and reversal points
<What could invalidate the plan and how to detect it early.>
```

End by stating whether the plan is ready, blocked by named decisions, or unnecessary for an obvious change. This ends the planning workflow. Begin implementation only afterward and only when the user's request separately authorizes that next phase.
