# Security audit lens

Use this lens for changed trust boundaries. Report only risks with code evidence and a realistic failure path.

## Establish the boundary

Identify:

- actors and their privileges;
- sensitive operations and data;
- where untrusted input enters;
- where identity, ownership, tenant, or role is checked;
- external systems, files, processes, and network destinations;
- where trust or privilege changes.

Never print secret values. Refer to names and handling paths only.

## Authorization and isolation

Look for:

- missing or inconsistent authentication or authorization;
- tenant, owner, or role boundaries checked only by the caller or client;
- object access that lacks an ownership predicate;
- privileged operations reachable from weakly checked input;
- retries, races, or alternate routes that bypass the normal check.

Trace the complete operation from entry point through storage or external effect.

## Input and execution

Look for realistic paths to:

- SQL, shell, template, query, or interpreter injection;
- path traversal or unsafe archive extraction;
- unsafe upload, file, or deserialization handling;
- server-side requests to attacker-controlled destinations;
- dynamic process execution or loading;
- untrusted content treated as instructions or code.

A dangerous primitive is not a finding by itself. Show how changed input can reach it without an adequate boundary.

## Secrets, sessions, and data

Check for:

- secrets committed, logged, returned, or stored too broadly;
- cookies, tokens, sessions, or state files with unsafe scope or lifetime;
- sensitive values crossing an unintended boundary;
- caches, backups, exports, or error paths that retain data incorrectly;
- missing transport or storage protections when the threat model requires them.

## Stored state and concurrent actions

Check for:

- queries or updates missing tenant or owner limits;
- check-then-act races around privileged actions;
- unsafe replay or duplicate requests;
- inconsistent authorization between create, read, update, and delete paths;
- retention or deletion behavior that exposes data.

## Defenses, configuration, and investigation

Check whether the changed boundary depends on:

- framework or deployment security settings that differ from code assumptions;
- cookie, CORS, transport, proxy, header, sandbox, or permission configuration;
- an important security rule enforced only by convention;
- tests that fail to exercise the privileged or hostile-input path;
- security events that are not logged with enough safe context to investigate;
- logs that disclose secrets or sensitive data instead of supporting investigation.

Read relevant framework, authentication, security, and deployment configuration before concluding that a defense exists or is absent.

## Evidence threshold

For each security finding, state:

- required security rule;
- reachable failure or exploit sequence;
- attacker or actor prerequisites;
- likely impact;
- evidence and unknowns.

Do not report a generic hardening checklist. Zero security findings is valid.
