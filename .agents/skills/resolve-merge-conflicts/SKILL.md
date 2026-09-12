---
name: resolve-merge-conflicts
description: Use automatically when Git reports conflicts during an in-progress merge, rebase, cherry-pick, or revert, or when the user asks to inspect, resolve, or complete such an operation. Do not use for ordinary diffs or conflict-free Git operations.
compatibility: Requires Git and a worktree with an in-progress conflicted operation.
---

# Resolve Merge Conflicts

Resolve conflicts by intent. Preserve the goal of each change when compatible, and make trade-offs explicit when they are not.

## Authorization boundary

Interpret the request narrowly:

- **Understand or explain conflicts:** inspect only; do not edit or stage.
- **Resolve conflicts:** edit conflicted files and stage only resolved paths.
- **Finish the merge, rebase, cherry-pick, or revert:** resolve, stage, validate, and continue the current Git operation.

Do not create unrelated commits, push, force-push, skip commits, or abort without explicit authorization. During a rebase or cherry-pick, continuation may recreate an existing commit; it does not authorize unrelated history changes.

## Inspect the operation

1. Read project instructions and repository status.
2. Identify whether Git is performing a merge, rebase, cherry-pick, or revert.
3. List conflicted and already staged paths. Preserve unrelated work.
4. Read conflict markers and surrounding code. When markers are insufficient, inspect the base and both index-side versions with `git show :1:<path>`, `git show :2:<path>`, and `git show :3:<path>`. Interpret stages 2 and 3 according to the current operation; do not assume their human labels describe intent.
5. Inspect the commits, messages, branch history, and direct issue or PR references that explain each side.
6. State the operation's intended outcome before editing.

If the repository is not in a conflicted operation, stop and report that state. Do not manufacture a conflict workflow from an ordinary diff.

## Resolve each conflict

For every hunk:

1. Describe the intent of each side.
2. Decide whether both intents can coexist.
3. Preserve both when compatible.
4. When incompatible, choose the behavior that matches the operation's stated goal and project rules.
5. Do not invent unrelated behavior or opportunistic refactors.
6. Remove all conflict markers and inspect the combined result in context.
7. Record any trade-off or uncertain intent for the final report.

Use “ours” or “theirs” only after verifying that the complete file from that side is intended. These labels can reverse meaning between operations and do not explain behavior.

After reconciling their source files, regenerate reproducible outputs with the project's native command instead of hand-merging them. If an artifact is not reproducible, or no trusted regeneration command exists, do not splice it; stop for a whole-version decision. Inspect regenerated changes and keep only output required by the resolution.

When intent cannot be established safely, stop before staging that path. Present the evidence and options. Offer aborting only as a user decision.

## Validate and stage

1. Search resolved paths for remaining conflict markers.
2. Inspect the diff for accidental deletions, duplicated blocks, or lost behavior.
3. Run focused checks for the affected area.
4. Run required project checks when practical.
5. Stage only paths whose conflicts are resolved and reviewed.
6. Run `git diff --cached --check -- <resolved-path>...` for the paths resolved in this operation. Report a finding rather than silently changing intentional whitespace.
7. Recheck Git status and the staged diff.

Do not use `git add -A` or stage unrelated files.

## Continue when authorized

- Continue the current operation with the Git command appropriate to its state.
- If another conflict appears, repeat the workflow for that step.
- Do not bypass failed checks or use a force option to finish.
- Stop when Git requires a product decision, missing credential, manual message edit, or another authorization not already given.

## Report

State:

- operation and branches or commits involved;
- paths resolved;
- important intent decisions and trade-offs;
- checks and results;
- staged and unstaged work remaining;
- whether the operation completed or where it stopped.
