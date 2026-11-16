# 15. TypeScript on Node, MCP SDK v2

- Status: Accepted
- Date: 2026-11-16

## Context
- Claude Code loads mods as TypeScript.
- Claude Code 2.1.325 and Codex 0.167.2 are native binaries, so neither guarantees Node.
- MCP SDK v1 stops at revision 2025-11-25.
- SDK v2 (2.4.0) speaks 2026-07-28, but only through `serveStdio`, and has no tasks extension.

## Decision
- **Language:** TypeScript everywhere. Node 22.18 or later is a stated prerequisite.
- **Source:** limited to syntax Node can strip, so Node runs it directly in development and tests.
- **Distribution:** esbuild bundles `dist/server.mjs`, `dist/helper.mjs` and `dist/setup.mjs`.
- **MCP:** `@modelcontextprotocol/server` v2 through `serveStdio`.
- **Tasks extension:** a transport wrapper under `serveStdio`. It advertises the extension, marks `dispatch` and `follow_up` as task-capable, and answers `tools/call`, `tasks/get` and `tasks/cancel` for task-mode calls.

## Consequences
Users need Node. The wrapper can go once the SDK supports tasks. Dependency versions are pinned.
