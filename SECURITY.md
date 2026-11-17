# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue.

Say what you found, how to reproduce it, and which Heinzel, Claude Code and Codex versions you used.

## What to know before you run it

- **Tasks run unattended.** Heinzel starts Codex with write access to the working directory and no approval prompts ([ADR 8](docs/adr/0008-unattended-agent-tasks.md)). Run it only in repositories where you'd let Codex work on its own.
- **Briefs leave your machine.** A brief goes to Codex, and so to OpenAI. Don't put secrets in one.
- **State is local.** Task records and transcripts are kept in `~/.heinzel`, readable only by your user.

Only the latest release gets fixes.
