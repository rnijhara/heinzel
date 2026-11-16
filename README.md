# Heinzel

Hand work from Claude Code to other coding agents, and get woken up when it's done. Codex first.

<!-- TODO: add the wizard meme here (with Codex in the caption). -->

> **Status: design phase.** Nothing is built yet. The decisions so far are in [docs/adr](docs/adr/README.md), and the build order is in [docs/plan.md](docs/plan.md).

Named after the Heinzelmännchen of Cologne, house spirits who quietly finished people's work while they slept.

## What it does

- **Dispatch:** Claude sends a self-contained task to Codex and keeps working. There's no polling: when the task finishes, Claude is woken with the result.
- **Follow up or cancel:** Claude can send more instructions to the same Codex thread, or cancel a task it no longer needs.
- **Pick a model:** Claude can see which Codex models and reasoning efforts are available, and uses the one you ask for.
- **Isolate:** a task can run in its own git worktree, so parallel tasks don't collide.
- **Watch:** an optional panel lists every task and shows its full transcript, and a band above the input shows what's running.

Tasks run unattended. Codex's automatic review handles approvals, and a task never stops to ask you a question: if it gets stuck, it says why, and Claude takes it from there.

## Planned setup

1. Install the plugin. It needs the Codex CLI installed and signed in.
2. Run `/heinzel-setup`, or add this to `~/.claude/settings.json` yourself:

   ```json
   {
     "env": {
       "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "1000",
       "CLAUDE_AUTO_BACKGROUND_TASKS": "1"
     }
   }
   ```

   These make Claude Code move a dispatched task to the background after about a second. They apply to every MCP server, so any MCP call that takes longer than a second will also finish in the background. Once Claude Code turns on MCP tasks for your sessions, Heinzel uses them automatically, and you can remove these settings. [ADR-0005](docs/adr/0005-background-execution-and-wake.md) explains why.
3. Open the panel with `/heinzel`.

## Tools

| Tool | What it does |
| --- | --- |
| `dispatch` | Start a task |
| `roster` | List agents and models |
| `status` | Check a task's state |
| `recall` | Cancel a task |
| `follow_up` | Continue a task's thread |
| `transcript` | Read a task's thread |
