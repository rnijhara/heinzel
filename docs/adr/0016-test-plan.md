# ADR-0016: Test plan

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Heinzel sits between two programs that change often: Claude Code, with its MCP client, background behaviour and mod API, and Codex, with its app-server protocol. Most of our risk is at those edges, not in our own logic. Real runs are also slow and cost money: a live dispatch spends Claude and Codex tokens.

Checked on Codex CLI 0.167.2:

- `codex app-server generate-json-schema` writes the protocol as JSON Schema.
- `codex app-server generate-ts` writes the protocol as TypeScript types.
- Neither command needs a signed-in account.

Checked on Claude Code 2.1.325: `claude plugin validate` and `claude plugin test` check and test a mod's hooks module, and a session can load a plugin from a folder with `--plugin-dir`.

## Decision

There are four layers. The first three run on every change, need no account and spend no tokens. The fourth is live.

1. **Unit tests with a fake `codex app-server`.**
   - The fake is a small Node program that speaks the app-server's JSON-RPC over stdio. Scripted scenarios drive it: streamed turn events, approval requests, input and elicitation requests, errors, a crash, a hang.
   - Every message the fake sends is validated against the checked-in JSON Schema, so the fake can't drift from real Codex.
   - These tests cover the helper:
     - the Codex adapter and thread handling
     - answering server requests (ADR-0008)
     - health and restart (ADR-0004)
     - state file writes (ADR-0012)
     - worktrees (ADR-0010)
   - Runner: Node's built-in `node:test`, running the TypeScript source directly (ADR-0015).
2. **Protocol check against Codex's own schema.**
   - The JSON Schema and the generated TypeScript types are checked in for each supported Codex version, starting with 0.167.2, under `protocol/codex/<version>/`.
   - The adapter imports its types from the generated TypeScript, so `tsc` catches breaking changes.
   - A script regenerates both from the installed Codex and fails on any difference. That's the signal to add a new version folder and look at what changed.
3. **Relay and helper integration.**
   - Real relay and helper processes run against the fake app-server. An MCP client from SDK v2 drives the relay over stdio.
   - Covered: the lock file, the socket, the version handshake, idle exit, routing events to the right session, and two relays sharing one helper.
   - The MCP client runs both ways (ADR-0005): with the tasks extension (task result, then `tasks/get`) and without it (a plain call that blocks).
   - The wire format is checked against the probe transcripts recorded in the design phase, checked in as fixtures.
   - The mod is checked with `claude plugin validate` and `claude plugin test`, against seeded state files.
4. **Live end-to-end tests with real Claude Code and Codex.**
   - Scripted runs of `claude -p --output-format stream-json --plugin-dir <repo>`, with `CLAUDE_AUTO_BACKGROUND_TASKS=1` and `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=1000`, in a throwaway git repo.
   - Each run is checked in the stream: the dispatch moves to the background, Claude is woken with the result, and Claude doesn't poll.
   - Scenarios:
     - `dispatch`, then the wake-up
     - `follow_up` on the same thread
     - `recall` of a running task
     - `worktree: true`
     - an unknown model being rejected
     - the missing-settings message when automatic backgrounding is off
   - One manual check in an interactive terminal covers the MCP tasks path while that path is behind a feature flag (ADR-0005).
   - These runs are manual or scheduled, never on every change. Each records the Claude Code and Codex versions it ran on.

## Alternatives considered

- **Unit tests against a real `codex app-server`:** they'd need a signed-in account and spend tokens, they're slow, and we couldn't force crashes or approval requests on demand.
- **Mocking at the function level instead of a fake process:** misses framing, stdio buffering and process-lifecycle bugs, which are where the helper is fragile.
- **Live tests on every change:** too slow and costly, and they fail for reasons outside our code (rate limits, model changes).
- **Vitest or Jest:** more features, but `node:test` needs no dependencies and runs our TypeScript directly on Node 22 or later.

## Consequences

- Supporting a new Codex version means adding its schema folder and getting layers 1–3 to pass. Layer 4 confirms it.
- The fake app-server is code we maintain. Validating against the schema keeps it honest.
- Each new Claude Code release should get a layer 4 run, which is also when we re-check MCP task availability (ADR-0005).

## History

- 2026-11-16: Proposed.
- 2026-11-16: Accepted.
