# Display mod

Display-only (ADR-0002, ADR-0011). It reads the helper's state files (ADR-0012) and draws the panel and the band. It never writes state and holds no logic.

Claude Code loads the hooks module as TypeScript itself, so this folder isn't bundled. In M4 the module goes here and `hooks/hooks.json` at the plugin root points to it.
