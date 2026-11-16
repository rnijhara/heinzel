# ADR-0009: Model awareness through `roster`

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Claude has to know which agent models exist to pick one, or to honour a user's request for a specific model. Listing every model in every session's prompt wastes tokens, and the list changes with agent releases.

Checked on Codex CLI 0.167.2:

- `model/list` returns each model's id, whether it's the default, its supported reasoning efforts and its default effort.
- `config/read` returns the user's effective configuration.
- Codex's own `isDefault` model can differ from the one in the user's config, so the effective default must come from `config/read`.

## Decision

- **`roster`** returns, per agent, the models from `model/list` with their supported and default efforts, and marks the effective default from `config/read`.
- **Caching:** the helper caches the result and refreshes it when the agent's version or config changes.
- **The server instructions** say to call `roster` once before the first dispatch in a conversation (ADR-0007). They don't list the models.
- **Validation:** `dispatch` rejects an unknown `model` or an unsupported `effort`, and its error includes the valid values.

## Alternatives considered

- **Listing the models in the server instructions:** always visible, but it costs tokens in every prompt and goes stale.
- **No validation:** typos would only fail later, inside the agent.

## Consequences

- One extra tool call per conversation that dispatches.
- New agent models appear without a Heinzel release.

## History

- 2026-11-16: Accepted.
