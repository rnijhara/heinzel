# ADR-0014: Name the project Heinzel

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The project starts with Codex but may support other agents later, so the name shouldn't mention any one agent. Plugin tool names take the form `mcp__plugin_<plugin>_<server>__<tool>`, so a long name makes every tool name long. "Codex" is another company's trademark and is already used by an official Claude Code plugin.

## Decision

The project, plugin and MCP server are named `heinzel`, after the Heinzelmännchen of Cologne: house spirits who quietly finished people's work while they slept. That's the idea here: work gets done in the background and is ready when you come back.

- **Plugin:** `heinzel`
- **Tools:** `mcp__plugin_heinzel_heinzel__<tool>`
- **Commands:** `/heinzel` (panel), `/heinzel-setup` (settings)

On 2026-11-16, a GitHub search found no Claude Code project named Heinzel, and only small, unrelated repositories using the name.

## Alternatives considered

- **`codex-cc-threads` or other `codex-…` names:** tied to one agent, long tool names, and confusable with the official Codex plugin.
- **Famulus, Thrall, Shikigami, Familiar:** "familiar" has an everyday meaning, and "shiki" clashes with a popular syntax highlighter.

## Consequences

- The README explains the name in a line.

## History

- 2026-11-16: Accepted.
