---
description: Check Heinzel's prerequisites and turn on background dispatch
allowed-tools: Bash(node:*)
---

Set up Heinzel for this user. Follow these steps in order, and don't change any file before the user agrees.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/setup.mjs" check` and read the JSON it prints.
2. Report what you found in a few lines:
   - Node: needs 22.18 or later.
   - Codex CLI: installed, its version, and whether it's signed in. If it's not installed, tell the user to install it. If it's not signed in, tell them to run `codex login` themselves.
   - Background settings in `~/.claude/settings.json`.
3. If both settings are already set, say Heinzel is ready and stop.
4. Otherwise, explain the change before asking:
   - **What it adds:** `"CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "1000"` and `"CLAUDE_AUTO_BACKGROUND_TASKS": "1"` under `"env"` in `~/.claude/settings.json`. Nothing else in the file changes, and a backup is written beside it.
   - **Why:** a dispatched task moves to the background after about a second, and Claude is woken when it finishes, instead of waiting.
   - **Side effect:** the setting applies to every MCP server, so any MCP call that takes longer than a second also finishes in the background.
   - **Later:** once Claude Code turns on MCP tasks for the user's sessions, Heinzel uses those automatically, and the settings can be removed.
5. Ask the user whether to apply it. Only on a clear yes, run `node "${CLAUDE_PLUGIN_ROOT}/dist/setup.mjs" apply`, report what changed and where the backup is, and tell them to restart Claude Code.
