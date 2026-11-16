# ADR-0013: Dispatch from subagents blocks

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Claude Code moves only the main conversation's MCP calls to the background. Calls made inside a subagent always run to completion (Claude Code docs, checked on 2.1.325). A `dispatch` from a subagent therefore blocks that subagent until the agent finishes.

## Decision

Subagents may call `dispatch` and `follow_up`. The call blocks until the task ends, and the result returns inline. This is documented, and we don't work around it.

## Alternatives considered

- **Refusing dispatch from subagents:** takes away a useful pattern (for example, a subagent that fans out to another agent) to avoid a delay the subagent can usually afford.

## Consequences

- A subagent that dispatches long work holds its slot until the work ends.
- The per-call time limits (`MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`) still apply. The helper sends progress notifications so a long task doesn't hit the idle timeout.

## History

- 2026-11-16: Accepted.
