# ADR-0017: Runtime layout and lifetimes

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

ADR-0004 and ADR-0012 left four values to be decided during implementation: where the state directory is, how long an idle helper lives, how long finished tasks are kept, and what a task is called when no label is given. Building M1–M3 also settled where worktrees go, how a relay identifies its session, and how the relay negotiates the MCP protocol.

Facts checked on Claude Code 2.1.325, Codex CLI 0.167.2 and MCP SDK v2 2.4.0:

- **The mod can read any absolute path.** `$.fs.read`, `list` and `stat` accept absolute paths up to 4 MiB per read, and `$.env.get("HOME")` works (mod API types). There's no file watch, so the mod polls.
- **Claude Code gives plugins `CLAUDE_PLUGIN_DATA`.** But that folder is per plugin install, so a development copy and a marketplace copy of Heinzel would get different folders, and so different helpers for one Codex account.
- **Socket paths are limited** to about 104 bytes on macOS.
- **Claude Code opens every MCP server with `server/discover`** at revision 2026-07-28, whether tasks are on or off (recorded wire logs in `test/fixtures/claude-code-2.1.325/`).
- **SDK v2 negotiates eras only in `serveStdio`.** A plain `McpServer.connect(StdioServerTransport)` answers `server/discover` with "Method not found". `serveStdio` takes a custom transport.
- **Codex has its own app-server daemon.** `codex app-server daemon` and `proxy` manage a long-lived app-server for SSH and remote control. Its lifecycle (`update` "may interrupt running work") belongs to Codex, not to us.

## Decision

- **State directory:** `$HEINZEL_HOME`, by default `~/.heinzel`. Inside it:
  - **One folder per agent account,** `codex-<hash of CODEX_HOME>`. It holds `account.json`, `tasks.json`, `tasks/<id>.jsonl`, `helper.lock`, `helper.sock` and `helper.log`.
  - **Permissions:** folders are `0700` and files `0600`.
  - **The socket** moves to the temp dir (`heinzel-<uid>-<hash>.sock`) when its path would be over 100 bytes.
  - **The mod** reads `~/.heinzel/*/tasks.json`, honouring `HEINZEL_HOME`.
- **Worktrees** (ADR-0010) go under `~/.heinzel/worktrees/<repo>-<hash>/<task-id>`, on branch `heinzel/<label-slug>-<id>`. This keeps the user's own folders untouched.
- **Idle timeout:** the helper exits 10 minutes after the last relay disconnects with no tasks running. `HEINZEL_IDLE_MS` overrides it. Ten minutes outlives a quick session restart without keeping Codex resident all day.
- **Retention:** finished tasks and their transcripts are pruned 7 days after they finish. This runs at helper start and then hourly. `HEINZEL_RETENTION_DAYS` overrides it.
- **Default label:** the first seven words of the brief's first line, cut to 48 characters.
- **Task ids:** `task_` plus 8 hex characters.
- **Session identity:** a relay uses `CLAUDE_CODE_SESSION_ID` when Claude Code passes it, otherwise a per-process id. Progress is routed by that id (ADR-0004).
- **Protocol negotiation:** the relay serves through SDK v2's `serveStdio`.
  - The tasks extension sits under it, as a transport wrapper on the raw wire (ADR-0015).
  - The wrapper adds the extension to the handshake result and `execution.taskSupport: "optional"` to `dispatch` and `follow_up` in `tools/list`.
  - It answers task-capable `tools/call`, `tasks/get` and `tasks/cancel` itself, and passes everything else through.
- **Codex's own daemon:** not used. The helper starts its own `codex app-server` over stdio (ADR-0003, ADR-0004).

## Alternatives considered

- **`CLAUDE_PLUGIN_DATA` for state:** tied to the install source, so two installs would split one account's tasks across two helpers.
- **The platform's state folder** (`~/Library/Application Support`, `$XDG_STATE_HOME`): more conventional, but harder to find, and paths with spaces are awkward in docs. `HEINZEL_HOME` covers anyone who wants it elsewhere.
- **Worktrees beside the repository** (`../<repo>.heinzel/`): visible, but they write into the user's folders unasked.
- **Shorter idle timeout (1 minute):** restarts Codex, at about 1–2 seconds a time, after every short pause.
- **Keeping finished tasks forever:** transcripts hold briefs and command output, and grow without bound.
- **Building on `codex app-server daemon`:** shared with other Codex clients and remote control, updated on Codex's schedule, and not something a plugin should start or stop for the user.

## Consequences

- The state layout is an interface with the mod; it carries `format` (ADR-0012).
- A user who wants a different place sets `HEINZEL_HOME` for both Claude Code and the mod's environment.
- If SDK v2 gains tasks support, the transport wrapper can go with no change to the tools.

## History

- 2026-11-16: Accepted.
