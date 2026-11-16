# 21. The terminal folds tool calls too, and the view follows the theme

- Status: Accepted
- Date: 2026-11-16
- Supersedes in part: ADR 20 (the terminal shows every tool call as its own ⏺ row)

## Context
On the terminal, a ⏺ row per command buried a task's messages under its tool calls. The desktop view folds them, and reads better. On Claude Code 2.1.325 a pane draws its own fill unless opened with `backgroundColor: "transparent"`, so it looked darker than the transcript beside it. The mod API can't read the selected theme; colours given as theme keys follow it.

## Decision
- **One view on every surface:** the brief cut to its first lines with `Show more`, messages as Markdown, each run of tool calls folded into one line that opens to its calls, a command opening to its command and output.
- **The terminal keeps its marks:** the brief framed like Claude Code's prompt box (`promptBorder`, `>` inside), `⏺` before messages and tool lines, calls under `⎿`, and `✻ Done in …` at each turn's end.
- **Red means failed:** a tool line's dot is red only when every call in it failed; otherwise the line says `· N failed`, uncoloured. The terminal inverts a pressable line under the pointer, so lines there carry no colour. A search (`rg`, `grep`) that exits 1 with no output found nothing, and isn't a failure.
- **Theme:** every colour is a theme key, and the pane opens with a transparent background.

## Consequences
One renderer instead of two. The view follows light, dark and custom themes with no work of ours, but can't match a colour the theme has no key for.
