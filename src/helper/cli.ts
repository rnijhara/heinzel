// Entry point for the helper process (bundled to dist/helper.mjs).
import { runHelper } from './main.ts'

runHelper().catch(err => {
  process.stderr.write(`heinzel helper failed: ${err?.stack ?? err}\n`)
  process.exit(1)
})
