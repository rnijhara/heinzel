# 16. Four layers of tests

- Status: Accepted
- Date: 2026-11-16

## Context
Most of the risk is at the edges with Claude Code and Codex. Real runs cost tokens.

## Decision
1. **Unit tests** against a fake `codex app-server`. Every message it sends is validated against Codex's schema.
2. **Protocol drift check:** the generated schema and types are checked in under `protocol/codex/<version>/` and compared with the installed Codex.
3. **Integration tests:** real relay and helper processes, driven over stdio with and without tasks, plus a replay of recorded Claude Code wire logs. The mod is tested with `claude plugin test`.
4. **Live runs** with real Claude Code and Codex (`test/live/`), by hand only.

## Consequences
Layers 1–3 need no account and run on every change. Run layer 4 on each new Claude Code or Codex release.
