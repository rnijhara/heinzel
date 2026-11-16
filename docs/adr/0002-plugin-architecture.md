# 2. MCP server for logic, mod for display

- Status: Accepted
- Date: 2026-11-16

## Context
On Claude Code 2.1.325:
- An MCP call can run in the background and wake Claude when it ends.
- A mod can't hold a long-lived connection to another process, and can't wake Claude mid-turn.

## Decision
- One plugin with two parts:
  - an MCP server that holds all the logic;
  - a display-only mod that reads state and never changes it.
- No skill: the tool descriptions and server instructions carry the rules.

## Consequences
Everything works without the mod. Background behaviour depends on Claude Code settings until MCP tasks are generally available (ADR 5).
