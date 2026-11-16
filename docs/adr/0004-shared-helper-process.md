# 4. One shared helper per agent account

- Status: Accepted
- Date: 2026-11-16

## Context
Claude Code starts a plugin's MCP server once per session. One app-server per session would duplicate Codex processes, kill tasks when the session closes, and hide other sessions' tasks.

## Decision
- A shared helper runs one `codex app-server` per account (per `CODEX_HOME`) and holds every session's tasks.
- Each session's MCP server is a thin relay to the helper over a local socket.
- The first relay starts the helper; a lock file allows only one.
- A task's events go only to the session that started it.
- A crashed or hung app-server is replaced. Its running tasks fail.
- The helper exits when idle. A newer relay restarts an idle older helper.

## Consequences
Tasks outlive their session. The helper's lifecycle is our code to test.
