# 9. Models come from `roster`

- Status: Accepted
- Date: 2026-11-16

## Context
Claude needs the available models to honour a request for one. On Codex 0.167.2, `model/list` gives models and their efforts. The effective default comes from `config/read`, not from Codex's `isDefault`.

## Decision
- `roster` lists each agent's models, their efforts, and the user's effective default. The helper caches it per Codex version and config.
- The instructions say to call it once per conversation; models aren't listed in the prompt.
- `dispatch` rejects an unknown model or effort, and lists the valid values.

## Consequences
New Codex models appear without a Heinzel release.
