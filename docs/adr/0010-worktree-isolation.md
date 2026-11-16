# 10. Optional worktree per task

- Status: Accepted
- Date: 2026-11-16

## Context
Parallel or larger tasks need their own checkout, so they don't collide with each other or with Claude's edits.

## Decision
- **`worktree: true`** creates a worktree on a new branch from `HEAD`. The default is the session's folder.
- **The result** gives the path and the branch.
- **Clean-up:** a worktree with no changes is removed. One with changes is left for Claude or the user to merge.
- **Outside a git repository** it's rejected.

## Consequences
Changed worktrees accumulate until someone removes them.
