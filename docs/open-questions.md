# Open questions

Not decided yet. Don't build as if they were. When one is settled, write an ADR and remove it here.

- **Distribution:** how the bundled `dist/` reaches users (committed on a release branch, or built in CI), and where the marketplace lives. Until then `dist/` is git-ignored and users run `npm run build`.
- **Installed-plugin mods:** whether Claude Code loads the display mod from a marketplace-installed plugin the same way it does with `--plugin-dir`. It does from a local marketplace (Claude Code 2.1.325). Not yet tried from a git marketplace.
- **Worktree clean-up:** a command to remove changed worktrees that piled up (ADR 10).
- **Unconfirmed recall:** if Codex doesn't end the turn within 15 s of `turn/interrupt`, recall marks the task cancelled although Codex may still be running it. Check real interrupt timing, then decide whether to keep the task running, retry, or restart the app-server. Recall before `turn/start` returns has the same gap.
