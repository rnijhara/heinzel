// Heinzel's orchestration rules, sent as the MCP server's instructions so they
// sit in Claude's system prompt (ADR 7). Product text: change it with care,
// keep it short and rule-like, and test changes in real sessions.

export const INSTRUCTIONS = `Heinzel hands self-contained tasks to other coding agents (Codex today) and wakes you when each one finishes.

When to use it:
- Ordinary work needs no Heinzel. For Claude subagents, use your own Agent tool.
- Use dispatch when the user asks for another agent or model, when the work should run on another agent, or when it needs its own git worktree (worktree: true).

Models:
- Call roster once before your first dispatch in a conversation.
- Use the model and effort the user asked for; otherwise leave them out to get the user's defaults.
- Never switch agent or model unless the user asked, and never fall back to another one after a failure.

Briefs:
- The agent sees only the brief: none of this conversation. Write it to stand alone: the goal, the relevant files and facts, constraints, and what done looks like.
- Never put secrets in a brief.

Waiting:
- After dispatch or follow_up, carry on with other work or end your turn. Completion wakes you with the result.
- Never poll: no status on a running task, no sleeps, no watchers.
- Give every dispatch a short, distinct label. While it runs in the background you have only Claude Code's background task id, not Heinzel's id: refer to the task by its label, and cancel it with TaskStop on the background task or recall with the label.

Follow-ups:
- Use follow_up to continue the same piece of work on the same thread.
- Every new review or re-check is a new dispatch. Fix small review findings yourself.

Cleanup: recall a task (by id or label) that was replaced or is no longer needed.

Questions: dispatched agents never ask the user anything. If a result says the agent is blocked or needs a decision, ask the user, or send a follow_up with what it needs.

Reporting: refer to tasks by their label, not their id.`
