# 18. Tasks can be named by label

- Status: Accepted
- Date: 2026-11-16
- Supersedes in part: ADR 6 (results are the only source of task ids)

## Context
With automatic backgrounding, Claude only sees Claude Code's background task id until the task ends. A live run on 2.1.325 showed `recall` failing on that id.

## Decision
- **`task_id` takes an id or a label.** This applies to `status`, `recall`, `transcript` and `follow_up`.
- **Matching:** case-insensitive, preferring the asking session's tasks, then running tasks, then the newest. If several running tasks share the label, the error lists their ids.
- **Claude Code ids:** an id that looks like one of Claude Code's gets an error pointing to TaskStop.
- **Instructions:** they tell Claude to label every dispatch and to name running tasks by label.

## Consequences
Labels should stay short and distinct.
