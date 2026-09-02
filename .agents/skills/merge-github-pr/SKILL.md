---
name: merge-github-pr
description: Use when the user explicitly asks to merge an existing GitHub pull request after checking merge readiness and review feedback. Do not use to create a pull request, monitor it without a merge request, or merge without explicit authorization.
compatibility: Requires Git, an authenticated GitHub CLI (`gh`), network access to GitHub, and permission to read and merge the target pull request.
---

# Merge GitHub Pull Request

Merge one pull request only after verifying merge readiness and all review feedback, including automated review activity that may still be running.

## Authorization and scope

- Resolve the exact repository and pull request from the user's request, current branch, or current repository. Ask if more than one target is plausible.
- An explicit request to merge authorizes the normal merge operation after this skill's gates pass. It does not authorize changing code, dismissing reviews, resolving threads, overriding protection, enabling auto-merge, deleting branches, triggering or retriggering reviews, or merging another pull request.
- Read project instructions and contribution rules before applying the fallback workflow below.
- Do not treat a request to inspect, review, or monitor a pull request as merge authorization.

## 1. Establish the pull request and evidence set

Fetch the pull request from GitHub with the repository and number specified explicitly. Record at least:

- URL, state, draft status, base, full head commit, and every pull request commit SHA;
- mergeability and merge-state reason;
- required and reported checks, including each check run's status, conclusion, and native full `head_sha`;
- review decision, requested reviewers, and all submitted or pending-visible reviews with native full `commit_id` when available;
- every inline review comment and thread, including replies, resolution state, `commit_id`, and `original_commit_id`;
- every issue comment, relevant reaction, and comment `updated_at` value;
- commit comments attached to the pull request's commits;
- visible automated review activity, its reported review commit, and any reaction needed to interpret an asserted clean result.

Use `gh pr view`, `gh pr checks`, `gh api --paginate`, and paginated GraphQL queries as needed. Follow every REST `Link` page and every GraphQL `pageInfo` cursor. A summary field, first page, review object without its comments, or visible timeline slice is incomplete. If reaction meaning or authorship matters, fetch the relevant reaction records rather than relying only on a count. Read relevant check output and all paginated annotations.

Identify automated activity from the combined evidence: attribution, related comments or reviews, status language, check association, timestamps, and scope. Keep the main decision provider-neutral. A hidden marker, actor login or ID, table column, emoji, mutable Markdown block, or check name can help correlate evidence, but none is the sole contract.

Stop if the pull request is closed, already merged, a draft, targets an unexpected base, has a merge conflict, or cannot be identified safely. Require every applicable branch-protection and ruleset condition to be satisfied, including required checks, approvals, resolved conversations, deployments, and an up-to-date branch when required. Report pending or failed conditions and stop. Do not rely on actor exemptions, bypass protection, or use an administrator override.

## 2. Model automated review activity

Classify each distinct automated review activity, such as code review and security review, on three independent properties:

| Property | Values | Rule |
| --- | --- | --- |
| Lifecycle | `running`, `terminal`, `unknown` | `Running`, `Pending`, `Queued`, `In progress`, `Waiting`, `Requested`, and equivalents are running. Explicit completion, failure, cancellation, or another final state is terminal. Unrecognized or incomplete lifecycle evidence is unknown. |
| Outcome | `clean`, `findings`, `error`, `unknown` | Findings associated with the activity mean findings; classify unrelated feedback separately in step 3. An explicit failure or unusable review means error. Clean requires affirmative no-reportable-findings evidence under the rules below. Otherwise the outcome is unknown. |
| Scope | `current head`, `stale head`, `unknown` | Compare reliable reviewed-commit evidence with the recorded full pull request head. Missing, ambiguous, or conflicting scope evidence is unknown. |

Apply these rules:

- A terminal lifecycle does not imply a clean outcome. In particular, `Completed` proves only that the named activity ended.
- Clean requires affirmative evidence associated with that activity, such as an explicit no-reportable-findings result within the activity's documented review scope or a successful terminal review check whose documented contract means no findings. A documented terminal signal and its documented clean reaction may provide combined evidence, but neither silence nor a reaction alone is clean evidence. Also require the complete feedback surfaces to contain no associated finding or error.
- A submitted `COMMENTED` review, inline comment, thread, issue comment, commit comment, check output, or check annotation can carry findings even when a summary says `Completed`.
- Absence of a review, check, comment, or reaction does not prove clean. It is only absence. Ordinary hosted review may have no check; a configured security or repository review may have one.
- Prefer native full-SHA evidence. A pull request review's `commit_id` and a check run's `head_sha` directly scope that object. Do not let a Markdown SHA override a conflicting native field.
- Attribute an inline finding historically with its `original_commit_id`; do not relabel it as current-head feedback merely because another field or later thread state references a newer commit.
- Accept a shortened SHA only when it is an unambiguous prefix of exactly one relevant full commit. It is current only when that commit is the full current head, stale when it resolves to another commit, and unknown when it is missing or ambiguous.
- Report stale and unknown scope plainly. A stale terminal result is not current-head review evidence. It blocks for missing current-head review only when repository policy requires that review on the current head; otherwise staleness alone does not invent a new merge requirement.
- If multiple automated activities exist, classify each separately. One current-head clean code review does not complete a running, failed, stale, or unknown security review or required check.

