# Testing and lifecycle audit lens

Use this lens to decide whether the complete reviewed scope and its affected contract are verified across the states and events they can encounter. The default scope is the complete branch; an explicitly narrow review remains limited as defined by the main workflow.

## Test ownership and seams

Check whether:

- changed behavior is tested through the smallest stable seam used by a real caller;
- each behavior has one primary test owner;
- contract, integration, or slice coverage exists where a narrow module test cannot exercise the real boundary;
- tests avoid private helpers and internal call sequences;
- expected values come from the specification, a worked example, or another independent source;
- test doubles replace external or uncontrollable boundaries rather than the system's own logic;
- assertions can fail for the reported behavior instead of only proving that code ran.

Do not judge coverage by test count or line percentage alone.

## Data states

For every new or changed field, enumerate reachable values:

- values created by migrations for existing records;
- null, missing, empty, default, stale, and legacy values;
- partially written or partially migrated values;
- values read by older or concurrent processes.

Walk every material read site. Verify that missing values cannot be counted as success or compared as meaningful by accident.

## Files and artifacts

For every expected file or artifact, check behavior when it is:

- absent;
- empty or truncated;
- replaced between reads;
- from an older version;
- concurrently written;
- inaccessible or malformed.

Require tests only for states the system can realistically produce.

## Process and resource lifecycle

Trace:

- startup and initialization;
- normal operation;
- graceful shutdown;
- cancellation and timeout;
- crash and restart;
- retries and duplicate delivery;
- concurrent processes or connections;
- cleanup and recovery.

Verify library behavior from documentation when correctness depends on shutdown, cancellation, transaction, or process-exit semantics.

Check that resources remain owned until all users finish. Look for a database, file, client, worker, executor, or browser closed while another operation can still use it.

## Invariant placement

For an invariant such as “X never counts as Y” or “only Z may transition to Q,” check whether one structural boundary enforces it. Scattered optional checks are easy for a new caller or review fix to bypass.

## Complete-scope verification

Check that the reviewed scope updates all required affected surfaces:

- tests and fixtures;
- schema and migration behavior;
- configuration and environment examples;
- public types and consumers;
- documentation and operational instructions;
- lockfiles or generated files when project policy requires them.

After fixes, repeat the complete reviewed scope, including the correction set. A fix aimed at one state may make another state unsafe.
