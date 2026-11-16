# ADR-0005: Background execution and wake-up

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The core experience: Claude dispatches work, keeps going (or ends its turn), and is woken with the result when the work finishes. It must not poll.

Claude Code has two native ways to run an MCP tool call in the background. Both put the task in the tasks list, let it be stopped (TaskStop or `/tasks`), and deliver the result to Claude, starting a new turn if Claude is idle. The facts below were checked on Claude Code 2.1.325 with a test MCP server, in the terminal and in the `stream-json` mode the desktop app uses.

1. **MCP tasks.** The server answers `tools/call` with a task, the call returns at once, and Claude Code polls `tasks/get` until the task is done.
   - It needs protocol revision 2026-07-28 and the `io.modelcontextprotocol/tasks` extension.
   - It's in public beta and gated by an Anthropic feature flag. The docs say the desktop app and the VS Code extension don't have it.
   - On our account the flag is off. Without the extension, `tools/call` arrives with no task capability, even in the terminal.
   - In the interactive terminal, tasks did work once feature-flag fetching was off (`DISABLE_TELEMETRY=1`). That also turns off other flag-gated features, so we don't recommend it.
   - There's no setting to turn MCP tasks on. Claude Code has only off switches (`CLAUDE_CODE_DISABLE_MCP_TASKS`, `CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND`).
2. **Automatic backgrounding.** A plain call still running after `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (default 2 minutes) moves to the background.
   - In the desktop app's `stream-json` mode, this happens only with `CLAUDE_AUTO_BACKGROUND_TASKS=1`. Both variables work from the `env` block of `settings.json`.
   - At 1 ms and 200 ms the call moved at once, and the wake-up still arrived.
   - The threshold is global. Claude Code has no per-server or per-tool threshold, only an internal per-server off switch for host-embedded servers.
   - Calls made inside subagents are never moved to the background.

Claude can't ask for an MCP call to run in the background: only built-in tools such as Bash and Agent have that option.

## Decision

- **Support both paths.**
  - When a `tools/call` carries the tasks extension, `dispatch` and `follow_up` answer with a task right away, and the server reports progress and the result through `tasks/get`.
  - Otherwise they run as plain calls that block until the agent's turn ends, and Claude Code's automatic backgrounding moves them to the background.
- **Recommended settings,** documented in the README and written by a `/heinzel-setup` command once the user agrees:

  ```json
  {
    "env": {
      "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "1000",
      "CLAUDE_AUTO_BACKGROUND_TASKS": "1"
    }
  }
  ```

  1000 ms lets most ordinary MCP calls (from any server) finish inline, while a dispatch moves to the background after about a second.
- **This is a stopgap.** Once MCP tasks reach the user's sessions, the server uses them automatically, and the settings can be removed with no change to Heinzel.
- **Detection:** if a call isn't moved to the background (the settings are missing), the tool result says exactly what to add and where.
- **Cancellation:** stopping the task (TaskStop, `/tasks`, or `tasks/cancel` for an MCP task) interrupts the agent's turn through the helper.

## Alternatives considered

- **Background Bash running a Heinzel CLI:** immediate and needs no settings, but see ADR-0002 for why we prefer tools.
- **A background subagent relaying a single tool call:** works with no settings, but costs tokens on every dispatch and adds an agent row in the transcript.
- **The mod forcing early backgrounding:** Claude Code moves running calls to the background when a message is queued for the model mid-turn. Triggering that from the mod would make the mod required, add a message to the conversation on every dispatch, move every other running call too, and rely on internal behaviour.
- **Turning off feature-flag fetching to get MCP tasks in the terminal:** turns off unrelated features, and doesn't help the desktop app.

## Consequences

- With the settings, slow calls from every MCP server move to the background after one second. Users are told before they opt in.
- On desktop, each dispatch waits about a second before Claude can continue.
- A dispatch from a subagent blocks that subagent until the work is done. This is accepted (ADR-0013).
- We should re-check MCP task availability with each Claude Code release and update this ADR's facts when it changes.

## History

- 2026-11-16: Accepted.
