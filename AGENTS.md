# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## What this project is

Heinzel is a Claude Code plugin that lets Claude hand work to other coding agents and get woken up when that work is done. Codex is the first agent it supports. The design is meant to stay agent-agnostic so others can be added later.

The plugin has two parts:

- **An MCP server** that holds all the logic: it starts tasks, tracks them, and returns results.
- **A display-only mod** that shows the tasks in Claude Code. Everything works without it.

Version 0.1.0 is built: M1–M5 in `docs/plan.md`. The code is laid out like this:

- `src/server/`: the per-session relay, which is the MCP server. It holds the tools, the server instructions and the tasks extension.
- `src/helper/`: the shared helper. It drives `codex app-server` and writes the state files.
- `src/shared/`: paths, JSON-RPC and the relay-to-helper protocol.
- `src/setup/`: the script behind `/heinzel-setup`.
- `mod/`: the display mod, loaded by `hooks/hooks.json`.
- `test/`: the Node tests (`*.spec.ts`), the fake app-server and the live end-to-end driver.
- `mod/*.test.tsx`: the mod's tests, run by `claude plugin test`.

Run `npm run check` before committing. Mod changes also need `claude plugin validate .` and `claude plugin test .`.

## How we make decisions: ADRs

Every significant decision is recorded as an Architecture Decision Record (ADR) in `docs/adr/`. Read the ADRs before changing anything they cover, and write one before making a decision they should cover.

### When to write an ADR

Write one for a decision that:

- shapes the architecture, a public interface (tool names, inputs, outputs), or how the plugin talks to Claude Code or an agent
- would surprise a new contributor, or was chosen over a reasonable alternative
- depends on a fact that may change, such as a Claude Code or Codex behaviour, a version or a feature flag

Bug fixes, refactors and small implementation choices don't need one.

### How to write one

1. Copy `docs/adr/template.md` to `docs/adr/NNNN-short-title.md`, using the next free four-digit number.
2. Fill in the context, the decision, the alternatives you considered and the consequences. Say what was verified and how (version, test, docs).
3. Set the status to `Proposed` while it's under discussion and `Accepted` once agreed.
4. Add it to the index in `docs/adr/README.md`.

### Changing a decision

Don't rewrite an accepted ADR. Write a new one that supersedes it, and set the old one's status to `Superseded by ADR-NNNN`. Typo fixes, and notes that a verified fact has changed, may be edited in place, with a dated line in the ADR's history.

### Statuses

`Proposed` → `Accepted` → `Superseded by ADR-NNNN` or `Deprecated`.

## Conventions

- Keep the plugin's logic out of the mod. The mod reads state and draws it, nothing more (ADR-0002).
- Tool descriptions and server instructions are part of the product. Change them with the same care as code, and keep them short and rule-like (ADR-0007).
- Version-specific facts about Claude Code or Codex go in the ADR that depends on them, with the version they were checked on.
