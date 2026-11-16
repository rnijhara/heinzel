# ADR-0001: Record decisions as ADRs

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Heinzel depends on behaviour in Claude Code and Codex that changes quickly: feature flags, environment variables, protocol revisions. Many of our choices are workarounds for how things are today. Without a record, nobody will know which parts can go once the platform catches up.

## Decision

We record every significant decision as an Architecture Decision Record in `docs/adr/`, following the process in `AGENTS.md`. Each ADR states the facts it relies on and how they were verified, so it can be revisited when those facts change.

## Alternatives considered

- **A single design doc:** easier to read once, but it hides when and why each choice was made, and it drifts out of date silently.
- **Decisions in commit messages or issues only:** hard to find, and it mixes decisions with implementation detail.

## Consequences

- Contributors read the ADRs before changing anything they cover.
- Changing a decision means writing a new ADR that supersedes the old one.

## History

- 2026-11-16: Accepted.
