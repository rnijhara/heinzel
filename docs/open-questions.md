# Open questions

Not decided yet. Don't build as if they were. When one is settled, write an ADR and remove it here.

- **Distribution:** how the bundled `dist/` reaches users (committed on a release branch, or built in CI), and where the marketplace lives. Until then `dist/` is git-ignored and users run `npm run build`.
- **Installed-plugin mods:** whether Claude Code loads the display mod from a marketplace-installed plugin the same way it does with `--plugin-dir`. Not yet tried.
- **Worktree clean-up:** a command to remove changed worktrees that piled up (ADR 10).
