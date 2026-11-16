# Helper

One per agent account, shared by every session (ADR-0004). It owns `codex app-server` (ADR-0003), runs tasks unattended (ADR-0008), and writes the state files the mod reads (ADR-0012).

Bundled to `dist/helper.mjs` and started by the relay with the same Node (ADR-0015).