If any visible automated review activity is running, report its activity and scope and stop. Do not wait, poll, use a watch mode, retry, or trigger or retrigger a review. A later merge invocation must fetch fresh state.

When an invocation first observes an automated activity as terminal, refetch every complete, paginated feedback surface before deciding its outcome. This catches findings posted with or just after the terminal update. Do not infer the transition by polling.

## 3. Evaluate all review feedback

After terminal-state refetching, classify every feedback item by meaning, regardless of provider or age:

- **Non-substantive:** approval without a concern, an explicit no-reportable-findings result within the review's documented scope, or automated output that requests no action.
- **Substantive:** a concern, question, requested change, suggestion, identified risk, or automated finding that may require a code change or decision.
- **Ambiguous:** feedback whose requested action, result, lifecycle, outcome, or disposition is unclear.

For each substantive item, check its thread, later replies, current pull request state, original commit attribution, and what happened in the current session. Preserve older explicit clean and error comments as evidence; do not require the current provider layout. An error is not a clean result.

Treat feedback as handled in the current session only when the user made the relevant decision or the requested response was applied and verified during this session. Merely displaying, summarizing, resolving, or acknowledging feedback does not handle it.

If substantive or ambiguous feedback has not been handled in the current session, summarize the consolidated set with durable links and ask the user whether to address, defer, or merge despite it. Do not interrupt for each comment. Do not ask again about feedback already handled in the current session, but still report any GitHub state that blocks merging.

Report an automated review error or unknown visible outcome and stop; do not silently classify it as harmless. A later explicit user decision may accept an optional review gap only when repository policy permits it. If a required current-head review is absent, stale, or unknown-scope, report the unmet policy and stop. If no review is required and no automated activity is visible, the absence is not a blocker and is not a clean review result.

Review completion is only feedback evidence. It does not satisfy checks, approvals, thread resolution, mergeability, queue policy, or any other merge-readiness gate.

## 4. Choose the merge method

Treat mandatory repository instructions and enabled merge methods as constraints. Within those constraints, use the user's explicit merge method. If no preference exists and only one method is permitted, use it. If several methods remain possible, ask the user to choose merge commit, squash, or rebase. Inspect repository settings with the GitHub API rather than guessing from local Git history.

When repository policy requires a merge queue, select the queue path instead of a direct merge. Do not enqueue yet; both paths must pass the final recheck below. Do not enable auto-merge unless the user explicitly asks for it.

## 5. Final race check and merge

Immediately before merging, refetch the pull request and every complete, paginated feedback surface from step 1, including relevant reactions and check annotations. Recompute every automated activity's lifecycle, outcome, and scope. Record the full head commit again.

Stop if the head, base, checks, protection requirements, review decision, feedback, automated review state, draft state, or mergeability changed in a way that invalidates the earlier evaluation. A newly running review is pending; a newly posted finding must be classified; a mutable summary that changed must be interpreted with the complete evidence set.

For a required merge queue, enqueue the pull request with GitHub's GraphQL `enqueuePullRequest` mutation and the recorded head commit as `expectedHeadOid`. Do not use a command that can implicitly enable auto-merge. For a normal merge, run `gh pr merge` with the repository, pull request number, selected method, and `--match-head-commit <recorded-head-commit>` specified explicitly. Do not use `--admin`, delete the branch, or add unrelated options.

Fetch the pull request again and verify its resulting state and merge commit when available. Report a queued pull request as queued rather than claiming it merged immediately. If GitHub queued or rejected the operation, report the exact state and reason; do not retry with weaker safeguards.

## Report

State:

- pull request URL, base, and full head commit;
- checks and merge-readiness result;
- each automated review activity's lifecycle, outcome, scope, and evidence;
- whether review feedback was non-substantive, handled in this session, or surfaced for a decision;
- selected merge method;
- merged, queued, already merged, or stopped state;
- merge commit when available;
- any pending activity, finding, error, stale or unknown scope, blocking policy, or state change.
