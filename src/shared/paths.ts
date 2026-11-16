// Where Heinzel keeps its files (ADR 17).
//
//   $HEINZEL_HOME (default ~/.heinzel)/
//     <account>/            one folder per agent account, e.g. codex-1a2b3c4d5e
//       account.json        which agent and home this folder belongs to
//       tasks.json          the task index the mod reads (ADR 12)
//       tasks/<id>.jsonl    one transcript per task
//       helper.lock         held by the running helper (ADR 4)
//       helper.sock         the helper's socket (moved to the temp dir if the path is too long)
//       helper.log          the helper's log
//     worktrees/<repo>-<hash>/<task-id>   worktrees for `worktree: true` (ADR 10)

import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export type Env = Record<string, string | undefined>

export interface Paths {
  home: string
  agent: 'codex'
  agentHome: string
  account: string
  dir: string
  accountFile: string
  tasksIndex: string
  tasksDir: string
  lock: string
  socket: string
  log: string
  worktrees: string
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

export function heinzelHome(env: Env = process.env): string {
  return resolve(env.HEINZEL_HOME || join(homedir(), '.heinzel'))
}

export function codexHome(env: Env = process.env): string {
  return resolve(env.CODEX_HOME || join(homedir(), '.codex'))
}

// Unix socket paths are limited to about 104 bytes on macOS.
const MAX_SOCKET_PATH = 100

export function paths(env: Env = process.env): Paths {
  const home = heinzelHome(env)
  const agentHome = codexHome(env)
  const account = `codex-${hash(agentHome).slice(0, 10)}`
  const dir = join(home, account)
  let socket = join(dir, 'helper.sock')
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0
    socket = join(tmpdir(), `heinzel-${uid}-${hash(dir).slice(0, 12)}.sock`)
  }
  return {
    home,
    agent: 'codex',
    agentHome,
    account,
    dir,
    accountFile: join(dir, 'account.json'),
    tasksIndex: join(dir, 'tasks.json'),
    tasksDir: join(dir, 'tasks'),
    lock: join(dir, 'helper.lock'),
    socket,
    log: join(dir, 'helper.log'),
    worktrees: join(home, 'worktrees'),
  }
}
