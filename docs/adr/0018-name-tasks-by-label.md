# ADR-0018: Tasks can be named by label

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

ADR-0006 says every tool result carries the task id. On the automatic-backgrounding path (ADR-0005), that's only true at the end. Claude Code moves the `dispatch` call to the background after about a second and gives Claude a message of its own: the call "was moved to the background as task `<id>`", where the id is Claude Code's background task id (for example `kswpljim8`). Heinzel's result, with its `task_…` id, arrives only when the task finishes.

A live run on Claude Code 2.1.325 showed the consequence. Claude was asked to `recall` a running task. It passed Claude Code's background id, got "No task with id", and had no way to name the task until it finished. TaskStop on the background task did cancel the Codex turn, as designed (ADR-0005), so cancelling worked; `recall`, `status` and `transcript` did not.

In MCP task mode the task id is Heinzel's own, so the problem doesn't arise there.

## Decision

- **`task_id` takes an id or a label.** For `status`, `recall`, `transcript` and `follow_up`, the field accepts a `task_…` id or the task's label. The input name doesn't change.
  - Labels match case-insensitively.
  - The asking session's tasks come first, then running tasks, then the newest.
  - If more than one running task has that label, the error lists their ids.
- **A clear error for Claude Code's ids.** A value that looks like a Claude Code background task id gets an error saying so, and saying to use TaskStop with it or pass the label.
- **The server instructions** (ADR-0007) tell Claude to give every dispatch a short, distinct label, to refer to a running task by that label, and to cancel it with TaskStop or `recall` with the label.

## Alternatives considered

- **Return Heinzel's id before the call is backgrounded:** an MCP tool call has one result. Progress notifications carry the id but don't reach the model.
- **Map Claude Code's background id to ours:** the relay sees the tool-use id in `_meta` (`claudecode/toolUseId`), but not the background task id Claude Code shows the model. The mapping would rest on undocumented behaviour.
- **Make `label` required:** it would also fix the problem, but it would be a breaking change to `dispatch`, and the default label from the brief already works as a name.

## Consequences

- Labels become a way to refer to tasks, so the default label (ADR-0017) should stay short and readable.
- Two running tasks with the same label need their ids; the error gives them.

## History

- 2026-11-16: Accepted.
