# Provenance

## Source

Adapted from `mattpocock/skills` `resolving-merge-conflicts` at commit `8b78b531ab965735c5dc74f6f7a219e1e37326df`.

## Durable decisions

- Preserve intent-based resolution and primary-source investigation.
- Replace “always resolve; never abort” with a safe stop and explicit user decision when intent is uncertain.
- Separate read-only explanation, file resolution, and completion authorization.
- Stage only resolved paths. Do not stage the whole worktree.
- Do not own unrelated commit creation, pushing, skipping, aborting, or force operations.
- Validate the combined behavior and staged diff before continuation.
- Keep the skill automatically discoverable, portable, and independently installable.
