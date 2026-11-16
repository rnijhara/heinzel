# 19. Added state fields keep the format

- Status: Accepted
- Date: 2026-11-16
- Supersedes in part: ADR 12 (every change needs a format bump)

## Context
ADR 12 asks for a format bump on any change to the state files. The mod skips an index whose `format` it doesn't know, so a bump blanks the panel of every older mod. The transcript view needs a few more facts: lines added and removed per edited file, and a title per command.

## Decision
- **Optional fields** added to a task record or a transcript entry keep the format. Readers ignore fields they don't know and treat a missing one as absent.
- **A bump** is still needed to rename, remove or retype a field, change its meaning, or add a required one.
- **First added:** `added` and `removed` on each file of an `edit` entry, `title` on a `command` entry.

## Consequences
Older mods keep working and simply don't show the new facts. Entries written before a field existed show without it.
