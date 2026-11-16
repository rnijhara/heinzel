// Layer 3: the real relay and helper processes against the fake app-server,
// driven over stdio the way Claude Code 2.1.325 drives an MCP server
// (wire format from test/fixtures/claude-code-2.1.325). ADR-0016.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { paths } from '../src/shared/paths.ts'
import { INSTRUCTIONS } from '../src/server/instructions.ts'
import { TOOL_DESCRIPTIONS } from '../src/server/tools.ts'
import { CLAUDE_META, startRelay, tempDir, testEnv, until } from './helpers.ts'

type Relay = ReturnType<typeof startRelay>

async function handshake(r: Relay, tasks: boolean) {
  return r.peer.request('server/discover', { _meta: CLAUDE_META(tasks) }, { timeoutMs: 10000 })
}

function call(r: Relay, name: string, args: Record<string, unknown>, tasks = false, extraMeta: Record<string, unknown> = {}) {
  return r.peer.request<any>('tools/call', { name, arguments: args, _meta: { ...CLAUDE_META(tasks), ...extraMeta } }, { timeoutMs: 20000 })
}

const text = (res: any) => res.content.map((c: any) => c.text).join('\n')

describe('relay over stdio, plain calls (automatic backgrounding path)', () => {
  let home: ReturnType<typeof tempDir>
  let r: Relay
  let env: NodeJS.ProcessEnv
  before(async () => {
    home = tempDir()
    env = testEnv(home.dir, { CLAUDE_CODE_SESSION_ID: 'session-A' })
    r = startRelay(env, home.dir)
  })
  after(async () => {
    r.child.kill()
    await r.peer.request('noop').catch(() => {})
    // Stop the helper the relay started.
    try { process.kill(Number(readFileSync(paths(env).lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
    home.cleanup()
  })

  test('server/discover negotiates 2026-07-28, sends the instructions and advertises tasks', async () => {
    const res: any = await handshake(r, false)
    assert.ok(res.supportedVersions.includes('2026-07-28'))
    assert.equal(res.instructions, INSTRUCTIONS)
    assert.ok(res.capabilities.tools)
    assert.deepEqual(res.capabilities.extensions['io.modelcontextprotocol/tasks'], {})
  })

  test('tools/list has the six tools, with task support on dispatch and follow_up', async () => {
    const res: any = await r.peer.request('tools/list', { _meta: CLAUDE_META(false) })
    const byName = Object.fromEntries(res.tools.map((t: any) => [t.name, t]))
    assert.deepEqual(Object.keys(byName).sort(), ['dispatch', 'follow_up', 'recall', 'roster', 'status', 'transcript'])
    for (const [name, desc] of Object.entries(TOOL_DESCRIPTIONS)) assert.equal(byName[name].description, desc)
    assert.equal(byName.dispatch.execution?.taskSupport, 'optional')
    assert.equal(byName.follow_up.execution?.taskSupport, 'optional')
    assert.equal(byName.status.execution, undefined)
    assert.deepEqual(byName.dispatch.inputSchema.required, ['brief'])
    assert.ok(byName.dispatch.inputSchema.properties.worktree)
  })

  test('roster', async () => {
    const out = text(await call(r, 'roster', {}))
    assert.match(out, /codex 0\.167\.2: default model fake-big, default effort medium\./)
    assert.match(out, /- fake-small \(FAKE-SMALL\): efforts low, medium; default low/)
  })

  test('dispatch blocks until done, streams progress, and says the settings are missing', async () => {
    const progress: any[] = []
    r.peer.handlers.onNotification = (method, params) => { if (method === 'notifications/progress') progress.push(params) }
    const res = await call(r, 'dispatch', { brief: 'Summarise README [slow:300]', label: 'Summary' }, false, { progressToken: 7 })
    const out = text(res)
    assert.match(out, /^Task "Summary" \(task_[0-9a-f]{8}\) is done\./)
    assert.match(out, /Final message from the agent:\nFake done/)
    assert.match(out, /Then: check the result/)
    assert.match(out, /background settings aren't set/)
    assert.ok(progress.length >= 2, `expected progress notifications, got ${progress.length}`)
    assert.ok(progress.every(p => p.progressToken === 7))
    assert.match(progress[0].message, /Working, step 1/)
  })

  test('status, transcript and follow_up', async () => {
    const first = text(await call(r, 'dispatch', { brief: 'Step one', label: 'Chain' }))
    const id = first.match(/\((task_[0-9a-f]{8})\)/)![1]
    assert.match(text(await call(r, 'status', { task_id: id })), /is done/)
    const fu = text(await call(r, 'follow_up', { task_id: id, message: 'Step two' }))
    assert.match(fu, /turn 2 on this thread\): Step two/)
    assert.match(fu, /2 turns/)
    const tr = text(await call(r, 'transcript', { task_id: id }))
    assert.match(tr, /Brief:\nStep one/)
    assert.match(tr, /Follow-up:\nStep two/)
    assert.match(tr, /\$ ls  \(exit 0\)/)
    assert.match(text(await call(r, 'transcript', { task_id: id, tail: 1 })), /earlier entries left out/)
  })

  test('errors come back as tool errors Claude can act on', async () => {
    const bad = await call(r, 'dispatch', { brief: 'x', model: 'gpt-nope' })
    assert.equal(bad.isError, true)
    assert.match(text(bad), /Unknown model "gpt-nope". Available Codex models: fake-big, fake-small/)
    const unknown = await call(r, 'status', { task_id: 'task_00000000' })
    assert.equal(unknown.isError, true)
    const wt = await call(r, 'dispatch', { brief: 'x', worktree: true })
    assert.match(text(wt), /needs a git repository/)
  })

  test('cancelling the call (TaskStop) recalls the task', async () => {
    const pending = call(r, 'dispatch', { brief: 'Long [slow:20000]', label: 'To cancel' }).catch(e => e)
    const p = paths(env)
    const running = await until(() => JSON.parse(readFileSync(p.tasksIndex, 'utf8')).tasks.find((t: any) => t.label === 'To cancel' && t.status === 'running'))
    // Claude Code cancels a stopped call with notifications/cancelled.
    r.peer.notify('notifications/cancelled', { requestId: (r.peer as any).nextId - 1, reason: 'TaskStop' })
    const cancelled = await until(() => JSON.parse(readFileSync(p.tasksIndex, 'utf8')).tasks.find((t: any) => t.id === running.id && t.status === 'cancelled'), 8000)
    assert.ok(cancelled)
    void pending
  })
})

describe('relay with MCP tasks (io.modelcontextprotocol/tasks)', () => {
  let home: ReturnType<typeof tempDir>
  let r: Relay
  let env: NodeJS.ProcessEnv
  before(async () => {
    home = tempDir()
    env = testEnv(home.dir, { CLAUDE_CODE_SESSION_ID: 'session-T', CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: '1000', CLAUDE_AUTO_BACKGROUND_TASKS: '1' })
    r = startRelay(env, home.dir)
    await handshake(r, true)
  })
  after(() => {
    r.child.kill()
    try { process.kill(Number(readFileSync(paths(env).lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
    home.cleanup()
  })

  test('dispatch answers with a task at once, and tasks/get returns the result', async () => {
    const started = Date.now()
    const res = await call(r, 'dispatch', { brief: 'Task mode [slow:500]', label: 'Async' }, true)
    assert.ok(Date.now() - started < 2000, 'should not wait for the turn')
    assert.equal(res.resultType, 'task')
    assert.equal(res.status, 'working')
    assert.match(res.taskId, /^task_/)
    assert.equal(typeof res.pollIntervalMs, 'number')
    const done: any = await until(async () => {
      const g: any = await r.peer.request('tasks/get', { taskId: res.taskId, _meta: CLAUDE_META(true) })
      assert.equal(g.resultType, 'complete')
      return g.status === 'completed' ? g : null
    }, 10000, 100)
    assert.match(done.result.content[0].text, /Task "Async" .* is done\./)
    assert.doesNotMatch(done.result.content[0].text, /background settings/)
  })

  test('tasks/cancel recalls the task', async () => {
    const res = await call(r, 'dispatch', { brief: 'Long [slow:20000]' }, true)
    const c: any = await r.peer.request('tasks/cancel', { taskId: res.taskId, _meta: CLAUDE_META(true) })
    assert.equal(c.status, 'cancelled')
  })

  test('follow_up runs as a task too; invalid input falls back to a tool error', async () => {
    const d = await call(r, 'dispatch', { brief: 'Base' }, true)
    await until(async () => ((await r.peer.request<any>('tasks/get', { taskId: d.taskId })).status === 'completed'), 10000, 100)
    const f = await call(r, 'follow_up', { task_id: d.taskId, message: 'More' }, true)
    assert.equal(f.resultType, 'task')
    const bad = await call(r, 'dispatch', { brief: 'x', model: 'nope' }, true)
    assert.equal(bad.isError, true)
    const missing: any = await r.peer.request('tasks/get', { taskId: 'task_unknown' }).catch(e => e)
    assert.equal(missing.code, -32602)
  })
})

describe('shared helper (ADR-0004)', () => {
  test('two sessions share one helper, and events go only to the owning session', async () => {
    const home = tempDir()
    const base = testEnv(home.dir)
    const a = startRelay({ ...base, CLAUDE_CODE_SESSION_ID: 'A' }, home.dir)
    const b = startRelay({ ...base, CLAUDE_CODE_SESSION_ID: 'B' }, home.dir)
    try {
      await Promise.all([handshake(a, false), handshake(b, false)])
      const progressB: any[] = []
      b.peer.handlers.onNotification = (m, p) => { if (m === 'notifications/progress') progressB.push(p) }
      await Promise.all([call(a, 'roster', {}), call(b, 'roster', {})])
      const p = paths(base)
      const helperPid = Number(readFileSync(p.lock, 'utf8'))
      assert.ok(helperPid > 0)
      // Both relays connected to that helper.
      const log = readFileSync(p.log, 'utf8')
      assert.match(log, /relay connected: session A/)
      assert.match(log, /relay connected: session B/)
      assert.equal((log.match(/listening on/g) ?? []).length, 1, 'only one helper started')
      await call(a, 'dispatch', { brief: 'For A [slow:300]' }, false, { progressToken: 1 })
      assert.equal(progressB.length, 0, 'B saw none of A\'s progress')
      // A task started from A is visible to B by id.
      const idx = JSON.parse(readFileSync(p.tasksIndex, 'utf8'))
      assert.match(text(await call(b, 'status', { task_id: idx.tasks[0].id })), /is done/)
    } finally {
      a.child.kill()
      b.child.kill()
      try { process.kill(Number(readFileSync(paths(base).lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
      home.cleanup()
    }
  })

  test('the helper exits when idle and the next call starts a new one', async () => {
    const home = tempDir()
    const env = testEnv(home.dir, { HEINZEL_IDLE_MS: '300', CLAUDE_CODE_SESSION_ID: 'I' })
    const p = paths(env)
    try {
      const r1 = startRelay(env, home.dir)
      await handshake(r1, false)
      await call(r1, 'roster', {})
      const pid1 = Number(readFileSync(p.lock, 'utf8'))
      r1.child.kill()
      await until(() => !existsSync(p.lock), 5000)
      assert.ok(!existsSync(p.socket))
      const r2 = startRelay(env, home.dir)
      await handshake(r2, false)
      await call(r2, 'roster', {})
      const pid2 = Number(readFileSync(p.lock, 'utf8'))
      assert.notEqual(pid1, pid2)
      r2.child.kill()
      await until(() => !existsSync(p.lock), 5000)
    } finally {
      home.cleanup()
    }
  })
})

describe('replay of recorded Claude Code 2.1.325 requests', () => {
  const load = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/claude-code-2.1.325', name), 'utf8')
    .split('\n').filter(l => l.startsWith('<< ')).map(l => JSON.parse(l.slice(3)))

  for (const [file, tasks] of [['tasks-on-wire.txt', true], ['tasks-off-wire.txt', false]] as const) {
    test(`${file}: the relay answers Claude Code's own messages`, async () => {
      const home = tempDir()
      const env = testEnv(home.dir, { CLAUDE_CODE_SESSION_ID: `replay-${tasks}` })
      const r = startRelay(env, home.dir)
      try {
        const msgs = load(file)
        const discover = msgs.find(m => m.method === 'server/discover')
        const d: any = await r.peer.request('server/discover', discover.params)
        assert.ok(d.supportedVersions.includes(discover.params._meta['io.modelcontextprotocol/protocolVersion']))
        const list = msgs.find(m => m.method === 'tools/list')
        const tools: any = await r.peer.request('tools/list', list.params)
        assert.equal(tools.tools.length, 6)
        // Claude Code's recorded call, aimed at dispatch instead of the probe's tool.
        const rec = msgs.find(m => m.method === 'tools/call')
        const res: any = await r.peer.request('tools/call', { ...rec.params, name: 'dispatch', arguments: { brief: 'Replay' } }, { timeoutMs: 20000 })
        if (tasks) {
          assert.equal(res.resultType, 'task')
          const get = msgs.find(m => m.method === 'tasks/get')
          const final: any = await until(async () => {
            const g: any = await r.peer.request('tasks/get', { ...get.params, taskId: res.taskId })
            return g.status === 'completed' ? g : null
          }, 10000, 100)
          // Same shape as the probe's answer that Claude Code accepted.
          for (const key of ['resultType', 'taskId', 'status', 'createdAt', 'lastUpdatedAt', 'ttlMs', 'result']) assert.ok(key in final, key)
        } else {
          assert.notEqual(res.resultType, 'task')
          assert.match(res.content[0].text, /is done/)
        }
      } finally {
        r.child.kill()
        try { process.kill(Number(readFileSync(paths(env).lock, 'utf8')), 'SIGTERM') } catch { /* gone */ }
        home.cleanup()
      }
    })
  }
})
