import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RpcPeer } from '../src/shared/jsonrpc.ts'
import { paths } from '../src/shared/paths.ts'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const FAKE_CODEX = join(ROOT, 'test/fake-codex/fake-app-server.ts')

export function tempDir(prefix = 'hz-'): { dir: string; cleanup: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// An environment that points Heinzel at a private home and the fake Codex.
export function testEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    HEINZEL_HOME: join(home, 'hz'),
    CODEX_HOME: join(home, 'codex-home'),
    HEINZEL_CODEX_ARGV: JSON.stringify([process.execPath, FAKE_CODEX]),
    HEINZEL_IDLE_MS: '60000',
    ...extra,
  }
}

export function gitRepo(dir: string) {
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'README.md'), 'test repo\n')
  g('add', '.')
  g('commit', '-q', '-m', 'init')
  return g
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function until<T>(fn: () => T | Promise<T>, timeoutMs = 5000, stepMs = 25): Promise<T> {
  const end = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (err) {
      last = err
    }
    await sleep(stepMs)
  }
  throw new Error(`timed out waiting${last ? `: ${(last as Error).message}` : ''}`)
}

// Starts the relay (the MCP server) as Claude Code would, over stdio.
export function startRelay(env: NodeJS.ProcessEnv, cwd: string): { child: ChildProcess; peer: RpcPeer; stderr: () => string } {
  const child = spawn(process.execPath, [join(ROOT, 'src/server/cli.ts')], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let err = ''
  child.stderr!.on('data', b => { err += b })
  const peer = new RpcPeer(child.stdout!, child.stdin!)
  return { child, peer, stderr: () => err }
}

export const CLAUDE_META = (tasks: boolean) => ({
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'claude-code', title: 'Claude Code', version: '2.1.325' },
  'io.modelcontextprotocol/clientCapabilities': {
    roots: { listChanged: true },
    elicitation: { form: {}, url: {} },
    ...(tasks ? { extensions: { 'io.modelcontextprotocol/tasks': {} } } : {}),
  },
})

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err.code === 'EPERM'
  }
}

// Stops the helper for this environment and waits until it has exited, so
// nothing writes into the temp dir while a test removes it.
export async function stopHelper(env: NodeJS.ProcessEnv) {
  let pid: number
  try {
    pid = Number(readFileSync(paths(env).lock, 'utf8'))
  } catch {
    return
  }
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  await until(() => !alive(pid), 20000, 20)
}

// Stops a relay and waits for its process to exit.
export async function stopRelay(r: { child: ChildProcess }) {
  const c = r.child
  if (c.exitCode !== null || c.signalCode !== null) return
  const gone = new Promise(resolve => c.once('exit', resolve))
  c.kill()
  await gone
}

// Stops relays, then their helper, then removes the temp dir.
export async function teardown(env: NodeJS.ProcessEnv, relays: { child: ChildProcess }[], cleanup: () => void) {
  await Promise.all(relays.map(stopRelay))
  await stopHelper(env)
  cleanup()
}
