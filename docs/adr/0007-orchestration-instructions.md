# 7. Orchestration rules as server instructions

- Status: Accepted
- Date: 2026-11-16

## Context
Claude orchestrates well only with a few standing rules. MCP server instructions go into Claude Code's system prompt, and they survive compaction.

## Decision
The server's `instructions` (`src/server/instructions.ts`) carry short rules:
- when to use Heinzel and when not to;
- call `roster` once before the first dispatch;
- never switch or fall back to another model unasked;
- write briefs that stand alone, with no secrets;
- never poll;
- `follow_up` for the same work, a new dispatch for every review;
- recall stale tasks;
- refer to tasks by label.

## Consequences
The rules cost a small fixed amount in every session. Changes to them should be tried in real sessions.
