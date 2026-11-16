# ADR-0010: Optional worktree isolation

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

By default a task works in the Claude session's working directory, so its edits land beside Claude's own. That suits small, related work. Parallel or larger tasks need their own checkout so they don't collide, and so each can become its own branch or PR.

## Decision

- **`dispatch` takes `worktree: true`.** The helper then creates a git worktree on a new branch from the current `HEAD` and runs the task there.
- **The result reports** the worktree path and branch name.
- **Cleanup:** the helper leaves the worktree in place when the task ends; merging and removal stay with Claude or the user. A worktree with no changes is removed automatically.
- **Default:** `worktree: false`, the session's working directory.
- **Errors:** outside a git repository, `worktree: true` is rejected with a clear error.

## Alternatives considered

- **Always use a worktree:** safe, but slow and noisy for small tasks, and the edits aren't where Claude expects them.
- **Leave it out of v1:** it's cheap to build, and parallel dispatch needs it.

## Consequences

- Worktrees can pile up. The mod should show each task's worktree, and a cleanup command may follow.

## History

- 2026-11-16: Accepted.
