# Build plan

Milestones in build order. Each one ends with something that works on its own and passes its tests (ADR-0016). This is a plan, not a decision record: update it as the work moves. Decisions it turns up get an ADR.

## M1: Helper, app-server and `dispatch`

- **Scaffolding:** `package.json`, `tsconfig`, the esbuild bundle and `node:test` (ADR-0015).
- **Protocol:** checked-in Codex 0.167.2 schema and generated types, plus the drift check (ADR-0016).
- **Helper:** starts once under a lock, listens on a local socket, owns one `codex app-server`, exits when idle, and does the version handshake (ADR-0004).
- **Unattended tasks:** child rules, `auto_review` approvals, and declined input requests (ADR-0008).
- **Relay:** serves `dispatch` as a plain call that blocks until the agent's turn ends, with progress notifications (ADR-0005, ADR-0013).
- **Missing settings:** a dispatch that isn't moved to the background says what to add.
- **Done when** a live run shows a dispatch moving to the background after about a second and Claude being woken with Codex's final message.
- **Decide here:** the helper's idle timeout.

## M2: The rest of the tools

- **The other five tools:**
  - `roster`, with caching and the effective default (ADR-0009)
  - `status`
  - `recall`, which interrupts the turn
  - `follow_up`, on the same thread
  - `transcript`
- **Inputs:** validation of `model` and `effort` in `dispatch`. `worktree: true` support (ADR-0010).
- **Files:** state files, `tasks.json` and `tasks/<id>.jsonl`, with atomic writes and pruning (ADR-0012).
- **Text:** the server instructions and every tool description, reviewed as product text (ADR-0007).
- **Done when** all six tools pass the layer 1–3 tests and the live scenarios in ADR-0016.
- **Decide here:**
  - the state directory path (check what a mod may read first)
  - how long finished tasks are kept
  - the default label when none is given

## M3: MCP tasks

- **Tasks extension:**
  - advertise the extension on `server/discover`
  - answer task-capable `dispatch` and `follow_up` calls with a task
  - serve `tasks/get` and `tasks/cancel` (ADR-0005)
- **SDK:** find out whether SDK v2 lets a handler return a task result, or whether the transport has to intercept those messages (ADR-0015).
- **Done when** the integration tests pass in both modes and a manual interactive-terminal run shows a task-mode dispatch being woken.

## M4: Display mod

- **Panel:** `/heinzel` opens the side panel, which lists the tasks. Clicking one shows its transcript (ADR-0011).
- **Band:** the band above the input while tasks are running.
- **Reads only:** the mod reads the state files and nothing else (ADR-0012).
- **Done when** `claude plugin validate` and `claude plugin test` pass, and the panel and band show live tasks on desktop and in the terminal.

## M5: `/heinzel-setup`

- **Checks:** Node 22 or later, the Codex CLI, and Codex sign-in.
- **Settings:** shows the two backgrounding settings and what they affect, and writes them to `~/.claude/settings.json` only once the user agrees (ADR-0005).
- **Done when** a fresh machine goes from install to a working dispatch by following the setup alone.

## Not yet planned

- **Packaging:** how the bundled `dist/` reaches users, and a marketplace entry.
- **Worktrees:** a cleanup command for worktrees that pile up (ADR-0010).
