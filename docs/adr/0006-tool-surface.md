# 6. Six tools

- Status: Superseded in part by ADR 18
- Date: 2026-11-16

## Context
Claude learns Heinzel from tool names, schemas and descriptions. MCP tools are deferred behind ToolSearch unless `alwaysLoad` is set (Claude Code 2.1.325).

## Decision
- **Tools:** `dispatch`, `roster`, `status`, `recall`, `follow_up` and `transcript`, seen as `mcp__plugin_heinzel_heinzel__<name>`.
- **`dispatch` inputs:** `brief` (required), `model`, `effort`, `label` and `worktree`.
- **Results:** each gives the task, its status, and a "Then:" line saying what to do next. A finished task's result is the agent's final message.
- **Descriptions:** one to three rule-like sentences each.
- **Loading:** the server has `alwaysLoad: true`.

## Consequences
Renaming a tool or input breaks saved permission rules and needs a new ADR.
