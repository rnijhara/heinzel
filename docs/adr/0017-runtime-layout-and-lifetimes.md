# 17. Runtime layout and lifetimes

- Status: Accepted
- Date: 2026-11-16

## Context
The mod can read any absolute path (Claude Code 2.1.325). `CLAUDE_PLUGIN_DATA` differs per install, which would split one account across two helpers. Socket paths are limited to about 104 bytes.

## Decision
- **State:** `$HEINZEL_HOME`, by default `~/.heinzel`. One folder per account, `codex-<hash of CODEX_HOME>`, with folders `0700` and files `0600`.
- **Socket:** in that folder, or in the temp dir when the path is too long.
- **Worktrees:** `~/.heinzel/worktrees/<repo>-<hash>/<task-id>`, on branch `heinzel/<label>-<id>`.
- **Idle exit:** 10 minutes (`HEINZEL_IDLE_MS`).
- **Retention:** finished tasks are kept 7 days (`HEINZEL_RETENTION_DAYS`).
- **Default label:** the first seven words of the brief. **Task ids:** `task_` and 8 hex characters.
- **Sessions:** the relay identifies its session by `CLAUDE_CODE_SESSION_ID`.
- **Codex's own app-server daemon isn't used.**

## Consequences
Set `HEINZEL_HOME` to move everything.
