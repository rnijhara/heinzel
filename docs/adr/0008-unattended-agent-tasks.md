# 8. Tasks run unattended on the brief alone

- Status: Accepted
- Date: 2026-11-16

## Context
A dispatched task should act like a subagent: do the work and report back, without asking anyone. On Codex 0.167.2, `approvals_reviewer = "auto_review"` lets Codex review its own approvals. The app-server can still send input and elicitation requests.

## Decision
- The agent gets only the brief, plus child rules sent as developer instructions:
  - do the work yourself;
  - don't ask questions;
  - end with what changed, what was verified, and what's blocked.
- Threads use `on-request` approvals, `auto_review` and a `workspace-write` sandbox.
- The helper declines any approval, input or elicitation request that reaches it.
- Statuses are only running, done, failed and cancelled.

## Consequences
Result quality depends on the brief. Blocked tasks end with a reason, and Claude follows up.
