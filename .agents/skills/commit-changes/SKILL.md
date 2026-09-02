---
name: commit-changes
description: Use when the user asks to commit current changes or wants help writing a commit message. Do not use to resolve or continue a conflicted merge, rebase, cherry-pick, or revert.
compatibility: Requires Git.
---

# Commit Changes

First determine the requested result:

- **Message only:** inspect the relevant change and propose a commit message. Do not stage files or create a commit.
- **Create a commit:** follow the full workflow below.

A request for message help does not authorize staging, committing, or pushing.

When creating a commit, preserve unrelated work.

## Workflow

### 1. Read project rules

Read the repository instructions and contribution guide. Follow project-specific rules for checks, commit content, and message format.

### 2. Inspect the repository

Run:

```bash
git status --short --branch
git diff
git diff --cached
git log -5 --format='%h %s'
```

Before staging, use Git status and repository state to detect an in-progress merge, rebase, cherry-pick, or revert. Check the paths returned by `git rev-parse --git-path <name>` for `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge`, `rebase-apply`, and `sequencer`. If any such operation is active, stop the ordinary commit workflow even when all conflicts appear resolved. Report the operation and whether unmerged paths remain. Operation-specific resolution or continuation requires its own authorization and workflow.

Identify the exact changes that belong in the commit. Treat user-supplied paths or globs as scope limits and other supplied text as commit-message guidance. Verify all staged changes against that scope rather than assuming staged state expresses intent. Do not include unrelated staged, unstaged, or untracked files.

If staged content conflicts with the supplied scope or the intended change remains unclear, stop and ask the user.

### 3. Validate the change

Run the checks required by the project for the changed area. Report any check that cannot run.

Do not bypass hooks with `--no-verify` unless the user explicitly approves it.

### 4. Stage only intended files

Stage explicit paths. Do not use `git add .` or `git add -A` until you have verified that every included path belongs in the commit.

Validate and inspect the final staged change:

```bash
git diff --cached --check
git diff --cached --stat
git diff --cached
```

Check the staged paths and diff for likely secrets, accidental debug output, and unrelated formatting churn. Do not print suspected secret values.

Do not create an empty commit unless the user explicitly asks for one.

### 5. Write the message

Describe the staged change as one coherent “what and why.” If that is not possible, reconsider the scope or ask the user; do not silently create several commits.

Use this order of precedence:

1. Explicit user instructions
2. Repository commit rules
3. The style used by recent relevant commits
4. The fallback rules below

Fallback rules:

- Use a short subject in the imperative form.
- Start the subject with an uppercase letter.
- Explain why in the body when the reason is not clear from the subject.
- Use Conventional Commits only when the repository requires or consistently uses them.

Example fallback subject:

```text
Add commit message validation
```

### 6. Commit and verify

Create the commit, then inspect the result:

```bash
git show --stat --oneline --decorate HEAD
git status --short --branch
```

Report the commit identifier, subject, checks run, and any remaining worktree changes.

## Push boundary

A request to commit does not authorize a push.

If the user also asks you to push:

- verify the target remote and branch;
- use a normal push;
- do not push directly to the default or protected branch unless the user explicitly requested it and project policy allows it;
- do not force-push. If remote history must be rewritten, stop and ask the user to handle or explicitly authorize that separate operation.
