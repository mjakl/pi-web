---
name: create-github-pr
description: Use when the user asks to open, draft, or submit a GitHub pull request from the current branch. Do not use for reviewing or monitoring an existing pull request.
compatibility: Requires Git and GitHub CLI (gh), authenticated for the target GitHub host.
---

# Create GitHub Pull Request

Create one pull request and stop. Do not start an automated review workflow.

## Workflow

### 1. Read project rules

Read repository instructions, the contribution guide, and pull request templates. Project rules take precedence over this fallback workflow.

### 2. Resolve the pull request target

Determine and verify:

- target repository;
- target base branch;
- local head branch;
- remote that owns the target base branch;
- remote that will receive the head branch.

Useful commands:

```bash
gh repo view --json nameWithOwner,defaultBranchRef
git remote -v
git branch --show-current
git status --short --branch
```

Do not create a pull request from the default branch. Ask the user if the target repository or base branch is unclear, especially when the local repository is a fork.

Check whether an open pull request already exists for the head branch. If it exists, return its URL instead of creating a duplicate.

### 3. Inspect the committed change

A dirty worktree does not change the committed pull request diff, but it can make validation unclear.

- Never commit or include dirty files automatically.
- Continue only when dirty files are known to be unrelated and do not prevent validation.
- Ask the user when ownership or relevance is unclear.

Fetch the selected base branch from its remote. Compare `HEAD` with the fetched base reference:

```bash
git log <base-ref>..HEAD --oneline
git diff --stat <base-ref>...HEAD
git diff <base-ref>...HEAD
```

Confirm that the pull request contains the intended commits and no unrelated changes. Run the project checks required for the changed area. Record what ran and what could not run.

### 4. Push the head branch safely

If the head branch has not been pushed, use a normal push and set its upstream.

If the remote branch exists, fetch it and check for divergence before pushing. Do not force-push. Ask the user when local and remote history have diverged.

Creating a pull request authorizes the normal push needed for that branch. It does not authorize rewriting remote history.

### 5. Prepare the title and body

Use this order of precedence:

1. Repository instructions
2. The selected pull request template
3. The style of recent pull requests in the target repository
4. The fallback below

If several templates exist, choose the one that matches the change. Ask when the choice is unclear. Preserve required headings and checkbox structure. Use `N/A` only for a required field that is genuinely inapplicable.

Fallback body:

```markdown
## Summary

<what changed and why>

## Validation

<checks run and results>

## Reviewer notes

<important context, risks, or follow-up work; omit when empty>
```

Use a clear title that follows the repository's style. Do not apply or reject Conventional Commit prefixes unless repository policy requires that choice.

Link a known issue when appropriate:

- `Closes #<number>` when the pull request resolves it.
- `Refs #<number>` when it is related but does not resolve it.

Do not guess issue numbers. Do not repeat the full diff in the body.

### 6. Create and verify the pull request

Pass the repository, base branch, and head branch explicitly. Use `<head-branch>` when the branch is in the target repository. Use `<head-owner>:<head-branch>` when the branch is in a fork. Preserve real newlines by reading the body from standard input:

```bash
gh pr create \
  --repo "<owner/repository>" \
  --base "<base-branch>" \
  --head "<head-spec>" \
  --title "<title>" \
  --body-file - <<'EOF'
<body>
EOF
```

Add `--draft` only when the user asks for a draft.

Query the created pull request. Verify its URL, repository, base, head, and draft state. Report the URL, a short summary, validation results, and any remaining staged, unstaged, or untracked work. Confirm that remaining work was not included in the pull request.
