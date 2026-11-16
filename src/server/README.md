# MCP server (relay)

One per Claude Code session, started from `.mcp.json`. It serves the six tools (ADR-0006) and the server instructions (ADR-0007), and forwards every call to the helper over a local socket (ADR-0004). It holds no task state of its own.

Bundled to `dist/server.mjs` (ADR-0015).
