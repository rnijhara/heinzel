// State files (ADR 12), the lock (ADR 4) and the relay's version
// handshake with an older helper.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { describe, test } from 'node:test'
import { RpcPeer } from '../src/shared/jsonrpc.ts'
import { paths } from '../src/shared/paths.ts'
import { HELPER_PROTOCOL, STATE_FORMAT, VERSION, type TaskRecord } from '../src/shared/protocol.ts'
import { StateStore, readIndex } from '../src/helper/state.ts'
import { acquireLock } from '../src/helper/main.ts'
import { HelperClient } from '../src/server/helper-client.ts'
import { tempDir, testEnv, until } from './helpers.ts'

function record(id: string, over: Partial<TaskRecord> = {}): TaskRecord {
  const now = Date.now()
  return {
    id, label: id, agent: 'codex', model: null, effort: null, status: 'done', sessionId: 'S', cwd: '/tmp',
    worktree: null, threadId: 'th', turnId: 'tu', turns: 1, createdAt: now, updatedAt: now, finishedAt: now,
    lastLine: null, result: 'ok', error: null, ...over,
  }
}

describe('state files', () => {
  test('layout, permissions and atomic index', () => {
    const h = tempDir()
    try {
      const p = paths(testEnv(h.dir))
      const store = new StateStore(p)
      store.put(record('task_a'), { now: true })
      store.append('task_a', { t: 1, kind: 'brief', text: 'hi', model: null, effort: null, cwd: '/tmp' })
      assert.equal(statSync(p.dir).mode & 0o777, 0o700)
      assert.equal(statSync(p.tasksIndex).mode & 0o777, 0o600)
      assert.equal(statSync(store.transcriptPath('task_a')).mode & 0o777, 0o600)
      const idx = readIndex(p.tasksIndex)!
      assert.equal(idx.format, STATE_FORMAT)
      assert.equal(idx.account, p.account)
      assert.equal(idx.tasks[0]!.id, 'task_a')
      assert.equal(JSON.parse(readFileSync(p.accountFile, 'utf8')).agent, 'codex')
      assert.match(p.account, /^codex-[0-9a-f]{10}$/)
    } finally {
      h.cleanup()
    }
  })

  test('a restarted helper marks tasks it was running as failed', () => {
    const h = tempDir()
    try {
      const p = paths(testEnv(h.dir))
      const first = new StateStore(p)
      first.put(record('task_run', { status: 'running', finishedAt: null }), { now: true })
      const second = new StateStore(p)
      const orphaned = second.load()
      assert.deepEqual(orphaned.map(t => t.id), ['task_run'])
      assert.equal(second.get('task_run')!.status, 'failed')
      assert.match(second.get('task_run')!.error!, /helper stopped/)
      assert.equal(second.readTranscript('task_run').at(-1)!.kind, 'status')
    } finally {
      h.cleanup()
    }
  })

  test('finished tasks are pruned after the retention period', () => {
    const h = tempDir()
    try {
      const p = paths(testEnv(h.dir))
      const store = new StateStore(p, 7)
      const day = 24 * 60 * 60 * 1000
      store.put(record('task_old', { finishedAt: Date.now() - 8 * day }))
      store.put(record('task_new', { finishedAt: Date.now() - 6 * day }))
      store.put(record('task_live', { status: 'running', finishedAt: null, createdAt: Date.now() - 30 * day }))
      store.append('task_old', { t: 1, kind: 'follow_up', text: 'x' })
      const gone = store.prune()
      assert.deepEqual(gone.map(t => t.id), ['task_old'])
      assert.ok(!existsSync(store.transcriptPath('task_old')))
      assert.deepEqual(store.all().map(t => t.id).sort(), ['task_live', 'task_new'])
    } finally {
      h.cleanup()
    }
  })

  test('a long HEINZEL_HOME moves the socket to the temp dir', () => {
    const p = paths({ HEINZEL_HOME: '/' + 'x'.repeat(120), CODEX_HOME: '/c' })
    assert.ok(Buffer.byteLength(p.socket) <= 100)
    assert.match(p.socket, /heinzel-\d+-[0-9a-f]{12}\.sock$/)
  })
})

describe('lock', () => {
  test('only one holder; a stale lock is taken over', () => {
    const h = tempDir()
    try {
      const file = `${h.dir}/helper.lock`
      assert.equal(acquireLock(file), true)
      assert.equal(acquireLock(file), false, 'our own live pid holds it')
      writeFileSync(file, '999999')
      assert.equal(acquireLock(file), true, 'a dead pid is stale')
      assert.equal(readFileSync(file, 'utf8'), String(process.pid))
    } finally {
      h.cleanup()
    }
  })
})

describe('version handshake', () => {
  test('a relay asks an idle helper of another version to restart', async () => {
    const h = tempDir()
    const env = testEnv(h.dir)
    const p = paths(env)
    mkdirSync(p.dir, { recursive: true })
    let askedToStop = false
    // A stand-in for an older helper.
    const old = createServer(socket => {
      const peer = new RpcPeer(socket, socket, {
        onRequest: method => {
          if (method === 'hello') return { version: '0.0.9', protocol: HELPER_PROTOCOL, pid: 1, account: p.account, running: 0 }
          if (method === 'shutdown') {
            askedToStop = true
            setImmediate(() => { old.close(); rmSync(p.socket, { force: true }) })
            return { stopping: true, running: 0 }
          }
          return {}
        },
      })
      void peer
    })
    await new Promise<void>(r => old.listen(p.socket, () => r()))
    const client = new HelperClient(p, env, 'S')
    try {
      const hello = await client.call('hello', { version: VERSION, protocol: HELPER_PROTOCOL, sessionId: 'S', pid: process.pid })
      assert.ok(askedToStop, 'the old helper was asked to stop')
      assert.equal(hello.version, VERSION, 'a helper of the relay\'s version took over')
    } finally {
      client.close()
      try { process.kill(Number(readFileSync(p.lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
      await until(() => !existsSync(p.lock), 5000).catch(() => {})
      h.cleanup()
    }
  })
})
