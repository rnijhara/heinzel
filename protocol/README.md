# Codex protocol

`codex/<version>/` holds the JSON Schema and TypeScript types of the `codex app-server` protocol, as the Codex CLI generates them (`codex app-server generate-json-schema` and `generate-ts`).

- Never edit these files by hand.
- `npm run check:protocol` compares them with the installed Codex CLI.
- `node scripts/check-protocol.ts --update` adds the folder for a new Codex version.

The files are output of the [Codex CLI](https://github.com/openai/codex), which OpenAI publishes under the Apache License 2.0. The rest of this repository is MIT.
