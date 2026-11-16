# ADR-0006: Tool surface

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Claude learns how to use Heinzel from the tool names, input schemas and descriptions, plus the server instructions (ADR-0007). The tools need to be easy to pick correctly, hard to misuse (for example, by polling), and loaded without an extra ToolSearch step.

Checked on Claude Code 2.1.325: MCP tools are deferred behind ToolSearch by default. A server configured with `alwaysLoad: true`, or a tool flagged with `_meta["anthropic/alwaysLoad"]`, is always included in the prompt.

## Decision

The MCP server exposes six tools. Claude sees them as `mcp__plugin_heinzel_heinzel__<name>`.

| Tool | Purpose |
| --- | --- |
| `dispatch` | Start one task for an agent. Runs in the background (ADR-0005). |
| `roster` | List the agents and models available, and the effective default. |
| `status` | Report a task's state. Not for polling a running task. |
| `recall` | Cancel a running task. |
| `follow_up` | Send another message to an existing task's thread. Runs in the background like `dispatch`. |
| `transcript` | Read a task's thread: messages, commands and edits. |

**`dispatch` inputs:**

| Field | Required | Meaning |
| --- | --- | --- |
| `brief` | yes | The whole task. The agent sees nothing else (ADR-0008). |
| `model` | no | One of `roster`'s models. Unknown names are rejected with the valid list. Defaults to the user's configured model. |
| `effort` | no | Reasoning effort, checked against the model's supported values. |
| `label` | no | A short title shown in the mod and the tasks list. |
| `worktree` | no | `true` runs the task in its own git worktree (ADR-0010). Default `false`: the session's working directory. |

**Results:** each result carries the task id, its status, and a `then` hint telling Claude what to do next, for example that completion will wake it and it shouldn't poll. A finished task's result is the agent's final message.

**Descriptions:** one to three short, rule-like sentences each, written in our own words. For example, `dispatch` says the agent gets only `brief`, and `status` says not to call it on a running task.

**Loading:** the server is configured with `alwaysLoad: true`.

## Alternatives considered

- **One tool with an `action` field:** fewer tools, but the description gets long, and it's harder to stop Claude from polling.
- **Mod-registered tools:** see ADR-0002.

## Consequences

- Renaming a tool or input is a breaking change for any saved permission rules, so it needs a new ADR.
- With `alwaysLoad`, the six tool schemas are in every prompt (a small, fixed cost).

## History

- 2026-11-16: Accepted.
