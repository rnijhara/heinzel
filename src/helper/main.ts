// The shared helper: one per agent account, serving every session's relay over
// a local socket (ADR 4). Started on demand by the first relay that needs it.

import { appendFileSync, closeSync, openSync, readFileSync, rmSync, statSync, truncateSync, writeSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { RpcError, RpcPeer, ErrorCodes } from '../shared/jsonrpc.ts'
import { paths as resolvePaths, type Paths } from '../shared/paths.ts'
import { HELPER_PROTOCOL, VERSION, type HelloParams, type HelloResult, type TaskRecord } from '../shared/protocol.ts'
import { codexArgv } from './codex.ts'
import { DEFAULT_RETENTION_DAYS, StateStore, ensureDir } from './state.ts'
import { TaskManager } from './tasks.ts'

// The helper exits after this long with no relays connected and no tasks
// running (ADR 17).
export const DEFAULT_IDLE_MS = 10 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000
const LOG_LIMIT = 1024 * 1024

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err.code === 'EPERM'
  }
}

// Takes the lock file, or returns false when a live helper already holds it.
export function acquireLock(file: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600)
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return true
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err
      const pid = Number(readFileSync(file, 'utf8').trim())
      if (pid && pidAlive(pid)) return false
      rmSync(file, { force: true })
    }
  }
  return false
}

export interface HelperOptions {
  env?: NodeJS.ProcessEnv
  idleMs?: number
  retentionDays?: number
}

export async function runHelper(opts: HelperOptions = {}) {
  const env = opts.env ?? process.env
  const p: Paths = resolvePaths(env)
  ensureDir(p.home)
  ensureDir(p.dir)

  const log = (line: string) => {
    try {
      if ((statSync(p.log, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT) truncateSync(p.log, 0)
      appendFileSync(p.log, `${new Date().toISOString()} [${process.pid}] ${line}\n`, { mode: 0o600 })
    } catch { /* logging must never take the helper down */ }
  }

  if (!acquireLock(p.lock)) {
    log('another helper holds the lock; exiting')
    return
  }

  const idleMs = opts.idleMs ?? (Number(env.HEINZEL_IDLE_MS) || DEFAULT_IDLE_MS)
  const retentionDays = opts.retentionDays ?? (Number(env.HEINZEL_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS)
  const store = new StateStore(p, retentionDays)
  const orphaned = store.load()
  if (orphaned.length) log(`marked ${orphaned.length} task(s) from a previous helper as failed`)
  store.prune()

  const tasks = new TaskManager(store, { codexArgv: codexArgv(env), env, log, worktreesDir: p.worktrees })
  const relays = new Map<RpcPeer, { sessionId: string | null }>()
  let idleTimer: NodeJS.Timeout | null = null
  let stopping = false

  const checkIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (relays.size === 0 && tasks.runningCount() === 0) {
      idleTimer = setTimeout(() => {
        if (relays.size === 0 && tasks.runningCount() === 0) void stop('idle')
      }, idleMs)
    }
  }

  // Sends a task's events to the relays of the session that owns it (ADR 4).
  const route = (task: TaskRecord, method: string, params: unknown) => {
    for (const [peer, info] of relays) {
      if (task.sessionId && info.sessionId === task.sessionId) peer.notify(method, params)
    }
  }
  tasks.on('progress', (task: TaskRecord, line: string) => route(task, 'task/progress', { taskId: task.id, line }))
  tasks.on('finished', (task: TaskRecord) => {
    route(task, 'task/finished', { task })
    checkIdle()
  })

  const server = createServer((socket: Socket) => {
    const peer = new RpcPeer(socket, socket)
    relays.set(peer, { sessionId: null })
    checkIdle()
    peer.handlers.onRequest = async (method, params: any) => {
      const info = relays.get(peer)!
      switch (method) {
        case 'hello': {
          const h = params as HelloParams
          info.sessionId = h.sessionId
          log(`relay connected: session ${h.sessionId}, version ${h.version}, pid ${h.pid}`)
          return { version: VERSION, protocol: HELPER_PROTOCOL, pid: process.pid, account: p.account, running: tasks.runningCount() } satisfies HelloResult
        }
        case 'dispatch': {
          const t = await tasks.dispatch({ ...params, sessionId: params.sessionId ?? info.sessionId })
          checkIdle()
          return t
        }
        case 'followUp': {
          const t = await tasks.followUp({ ...params, sessionId: params.sessionId ?? info.sessionId })
          checkIdle()
          return t
        }
        case 'wait': return tasks.wait(params.taskId)
        case 'recall': return tasks.recall(params.taskId, params.sessionId ?? info.sessionId ?? undefined)
        case 'status': return tasks.status(params.taskId, params.sessionId ?? info.sessionId ?? undefined)
        case 'transcript': return tasks.transcript(params.taskId, params.tail, params.sessionId ?? info.sessionId ?? undefined)
        case 'roster': return tasks.roster()
        case 'list': return tasks.list(params?.sessionId)
        case 'shutdown': {
          const running = tasks.runningCount()
          if (running && !params?.force) return { stopping: false, running }
          setImmediate(() => void stop(`asked by a relay (${params?.reason ?? 'no reason'})`))
          return { stopping: true, running }
        }
        default:
          throw new RpcError(ErrorCodes.MethodNotFound, `unknown method ${method}`)
      }
    }
    peer.on('close', () => {
      relays.delete(peer)
      checkIdle()
    })
    socket.on('error', () => peer.close())
  })

  rmSync(p.socket, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(p.socket, () => resolve())
  })
  log(`helper ${VERSION} listening on ${p.socket} (idle exit after ${idleMs} ms, keep finished tasks ${retentionDays} days)`)
  const pruner = setInterval(() => store.prune(), PRUNE_EVERY_MS)
  pruner.unref()
  checkIdle()

  // Runs one shutdown step; a failure (say, the state dir was deleted) is
  // logged and never stops the helper from exiting.
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn()
    } catch (err) {
      log(`shutdown step ${name} failed: ${(err as Error).message}`)
    }
  }

  const stop = async (why: string) => {
    if (stopping) return
    stopping = true
    log(`stopping: ${why}`)
    clearInterval(pruner)
    if (idleTimer) clearTimeout(idleTimer)
    // Exit even if a step hangs.
    setTimeout(() => process.exit(1), 30_000).unref()
    for (const t of tasks.list()) if (t.status === 'running') await step(`recall ${t.id}`, () => tasks.recall(t.id))
    await step('codex', () => tasks.shutdown())
    await step('state', () => store.close())
    await step('relays', () => { for (const peer of relays.keys()) peer.close() })
    await step('server', () => server.close())
    log('stopped')
    await step('socket', () => rmSync(p.socket, { force: true }))
    // Last: a missing lock means this helper has finished writing.
    await step('lock', () => rmSync(p.lock, { force: true }))
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('uncaughtException', err => {
    log(`uncaught: ${err.stack ?? err}`)
  })
  process.on('unhandledRejection', err => {
    log(`unhandled rejection: ${(err as Error)?.stack ?? err}`)
  })
}
