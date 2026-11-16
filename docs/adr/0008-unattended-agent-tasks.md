# ADR-0008: Agent tasks run unattended and get only their brief

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

A dispatched task should behave like a subagent: it gets a self-contained brief, does the work without supervision, and reports back. It never stops to ask the user anything. If it can't finish, it says why in its final message, and the parent conversation decides what to do.

Checked on Codex CLI 0.167.2:

- `approvals_reviewer` accepts `user`, `auto_review` or `guardian_subagent`. With `auto_review`, Codex has its own reviewer decide approval requests instead of asking a person.
- In the default collaboration mode Codex can't ask the user questions (`default_mode_request_user_input` is an under-development feature, off by default). The app-server can still send `item/tool/requestUserInput` and `mcpServer/elicitation/request`.

## Decision

- **Context:** the agent gets only `brief`, plus a short set of child rules. It gets none of the parent conversation's history.
- **Child rules,** sent as developer instructions on the thread:
  - do the work yourself; don't hand it off to other agents
  - don't ask questions; make reasonable assumptions and say what they were
  - finish with a clear final message: what changed, what was verified, and anything blocked or needing a decision
- **Approvals:** run with `approval_policy = "on-request"`, `approvals_reviewer = "auto_review"` and sandbox `workspace-write`. No approval ever reaches the user.
- **Input requests:** the helper declines every `mcpServer/elicitation/request` and every `item/tool/requestUserInput` straight away, so the agent carries on or reports back.
- **No "needs answer" state:** a task is running, done, failed or cancelled. Nothing else.

## Alternatives considered

- **Passing the parent's history or a summary:** costs tokens, leaks unrelated context, and makes the result depend on hidden state. A good brief is better.
- **Showing approvals and questions to the user:** possible later through MCP task `input_required` and the mod, but it would make tasks interactive, which isn't what we want now.

## Consequences

- Brief quality decides result quality. The server instructions (ADR-0007) push Claude to write briefs that stand alone.
- Some tasks will end blocked and need a `follow_up`. That's expected.
- Bringing approvals to the user later needs a new ADR.

## History

- 2026-11-16: Accepted.
