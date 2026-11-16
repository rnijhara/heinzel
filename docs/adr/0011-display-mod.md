# 11. Display mod: panel and band

- Status: Accepted
- Date: 2026-11-16

## Context
Claude Code's task list doesn't show an agent's work. On Claude Code 2.1.325, a mod can open a side pane and draw a band above the input, but can't add rows to the task list.

## Decision
- **`/heinzel`** opens a panel listing tasks: status mark, label, age and latest line. Clicking one shows its transcript.
- **A band** shows while tasks run, with buttons to open the panel or close the band.
- **No status line or hint line.**
- **Display only:** the mod reads state files and changes nothing.

## Consequences
Without the mod, everything works but nothing is visible. The mod API may change between releases.
