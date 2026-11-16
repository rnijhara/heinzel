# 3. Drive Codex through `codex app-server`

- Status: Accepted
- Date: 2026-11-16

## Context
On Codex CLI 0.167.2, `codex app-server` speaks JSON-RPC over stdio. It hosts many threads, streams events, takes follow-ups and interrupts, and lists models. `codex exec` is one-shot, and `codex mcp-server` is gone.

## Decision
- The helper drives Codex only through `codex app-server`, with one thread per task.
- Codex's protocol schema and types are checked in for each supported version (ADR 16).

## Consequences
Protocol changes between Codex releases are caught by the drift check. Another agent means another adapter in the helper; the tools stay the same.
