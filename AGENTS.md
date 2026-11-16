# AGENTS.md

Heinzel is a Claude Code plugin that hands work to other coding agents (Codex first) and wakes Claude when it's done. It has an MCP server that holds the logic, and a display-only mod that works without it.

## Layout
- `src/server/`: the per-session relay, which is the MCP server. It holds the tools, the server instructions and the tasks extension.
- `src/helper/`: the shared helper. It drives `codex app-server` and writes the state files.
- `src/shared/`: paths, JSON-RPC, and the relay-to-helper protocol.
- `src/setup/`: the script behind `/heinzel-setup` (`commands/heinzel-setup.md`).
- `mod/`: the display mod, loaded by `hooks/hooks.json`. It reads state and draws it, nothing more.
- `test/`: Node tests (`*.spec.ts`), the fake app-server, and live runs (`test/live/`).
- `protocol/codex/<version>/`: Codex's generated schema and types. Never edit these by hand.

## Checks
- `npm run check`: types, tests and protocol drift.
- For mod changes, also `claude plugin validate .` and `claude plugin test .`.
- Live runs (`test/live/`) cost tokens. Run them only when asked, or for a new Claude Code or Codex release.

## Decisions (ADRs in `docs/adr/`)
- **ADRs are binding.** Check `docs/adr/README.md` before changing anything an ADR covers. If the code and an ADR disagree, stop and ask.
- **When to write one:** a choice that is hard to reverse, changes a public interface (tool names, inputs, outputs), or depends on Claude Code or Codex behaviour. Also any choice that would leave a future reader asking "why?". Routine code choices don't need one.
- **Format:** the next free number, `docs/adr/NNNN-short-title.md`, following `template.md`: Status, Date, Context, Decision, Consequences.
  - One screen at most, in plain words.
  - Name any Claude Code or Codex fact the decision relies on, with the version checked.
  - Add a row to `docs/adr/README.md`.
- **Never rewrite an accepted ADR.** To change one, write a new ADR with a `Supersedes: ADR N` line, and mark the old one "Superseded by ADR M" (or "in part") in the file and in the README. Status is the only edit allowed to an accepted ADR.
- **Undecided items go in `docs/open-questions.md`,** not in an ADR. Don't build as if they were decided.
- **The ADR goes in the same commit as the code it describes.**

## Commits and branches
- Conventional Commits, for example `fix(helper): …`. The body says why.
- Branches: `<type>/<short-summary>`, for example `fix/helper-lock-race`.

## Writing
- Be concise everywhere: ADRs, docs, comments, tool text.
- Say it once, in plain words. Cut anything a reader wouldn't miss.
- No plans, milestone names or status logs in the repo. Git history holds what happened.
- Tool descriptions and server instructions are product text. Keep them short and rule-like, and try changes in a real session.
- Never mention other orchestration products in the repo.
