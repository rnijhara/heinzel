# 1. Record decisions as ADRs

- Status: Accepted
- Date: 2026-11-16

## Context
Heinzel leans on Claude Code and Codex behaviour that changes often. Without a record, nobody knows which choices are workarounds that can go later.

## Decision
- Every significant decision gets a short record in `docs/adr/`, numbered in order. `AGENTS.md` says when and how.
- Each record names the facts it relies on and the version they were checked on.
- An accepted record is never rewritten. A changed decision gets a new record.

## Consequences
Read `docs/adr/` before changing anything it covers.
