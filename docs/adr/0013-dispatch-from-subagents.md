# 13. Dispatch from subagents blocks

- Status: Accepted
- Date: 2026-11-16

## Context
Claude Code never moves a subagent's MCP calls to the background (Claude Code 2.1.325 docs).

## Decision
- Subagents may call `dispatch` and `follow_up`; the call blocks until the task ends.
- The relay sends progress notifications so a long task doesn't hit the idle timeout.

## Consequences
A subagent that dispatches long work is busy until the work ends.
