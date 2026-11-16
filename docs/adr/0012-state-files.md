# 12. Task state in files

- Status: Superseded in part by ADR 19
- Date: 2026-11-16

## Context
The mod has to see the helper's tasks without holding a connection to it.

## Decision
- **`tasks.json`:** the task index, rewritten atomically, with a `format` version.
- **`tasks/<id>.jsonl`:** one append-only transcript per task.
- **The mod only reads** these files. They're readable only by the user.
- **Pruning:** the helper removes finished tasks after a retention period.

## Consequences
The file format is an interface between the helper and the mod. Changes need a format bump.
