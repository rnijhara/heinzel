# ADR-0011: Display mod: thread panel and band

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Claude Code's tasks list shows each running task, but not the agent's work: its messages, commands and edits. Users want to watch tasks and read full transcripts without leaving Claude Code.

Checked with the mod API in Claude Code 2.1.325:

- `$.ui.open` places a pane beside the chat. A pane opened on request may use any width; a docked pane gets a close mark from Claude Code itself.
- An `AbovePrompt` render hook draws a band above the input in the terminal, desktop and mobile.
- A mod can't add rows to Claude Code's own tasks list or to the desktop's Environment panel.
- A trial mod with fake tasks confirmed this layout works on desktop.

## Decision

The mod is display-only. It reads the helper's state files (ADR-0012) and changes nothing.

- **Panel:** `/heinzel` opens a side panel and the built-in close mark closes it.
  - It first lists the tasks, each with a status mark, label, age and latest line.
  - Clicking a task shows its full transcript: the brief, the agent's messages, commands, edits and the final result, with a back button to the list.
- **Band:** one row above the input while any task is running ("Heinzel ● 2 running ✓ 1 done"), with an "Open panel" button and a close button. Closing hides it until the next task starts.
- **No status line and no hint line.** The band is the only indicator.

## Alternatives considered

- **A status line or hint line under the input:** two indicators were too many. The band is visible on every surface. The hint line draws only in the terminal.
- **A panel showing every task's output at once:** too noisy. List first, then one transcript.
- **The desktop widget placement:** clicks may not reach it.

## Consequences

- Without the mod, everything still works. Users just can't see transcripts in Claude Code.
- The mod depends on the mod API, which may change between Claude Code releases.

## History

- 2026-11-16: Accepted.
