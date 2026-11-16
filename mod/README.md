# Display mod

Display-only (ADR 2, ADR 11). It reads the helper's state files (ADR 12, ADR 19) and draws the panel and the band. The transcript follows the drawing surface's own look and the selected theme (ADR 20, ADR 21). It never writes state and holds no logic.

Claude Code loads `register.tsx` as TypeScript itself (via `hooks/hooks.json`), so this folder isn't bundled. `model.ts` holds the pure logic; `register.test.tsx` runs under `claude plugin test .`.
