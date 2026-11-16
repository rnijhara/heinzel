# ADR-0003: Drive Codex through `codex app-server`

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Heinzel needs to start Codex work, stream its events (messages, commands, file edits), send follow-ups to the same thread, interrupt it, and list the models it offers.

Checked on Codex CLI 0.167.2:

- `codex app-server` speaks JSON-RPC over stdio. It supports many threads per process, streams turn events, and serves requests such as `model/list`, `config/read` and turn interrupts.
- `codex mcp-server` no longer exists.
- `codex exec` runs one-shot jobs with no long-lived session.
- The app-server sends requests back to the client: command and file-change approvals, `item/tool/requestUserInput` and `mcpServer/elicitation/request`. The client has to answer them.
- `codex app-server generate-json-schema` writes the full protocol schema, which we use as the reference.

## Decision

Heinzel drives Codex only through `codex app-server`, over JSON-RPC on stdio. The helper process (ADR-0004) owns the app-server, creates one Codex thread per task, and answers its server-to-client requests (ADR-0008).

We generate and check in the protocol schema for each Codex version we support, and test against it.

## Alternatives considered

- **`codex exec` per task:** simpler, but no follow-ups on the same thread, no clean interrupt and no model list.
- **`codex mcp-server`:** removed from the Codex CLI.

## Consequences

- We depend on the app-server protocol, which can change between Codex releases. The schema check should catch breaking changes.
- Adding another agent later means another adapter in the helper. The tools and the mod stay the same.

## History

- 2026-11-16: Accepted.
