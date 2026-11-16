// Bundles the relay and the helper into single files under dist/ (ADR-0015).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

await build({
  absWorkingDir: root,
  entryPoints: { server: 'src/server/cli.ts', helper: 'src/helper/cli.ts', setup: 'src/setup/cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // Some dependencies still use require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __heinzelRequire } from 'node:module'; const require = __heinzelRequire(import.meta.url);" },
})
