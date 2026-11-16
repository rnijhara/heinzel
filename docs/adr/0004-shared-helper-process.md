# ADR-0004: One shared helper process per agent account

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Claude Code starts a plugin's stdio MCP server once per session. If each session's server ran its own `codex app-server`, then:

- with several Claude sessions open, there would be several Codex processes on one account
- a task would die when its Claude session closed, so a resumed session couldn't pick its tasks back up
- the mod could only show the current session's tasks

One `codex app-server` can host many threads (ADR-0003).

## Decision

- **A shared helper process** runs one `codex app-server` per agent account (for Codex, per `CODEX_HOME`) and holds every task from every Claude session.
- **Each session's MCP server is a thin relay.** It forwards tool calls to the helper over a local socket and streams results back.
- **Starting:** the first relay to need the helper starts it. A lock file guarantees that only one starts.
- **Routing:** the helper records which Claude session started each task and sends that task's events only to that session's relay.
- **Health:** if the app-server hangs or crashes, the helper retires it and starts a fresh one for the next turn. Tasks that were running are reported as failed.
- **Shutdown:** the helper exits after a period with no connected relays and no running tasks.
- **Upgrades:** the relay and helper exchange versions when they connect. A newer relay asks an older idle helper to restart. If tasks are running, it waits.

## Alternatives considered

- **One app-server per Claude session:** simpler (about a day less work), but it has all three problems above.

## Consequences

- Tasks outlive the Claude session that started them, and a resumed session can find them again.
- A helper crash affects every session, so the helper needs careful error handling and a restart path.
- Managing the helper's lifecycle (lock, socket, idle exit, version handshake) is our own code to write and test.

## History

- 2026-11-16: Accepted.
