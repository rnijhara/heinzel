# ADR-0007: Orchestration instructions in the system prompt

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

How well Claude orchestrates depends mostly on a short set of standing rules: when to dispatch, how to wait, when to start fresh. Those rules need to be in the system prompt, survive compaction, and come with the plugin.

An MCP server's `instructions` (sent when it connects) are placed in Claude Code's system prompt under "MCP Server Instructions". A session-start hook can only add context, which carries less weight and is injected again after compaction.

## Decision

The MCP server sends Heinzel's orchestration rules as its `instructions`. They're short and rule-like, and they cover:

- **When to use Heinzel:** ordinary work needs no Heinzel. Use Claude's own Agent tool for Claude subagents. Use `dispatch` when the user asks for another agent or model, when the work should run on another agent, or when it needs its own worktree.
- **Models:** call `roster` once before the first dispatch in a conversation. Never switch agent or model unless the user asked, and never fall back to another one on failure.
- **Briefs:** a brief must stand alone, since the agent sees nothing else. Never put secrets in it.
- **Waiting:** after a dispatch, carry on with other work, or end the turn. Completion wakes Claude. Never poll: no `status` on a running task, no sleeps, no watchers.
- **Follow-ups:** use `follow_up` to continue the same piece of work. Every new review or re-check is a new `dispatch`. Fix small review findings yourself.
- **Cleanup:** `recall` a task that's been replaced or is no longer needed.
- **Questions:** dispatched agents never ask the user anything. If a result says the agent is blocked or needs a decision, Claude asks the user or sends a `follow_up` with more detail.
- **Reporting:** refer to tasks by their label, not their id.

The text is our own and lives in the repo as a reviewed source file, versioned with the server.

## Alternatives considered

- **A session-start hook adding context:** weaker than the system prompt.
- **A skill:** loaded only when Claude decides to, and redundant with the tool descriptions (ADR-0002).
- **A mod adding a system prompt section (`prompt.compose`):** puts logic in the mod (ADR-0002).

## Consequences

- The rules are in every session that has the plugin enabled, a small fixed cost.
- Changing the rules changes Claude's behaviour, so changes should be tested in real sessions.

## History

- 2026-11-16: Accepted.
