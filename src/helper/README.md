# Helper

One per agent account, shared by every session (ADR 4). It owns `codex app-server` (ADR 3), runs tasks unattended (ADR 8), and writes the state files the mod reads (ADR 12).

Bundled to `dist/helper.mjs` and started by the relay with the same Node (ADR 15).
