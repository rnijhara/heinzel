# ADR-0012: Task state in files the mod watches

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The display mod (ADR-0011) has to see tasks from the shared helper (ADR-0004) without sharing its logic or holding a connection to it. A mod can read and watch files.

## Decision

- **The helper writes task state** under a per-user Heinzel data directory. The exact path is decided at implementation, once we've checked what a mod is allowed to read.
  - `tasks.json`: an index of tasks (id, label, agent, model, status, Claude session, timestamps, worktree).
  - `tasks/<id>.jsonl`: one append-only transcript per task (brief, messages, commands, edits, result).
- **Writes are atomic** for the index (write a temporary file, then rename) and append-only for transcripts.
- **The mod watches these files** and redraws on change. It never writes to them.
- **Retention:** the helper prunes finished tasks after a retention period that can be configured.

## Alternatives considered

- **The mod querying the helper over its socket:** the mod would need its own client logic, and couldn't hold a long-lived connection (ADR-0002).
- **The mod reading the agent's own session logs:** ties the mod to each agent's internal format.

## Consequences

- The file format is an interface between the helper and the mod. Changing it needs a version field and care.
- The files hold briefs and transcripts, so the directory is created readable only by the user.

## History

- 2026-11-16: Accepted.
