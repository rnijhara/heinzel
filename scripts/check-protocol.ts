// Protocol drift check (ADR-0016): regenerates Codex's JSON Schema and
// TypeScript types from the installed Codex CLI and compares them with the
// copy checked in under protocol/codex/<version>/. Exits non-zero on any
// difference, or when the installed version has no folder yet.
//
// Usage: node scripts/check-protocol.ts [--codex <path>] [--update]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const codex = args.includes('--codex') ? args[args.indexOf('--codex') + 1]! : 'codex'
const update = args.includes('--update')

const versionOut = execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim()
const version = versionOut.match(/(\d+\.\d+\.\d+\S*)/)?.[1]
if (!version) {
  console.error(`Couldn't read a version from "${versionOut}".`)
  process.exit(2)
}

const tmp = mkdtempSync(join(tmpdir(), 'hz-protocol-'))
try {
  execFileSync(codex, ['app-server', 'generate-json-schema', '--out', join(tmp, 'schema')], { stdio: 'ignore' })
  execFileSync(codex, ['app-server', 'generate-ts', '--out', join(tmp, 'ts')], { stdio: 'ignore' })
  const target = join(root, 'protocol/codex', version)

  if (update) {
    rmSync(target, { recursive: true, force: true })
    cpSync(tmp, target, { recursive: true })
    console.log(`Wrote protocol/codex/${version}. Point src/helper at it and run the tests.`)
    process.exit(0)
  }
  if (!existsSync(target)) {
    console.error(`Codex ${version} has no protocol/codex/${version} folder. Run with --update to add it, then review what changed.`)
    process.exit(1)
  }

  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
  const fresh = new Map(files(tmp).map(f => [relative(tmp, f), f]))
  const kept = new Map(files(target).map(f => [relative(target, f), f]))
  const diffs: string[] = []
  for (const [rel, f] of fresh) {
    const k = kept.get(rel)
    if (!k) diffs.push(`added:   ${rel}`)
    else if (!readFileSync(k).equals(readFileSync(f))) diffs.push(`changed: ${rel}`)
  }
  for (const rel of kept.keys()) if (!fresh.has(rel)) diffs.push(`removed: ${rel}`)

  if (diffs.length) {
    console.error(`Codex ${version}'s protocol differs from protocol/codex/${version} (${diffs.length} files):`)
    for (const d of diffs.slice(0, 40)) console.error(`  ${d}`)
    if (diffs.length > 40) console.error(`  … and ${diffs.length - 40} more`)
    process.exit(1)
  }
  console.log(`Codex ${version}: protocol matches protocol/codex/${version} (${fresh.size} files).`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
