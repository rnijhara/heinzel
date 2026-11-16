# ADR-0015: TypeScript on Node, with MCP SDK v2

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

We need a language and runtime for the MCP server (the per-session relay) and the shared helper (ADR-0004). The display mod (ADR-0011) has no choice: Claude Code loads a mod's hooks module as TypeScript (`.ts` or `.tsx`) and runs it itself.

The server has to speak MCP protocol revision 2026-07-28, which brings `server/discover` and per-request `_meta` capabilities. It also needs the `io.modelcontextprotocol/tasks` extension (ADR-0005).

Facts checked on 2026-11-16:

- **Node isn't guaranteed.** Claude Code 2.1.325 and Codex CLI 0.167.2 are both installed here as native binaries, not through npm, so neither brings Node with it.
- **MCP SDK v1** (`@modelcontextprotocol/sdk` 1.32.2, the latest) stops at revision 2025-11-25.
- **MCP SDK v2** (`@modelcontextprotocol/server` and `@modelcontextprotocol/core` 2.4.0) is the stable line and implements 2026-07-28. Its build negotiates `server/discover` and reads the `_meta` envelope. It needs Node 20 or later and `zod` 4. We checked this in the published package's code and README.
- **SDK v2 has no tasks extension.** It knows the method names `tasks/get` and `tasks/cancel` but implements no handlers for them, and the only extension it ships is `ext/skills`. It does accept handlers for methods outside the spec (`setRequestHandler` with explicit schemas).
- **The probe server.** A minimal stdio server from the design work answers `server/discover`, advertises `execution.taskSupport`, returns `resultType: "task"` and serves `tasks/get`. Claude Code 2.1.325 accepted it (ADR-0005). That gives us the exact wire format to aim for.
- **Codex can generate TypeScript types** for its protocol (`codex app-server generate-ts`).

## Decision

- **Language:** TypeScript everywhere: the relay, the helper and the mod.
  - The source is limited to syntax Node can strip without compiling (`erasableSyntaxOnly`), so Node runs it directly in development and tests.
  - `tsc` does the type checking.
- **Runtime:** Node 22 or later for the relay and the helper.
  - This is a stated prerequisite, next to the Codex CLI.
  - Node 20 is past end of life, which is why we require 22.
- **Distribution:** esbuild bundles each entry point (`server.mjs`, `helper.mjs`) into one file with its dependencies, so installing the plugin needs no `npm install`.
  - The relay starts the helper with `process.execPath`, so both run on the same Node.
- **MCP SDK:** `@modelcontextprotocol/server` v2 for the protocol, the handshake and stdio.
- **Tasks extension:** we implement it ourselves on top of the SDK.
  - We advertise the extension, answer `tools/call` with a task, and serve `tasks/get` and `tasks/cancel`, matching the probe's wire format.
  - If the SDK won't let a `tools/call` handler return `resultType: "task"`, we intercept those messages at the transport for task-capable calls.
  - We'll find out which in M3 (see `docs/plan.md`).
- **Codex types** come from `codex app-server generate-ts` and are checked in for each supported Codex version (ADR-0016).

## Alternatives considered

- **SDK v1:** the most widely used, but it can't negotiate 2026-07-28, so we'd have to write the whole new handshake ourselves.
- **No SDK, our own JSON-RPC:** the probe shows it's small. But we'd own handshake negotiation for both protocol eras, and the SDK will gain tasks support later. Kept as the fallback for the tasks extension only.
- **A native binary built with Bun or Deno `compile`:** removes the Node prerequisite. But each binary is roughly 60 MB per platform, needs builds and signing for every operating system, and doesn't fit a plugin installed from git.
- **Go or Rust:** native binaries with the same distribution cost. There's no MCP SDK at revision 2026-07-28 we've checked, and the mod would still be TypeScript, so the project would use two languages.
- **Python:** not reliably installed either, and its packaging is harder to bundle than a single `.mjs` file.

## Consequences

- Users need Node 22 or later. The relay's `.mcp.json` runs `node`, so a missing Node fails when Claude Code starts the server. The README and `/heinzel-setup` say so.
- One language across the relay, the helper, the mod and the tests.
- We own the tasks extension code until the SDK supports it. When it does, we switch with no change to the tools.
- How the bundled `dist/` reaches users (committed on a release branch, or built by CI) is decided with packaging. Until then `dist/` is ignored by git.
- SDK v2 moves fast (2.2 to 2.4 in under a month). We pin exact versions.

## History

- 2026-11-16: Proposed.
- 2026-11-16: Accepted.
- 2026-11-16: M3 answered the open question. SDK v2 doesn't let a handler return a task result, so the tasks extension is a transport wrapper under `serveStdio` (ADR-0017).
