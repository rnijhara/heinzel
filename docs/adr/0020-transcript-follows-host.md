# 20. The transcript view follows the host's look

- Status: Accepted
- Date: 2026-11-16

## Context
A task's transcript should read like Claude Code's own, so it needs no learning. On Claude Code 2.1.325 the terminal draws tool calls as `⏺` rows with results under `⎿`, while the desktop app shows plain text and folds each run of tool calls into one line that opens on a click. The mod API tells a hook which surface draws it (`e.surface`). It has no scrollable box (only the pane and the band scroll), no divider, and `Button` is the only pressable element. Codex 0.167.2 sends parsed `commandActions` (read, list files, search) with each command.

## Decision
- **Terminal:** the brief as a `>` prompt; messages, commands, edits and tool calls as `⏺` rows; results under `⎿`; `✻ Done in …` at each turn's end.
- **Other surfaces:**
  - The brief in a bubble, cut to its first lines with `Show more`.
  - Messages as plain Markdown.
  - Each run of tool calls folded into one line ("Ran 3 commands, edited 1 file +12"). It opens to one line per call, and a command's line opens to the command and its first 8 output lines, then `… +N lines`, which opens the rest in place.
- **Command titles** come from Codex's parsed actions ("Read a.ts", "Searched for "x" in src"). A command Codex couldn't parse is shown as itself.

## Consequences
Two renderers to keep in step with Claude Code's look, which may change between releases. Long output can't scroll in place: it opens in full and the pane scrolls.
