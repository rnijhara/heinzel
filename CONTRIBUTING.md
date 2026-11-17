# Contributing

Issues and pull requests are welcome. For anything larger than a small fix, open an issue first so we can agree on the approach.

## Set up

```bash
npm install
```

```bash
npm run build
```

```bash
claude --plugin-dir .
```

## Before you open a pull request

- **Checks pass:** `npm run check` runs the type check, the tests and the protocol drift check. The drift check needs the Codex CLI installed, but no account and no tokens.
- **Mod changes:** also run `claude plugin validate .` and `claude plugin test .`.
- **Live runs** (`test/live/`) spend tokens. They aren't needed for a pull request.
- **Decisions:** the ADRs in [docs/adr](docs/adr/README.md) are binding. A change to a tool's name, inputs or outputs, or anything else an ADR covers, needs a new ADR in the same commit.
- **Commits:** Conventional Commits, for example `fix(helper): …`, with a body that says why.

[AGENTS.md](AGENTS.md) has the full rules, for people and for coding agents alike.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Please don't open a public issue for one.
