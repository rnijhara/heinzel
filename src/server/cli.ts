// Entry point for the relay (bundled to dist/server.mjs, started from .mcp.json).
import { main } from './main.ts'

main().catch(err => {
  process.stderr.write(`heinzel server failed: ${err?.stack ?? err}\n`)
  process.exit(1)
})
