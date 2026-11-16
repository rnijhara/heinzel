// /heinzel-setup's helper script (M5, ADR-0005). Bundled to dist/setup.mjs.
//
//   node setup.mjs check [--settings <file>]   report prerequisites and settings (JSON)
//   node setup.mjs apply [--settings <file>]   add the two backgrounding settings
//
// `apply` only adds or updates the two keys under "env", keeps everything else
// in the file, and writes a backup first. The slash command asks the user
// before it runs `apply`.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const SETTINGS_ENV = {
  CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1000',
  CLAUDE_AUTO_BACKGROUND_TASKS: '1',
} as const

export const MIN_NODE = [22, 18] as const

export interface CheckReport {
  node: { version: string; ok: boolean }
  codex: { installed: boolean; version: string | null; signedIn: boolean; detail: string }
  settings: { file: string; exists: boolean; current: Record<string, string | null>; ok: boolean }
  ready: boolean
}

function nodeOk(version: string) {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number)
  return maj! > MIN_NODE[0] || (maj === MIN_NODE[0] && min! >= MIN_NODE[1])
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim() }
  } catch (err: any) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message }
  }
}

export function readSettings(file: string): Record<string, any> {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8')
  if (!text.trim()) return {}
  return JSON.parse(text)
}

export function check(settingsFile: string, codexBin = 'codex'): CheckReport {
  const version = run(codexBin, ['--version'])
  const login = version.ok ? run(codexBin, ['login', 'status']) : { ok: false, out: 'Codex CLI not found on PATH.' }
  let current: Record<string, string | null> = {}
  let exists = false
  try {
    exists = existsSync(settingsFile)
    const env = readSettings(settingsFile).env ?? {}
    current = Object.fromEntries(Object.keys(SETTINGS_ENV).map(k => [k, env[k] ?? null]))
  } catch {
    current = Object.fromEntries(Object.keys(SETTINGS_ENV).map(k => [k, null]))
  }
  const settingsOk = Object.entries(SETTINGS_ENV).every(([k, v]) => current[k] === v)
  const report: CheckReport = {
    node: { version: process.version, ok: nodeOk(process.version) },
    codex: {
      installed: version.ok,
      version: version.ok ? (version.out.match(/(\d+\.\d+\.\d+\S*)/)?.[1] ?? version.out) : null,
      signedIn: login.ok && !/not logged in/i.test(login.out),
      detail: login.out.split('\n')[0] ?? '',
    },
    settings: { file: settingsFile, exists, current, ok: settingsOk },
    ready: false,
  }
  report.ready = report.node.ok && report.codex.installed && report.codex.signedIn && settingsOk
  return report
}

// Adds the two keys under "env". Returns what changed.
export function apply(settingsFile: string): { changed: string[]; backup: string | null } {
  const settings = readSettings(settingsFile)
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${settingsFile} isn't a JSON object.`)
  const env = { ...(settings.env ?? {}) }
  const changed: string[] = []
  for (const [k, v] of Object.entries(SETTINGS_ENV)) {
    if (env[k] !== v) {
      changed.push(`${k}: ${env[k] === undefined ? '(unset)' : JSON.stringify(env[k])} -> "${v}"`)
      env[k] = v
    }
  }
  if (!changed.length) return { changed, backup: null }
  let backup: string | null = null
  if (existsSync(settingsFile)) {
    backup = `${settingsFile}.heinzel-backup`
    copyFileSync(settingsFile, backup)
  } else {
    mkdirSync(dirname(settingsFile), { recursive: true })
  }
  const tmp = `${settingsFile}.heinzel-tmp`
  writeFileSync(tmp, JSON.stringify({ ...settings, env }, null, 2) + '\n')
  renameSync(tmp, settingsFile)
  return { changed, backup }
}

function main(argv: string[]) {
  const cmd = argv[0]
  const i = argv.indexOf('--settings')
  const settingsFile = i >= 0 ? argv[i + 1]! : join(homedir(), '.claude', 'settings.json')
  if (cmd === 'check') {
    process.stdout.write(JSON.stringify(check(settingsFile), null, 2) + '\n')
    return
  }
  if (cmd === 'apply') {
    const res = apply(settingsFile)
    process.stdout.write(JSON.stringify({ file: settingsFile, ...res, note: res.changed.length ? 'Restart Claude Code for the settings to take effect.' : 'Already set; nothing changed.' }, null, 2) + '\n')
    return
  }
  process.stderr.write('usage: setup.mjs check|apply [--settings <file>]\n')
  process.exit(2)
}

const isEntry = process.argv[1] && (process.argv[1].endsWith('setup.mjs') || process.argv[1].endsWith('setup/cli.ts'))
if (isEntry) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`heinzel setup: ${(err as Error).message}\n`)
    process.exit(1)
  }
}
