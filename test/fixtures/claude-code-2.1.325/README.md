# Claude Code 2.1.325 wire logs

Recorded during the design phase with a minimal probe MCP server (ADR-0005). `<<` lines are what Claude Code sent and `>>` lines are what the probe answered.

- `tasks-on-wire.txt`: an interactive terminal session with MCP tasks enabled. It shows `server/discover`, `tools/list`, a task-mode `tools/call`, and `tasks/get` polling until the task completed.
- `tasks-off-wire.txt`: the desktop app's `stream-json` mode, where tasks are off and `tools/call` is a plain call.

`test/relay.test.ts` replays Claude Code's requests from these logs against the relay.
