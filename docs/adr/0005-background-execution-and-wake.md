# 5. Background execution and wake-up

- Status: Accepted
- Date: 2026-11-16

## Context
Claude must keep working after a dispatch and be woken when it finishes, without polling. On Claude Code 2.1.325:
- **MCP tasks:** need protocol revision 2026-07-28 and the `io.modelcontextprotocol/tasks` extension. They're behind a feature flag. They're off in the desktop app, and in the terminal only on with `DISABLE_TELEMETRY=1`.
- **Automatic backgrounding:** moves a plain call to the background after `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`. The desktop app's stream-json mode also needs `CLAUDE_AUTO_BACKGROUND_TASKS=1`. The threshold applies to every MCP server, and calls inside subagents are never moved.

## Decision
- **Support both paths.** Answer with a task when the call offers the tasks extension. Otherwise block until the turn ends, and let automatic backgrounding move the call.
- **Settings:** `/heinzel-setup` writes `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=1000` and `CLAUDE_AUTO_BACKGROUND_TASKS=1`, after the user agrees.
- **Missing settings:** the result says what to add.
- **Cancelling:** stopping the background task (TaskStop or `tasks/cancel`) interrupts the Codex turn.

## Consequences
Every slow MCP call moves to the background after a second once the settings are on. The settings can go when MCP tasks reach users. Re-check this with each Claude Code release.
