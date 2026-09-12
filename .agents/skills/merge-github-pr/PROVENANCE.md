# Provenance

## Intent

Prevent a merge from racing hosted review feedback. The workflow treats automated review lifecycle, outcome, and head scope as separate facts, then combines them with ordinary review feedback and repository merge policy.

The skill is self-written and provider-neutral. Codex observations motivated the change, but Codex-specific identity, markup, and wording are evidence adapters rather than the merge contract.

## Official documented contract

The following official documentation was checked on 2026-09-01:

- [OpenAI: Codex code review in GitHub](https://developers.openai.com/codex/third-party/github) says Codex can run automatically or after `@codex review`, reacts when a requested review starts, and posts a standard GitHub review with findings. It also states that code review rules do not replace tests, branch protection, or required approvals. It does not promise a specific issue-comment marker, summary table, actor login, status vocabulary, mutable-comment schema, clean-result shape, or check run for ordinary code review.
- [GitHub: pull request reviews](https://docs.github.com/en/rest/pulls/reviews) defines reviews as grouped review comments and exposes review state plus full `commit_id`.
- [GitHub: pull request review comments](https://docs.github.com/en/rest/pulls/comments) separates inline review comments from issue and commit comments and exposes full `commit_id`, `original_commit_id`, review association, replies, and reactions.
- [GitHub: issue comments](https://docs.github.com/rest/issues/comments) documents pull request timeline comments, mutable bodies through update operations, `updated_at`, reactions, and pagination.
- [GitHub: commit comments](https://docs.github.com/en/rest/commits/comments) documents the separate commit-comment surface and its full `commit_id`.
- [GitHub: check runs](https://docs.github.com/en/rest/checks/runs) exposes lifecycle status, conclusion, output, annotations, and full `head_sha`. It distinguishes non-terminal states such as queued, in progress, waiting, requested, and pending from completed runs.
- [GitHub: REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) states that list responses can contain only a subset and must follow `Link` pages.
- [GitHub: GraphQL pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api) documents cursor traversal through connection `pageInfo`.

These APIs are the durable evidence boundary. Native full-SHA fields outrank prose attribution. `original_commit_id` preserves the commit where an inline finding originated.

## Observed hosted-review implementation as of 2026-09-01

Read-only GitHub API inspection showed several Codex generations in active repositories:

- [openai/codex#40635 summary comment](https://github.com/openai/codex/pull/40635#issuecomment-5413356047) contains the hidden `codex-pull-request-review-summary` marker and mutable Code Review and Security Review rows. Both rows say `Completed` on short commit `5f6c5f4`. The same pull request has a native `COMMENTED` review on full commit `5f6c5f4a1a7e4ca94c69d4c777d0f2113c3c9176` and two inline findings whose `original_commit_id` is that full SHA. This proves that `Completed` is a lifecycle result, not a clean outcome.
- [PostHog/posthog#91476 summary comment](https://github.com/PostHog/posthog/pull/91476#issuecomment-5475999816) says it shows the latest review activity. GitHub's API reports that this one comment was created at `2026-08-31T08:48:43Z`, updated at `2026-08-31T09:45:05Z`, and now contains a `Completed` row on short commit `1b9f38c`. The edit timestamps and latest-activity contract establish that the comment is mutable; GitHub does not expose its earlier Markdown body as durable history.
- [openai/codex-security#536 summary comment](https://github.com/openai/codex-security/pull/536#issuecomment-5377059514) combines code and security lifecycle rows and retains resolved security findings from current and earlier commits. The pull request also contains older explicit clean issue comments with reviewed short SHAs. Its `Codex Security Review` check exposes a full current-head `head_sha` and terminal conclusion. This demonstrates independent code and security activities, compatibility with older clean forms, and the stronger scope evidence available from a configured check.
- [lynnswap/CodexReviewKit#78](https://github.com/lynnswap/CodexReviewKit/pull/78) contains an older explicit issue comment stating that the review failed because a Git ref did not exist. Error comments remain part of the compatibility surface.

Across these examples, findings appeared in submitted reviews, inline comments and threads, and issue-comment summaries. GitHub separately documents check output, annotations, and commit comments as feedback surfaces. No one surface is complete.

## Decisions and rationale

- Record automated review as `lifecycle × outcome × scope`. A single enum would conflate `Completed` with clean or current-head coverage.
- Treat visible running or equivalent activity as pending and stop. The merge workflow does not poll because an open-ended waiter adds race, timeout, and retrigger policy that the user did not request. A later merge invocation starts from fresh evidence.
- Refetch all paginated feedback surfaces after terminal activity is observed and again immediately before merge. Terminal status can be published before or alongside findings, and summary comments are mutable.
- Require affirmative clean evidence. Silence, no review object, no check, or a reaction by itself cannot distinguish clean execution from absence or failure. A reaction can contribute only when its provider-documented meaning and related lifecycle evidence make the combined result explicit.
- Prefer native full `PullRequestReview.commit_id` and check-run `head_sha`. Resolve a short SHA only as an unambiguous prefix of one relevant full commit.
- Use inline `original_commit_id` for historical attribution. A later thread state must not make an old finding look like current-head review.
- Preserve stale review findings for disposition, but do not invent a current-head review requirement. Stale completion blocks current-head evidence only when repository policy requires that evidence.
- Keep ordinary review feedback classification independent of provider. Automated findings remain findings even if the provider changes markup, delivery surface, actor identity, or severity presentation.
- Keep review completion separate from merge readiness. Required checks, approvals, resolved conversations, deployments, branch freshness, mergeability, and queue rules still apply.
- Never trigger or retrigger optional hosted reviews during merge. An absent required review blocks under repository policy; an absent optional review is neither clean evidence nor a new requirement.

## Unstable details and compatibility policy

The hidden marker, bot login and numeric ID, summary heading, table columns, emoji, short-SHA length, timestamps, trigger labels, explanatory Markdown, reaction placement, and whether the same comment is edited are observed implementation details. They may change without violating OpenAI's documented product contract.

Future maintenance should preserve semantic compatibility with:

- mutable lifecycle summaries and independent review types;
- submitted reviews and inline findings;
- explicit older clean and error issue comments;
- reaction-based clean signals only when combined with sufficient lifecycle and scope evidence;
- optional absence of an ordinary code-review check;
- configured head-associated security or required checks;
- generic non-Codex reviewers and automation.

Do not replace this evidence model with a parser for one Markdown layout. Revisit the workflow when GitHub changes native scope fields or pagination semantics, or when a provider publishes a stable machine-readable lifecycle and outcome API.
