// Layer 1: the helper's task manager against the fake app-server (ADR 16).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { paths } from '../src/shared/paths.ts'
import { HelperErrors } from '../src/shared/protocol.ts'
import { answerServerRequest, codexArgv } from '../src/helper/codex.ts'
import { StateStore } from '../src/helper/state.ts'
import { TaskManager, defaultLabel } from '../src/helper/tasks.ts'
import { FAKE_CODEX, gitRepo, tempDir, testEnv } from './helpers.ts'

function setup(extra: Record<string, string> = {}) {
  const { dir, cleanup } = tempDir()
  const env = testEnv(dir, { FAKE_CODEX_LOG: join(dir, 'fake.log'), ...extra })
  const p = paths(env)
  const store = new StateStore(p)
  const lines: string[] = []
  const tm = new TaskManager(store, { codexArgv: codexArgv(env), env, log: l => lines.push(l), worktreesDir: p.worktrees })
  // Waits for Codex to exit and the store's last write before removing the dir.
  return { dir, env, p, store, tm, lines, cleanup: async () => { await tm.shutdown(); store.close(); cleanup() } }
}

describe('server request answers (ADR 8)', () => {
  test('approvals are declined and questions get no answer', () => {
    assert.deepEqual(answerServerRequest('item/commandExecution/requestApproval', {}), { decision: 'decline' })
    assert.deepEqual(answerServerRequest('item/fileChange/requestApproval', {}), { decision: 'decline' })
    assert.deepEqual(answerServerRequest('item/tool/requestUserInput', {}), { answers: {} })
    assert.deepEqual(answerServerRequest('mcpServer/elicitation/request', {}), { action: 'decline', content: null, _meta: null })
    assert.throws(() => answerServerRequest('account/chatgptAuthTokens/refresh', {}))
  })

  test('codex argv defaults and override', () => {
    assert.deepEqual(codexArgv({}), ['codex', 'app-server'])
    assert.deepEqual(codexArgv({ HEINZEL_CODEX_ARGV: '["node","x.ts"]' }), ['node', 'x.ts'])
  })

  test('default labels are short', () => {
    assert.equal(defaultLabel('Fix the flaky login test in auth.spec.ts please and thanks'), 'Fix the flaky login test in auth.spec.ts')
    assert.equal(defaultLabel('   \n'), 'Task')
  })
})

describe('task manager with the fake app-server', () => {
  let s: ReturnType<typeof setup>
  before(() => { s = setup() })
  after(() => s.cleanup())

  test('dispatch runs a turn and records the transcript', async () => {
    const t = await s.tm.dispatch({ brief: 'List the files', cwd: s.dir, sessionId: 'S1' })
    assert.equal(t.status, 'running')
    assert.match(t.id, /^task_[0-9a-f]{8}$/)
    const done = await s.tm.wait(t.id)
    assert.equal(done.status, 'done')
    assert.match(done.result!, /Fake done \(turn 1 on this thread\): List the files/)
    assert.equal(done.label, 'List the files')
    const kinds = s.tm.transcript(t.id).entries.map(e => e.kind)
    assert.deepEqual(kinds, ['brief', 'command', 'message', 'status'])
    const index = JSON.parse(readFileSync(s.p.tasksIndex, 'utf8'))
    assert.equal(index.tasks.find((x: any) => x.id === t.id).status, 'done')
  })

  test('unattended: approvals declined, questions answered empty', async () => {
    const t = await s.tm.dispatch({ brief: 'Do it [approval][ask]', cwd: s.dir, sessionId: 'S1' })
    const done = await s.tm.wait(t.id)
    assert.equal(done.status, 'done')
    assert.match(done.result!, /approval answer: \{"decision":"decline"\}/)
    assert.match(done.result!, /input answer: \{"answers":\{\}\}/)
    assert.match(done.result!, /elicitation answer: \{"action":"decline","content":null,"_meta":null\}/)
  })

  test('the thread gets the child rules and unattended settings', () => {
    const log = readFileSync(join(s.dir, 'fake.log'), 'utf8')
    const start = log.split('\n').find(l => l.includes('"method":"thread/start"'))!
    const params = JSON.parse(start.slice(3)).params
    assert.equal(params.approvalPolicy, 'on-request')
    assert.equal(params.approvalsReviewer, 'auto_review')
    assert.equal(params.sandbox, 'workspace-write')
    assert.match(params.developerInstructions, /Do not ask questions/)
  })

  test('a failed turn is reported as failed', async () => {
    const t = await s.tm.dispatch({ brief: 'Break [fail]', cwd: s.dir, sessionId: 'S1' })
    const done = await s.tm.wait(t.id)
    assert.equal(done.status, 'failed')
    assert.equal(done.error, 'fake failure')
  })

  test('a turn with no final message still finishes', async () => {
    const done = await s.tm.wait((await s.tm.dispatch({ brief: 'Quiet [silent]', cwd: s.dir, sessionId: 'S1' })).id)
    assert.equal(done.status, 'done')
    assert.match(done.result!, /without a final message/)
  })

  test('follow_up continues the same thread', async () => {
    const t = await s.tm.dispatch({ brief: 'First', cwd: s.dir, sessionId: 'S1', label: 'Two turns' })
    await s.tm.wait(t.id)
    const again = await s.tm.followUp({ taskId: t.id, message: 'Second', sessionId: 'S1' })
    assert.equal(again.status, 'running')
    assert.equal(again.turns, 2)
    const done = await s.tm.wait(t.id)
    assert.match(done.result!, /turn 2 on this thread\): Second/)
    assert.deepEqual(s.tm.transcript(t.id).entries.map(e => e.kind).filter(k => k !== 'command'), ['brief', 'message', 'status', 'follow_up', 'message', 'status'])
    assert.equal(s.tm.transcript(t.id, 2).entries.length, 2)
  })

  test('follow_up on a running task is refused', async () => {
    const t = await s.tm.dispatch({ brief: 'Long [slow:400]', cwd: s.dir, sessionId: 'S1' })
    await assert.rejects(s.tm.followUp({ taskId: t.id, message: 'more', sessionId: 'S1' }), (e: any) => e.code === HelperErrors.TaskBusy)
    await s.tm.wait(t.id)
  })

  test('recall interrupts a running task', async () => {
    const t = await s.tm.dispatch({ brief: 'Long [slow:10000]', cwd: s.dir, sessionId: 'S1' })
    const started = Date.now()
    const r = await s.tm.recall(t.id)
    assert.equal(r.status, 'cancelled')
    assert.ok(Date.now() - started < 3000, 'recall should not wait for the turn')
    // Recalling again is a no-op.
    assert.equal((await s.tm.recall(t.id)).status, 'cancelled')
  })

  test('unknown tasks are reported clearly', async () => {
    assert.throws(() => s.tm.status('task_nope'), (e: any) => e.code === HelperErrors.UnknownTask)
    assert.throws(() => s.tm.status('kswpljim8'), /looks like Claude Code's background task id/)
  })

  test('tasks can be named by label (ADR 18)', async () => {
    const a = await s.tm.dispatch({ brief: 'Sleep [slow:5000]', label: 'Sleeper', cwd: s.dir, sessionId: 'S1' })
    const other = await s.tm.dispatch({ brief: 'Other session [slow:5000]', label: 'Sleeper', cwd: s.dir, sessionId: 'S2' })
    assert.equal(s.tm.status('sleeper', 'S1').id, a.id, 'case-insensitive, and the asking session wins')
    assert.equal(s.tm.status('Sleeper', 'S2').id, other.id)
    assert.throws(() => s.tm.status('Sleeper', 'S3'), /2 running tasks are labelled "Sleeper"/)
    const r = await s.tm.recall('Sleeper', 'S1')
    assert.equal(r.id, a.id)
    assert.equal(r.status, 'cancelled')
    await s.tm.recall(other.id)
  })

  test('roster lists models and the effective default from config', async () => {
    const r = await s.tm.roster()
    const codex = r.agents[0]!
    assert.equal(codex.version, '0.167.2')
    assert.equal(codex.defaultModel, 'fake-big')
    assert.equal(codex.defaultEffort, 'medium')
    assert.deepEqual(codex.models.map(m => m.id), ['fake-big', 'fake-small'])
    assert.deepEqual(codex.models[1]!.efforts, ['low', 'medium'])
  })

  test('dispatch validates model and effort against the roster', async () => {
    await assert.rejects(s.tm.dispatch({ brief: 'x', model: 'gpt-nope', cwd: s.dir, sessionId: 'S1' }), /Unknown model "gpt-nope". Available Codex models: fake-big, fake-small/)
    await assert.rejects(s.tm.dispatch({ brief: 'x', model: 'fake-small', effort: 'high', cwd: s.dir, sessionId: 'S1' }), /fake-small doesn't support effort "high". Supported: low, medium/)
    await assert.rejects(s.tm.dispatch({ brief: 'x', effort: 'ultra', cwd: s.dir, sessionId: 'S1' }), /fake-big doesn't support effort "ultra"/)
    const ok = await s.tm.dispatch({ brief: 'x', model: 'fake-small', effort: 'low', cwd: s.dir, sessionId: 'S1' })
    assert.equal((await s.tm.wait(ok.id)).model, 'fake-small')
    await assert.rejects(s.tm.dispatch({ brief: '  ', cwd: s.dir, sessionId: 'S1' }), /brief is empty/)
  })
})

describe('app-server health (ADR 4)', () => {
  test('a crash fails the running task and the next dispatch starts a fresh app-server', async () => {
    const s = setup()
    try {
      const t = await s.tm.dispatch({ brief: 'Boom [crash]', cwd: s.dir, sessionId: 'S1' })
      const done = await s.tm.wait(t.id)
      assert.equal(done.status, 'failed')
      assert.match(done.error!, /Codex stopped unexpectedly/)
      const next = await s.tm.wait((await s.tm.dispatch({ brief: 'After', cwd: s.dir, sessionId: 'S1' })).id)
      assert.equal(next.status, 'done')
      // A follow-up on the crashed task's thread resumes it on the new app-server.
      const fu = await s.tm.followUp({ taskId: t.id, message: 'Retry', sessionId: 'S1' })
      assert.equal((await s.tm.wait(fu.id)).status, 'done')
      assert.ok(readFileSync(join(s.dir, 'fake.log'), 'utf8').includes('"method":"thread/resume"'))
    } finally {
      await s.cleanup()
    }
  })

  test('a missing codex binary gives a clear error', async () => {
    const s = setup({ HEINZEL_CODEX_ARGV: JSON.stringify(['/nonexistent/codex', 'app-server']) })
    try {
      await assert.rejects(s.tm.dispatch({ brief: 'x', cwd: s.dir, sessionId: 'S1' }), /Codex CLI is installed and signed in/)
    } finally {
      await s.cleanup()
    }
  })
})

describe('worktrees (ADR 10)', () => {
  test('an unchanged worktree is removed; a changed one is kept on its branch', async () => {
    const s = setup()
    try {
      const repo = join(s.dir, 'repo')
      execFileSync('mkdir', ['-p', repo])
      const g = gitRepo(repo)
      const clean = await s.tm.dispatch({ brief: 'Look only', cwd: repo, sessionId: 'S1', worktree: true, label: 'Look only' })
      assert.ok(clean.worktree)
      assert.match(clean.worktree.branch, /^heinzel\/look-only-[0-9a-f]{8}$/)
      assert.equal(clean.cwd, clean.worktree.path)
      const cleanDone = await s.tm.wait(clean.id)
      assert.equal(cleanDone.worktree!.removed, true)
      assert.ok(!existsSync(clean.worktree.top))
      assert.ok(!g('branch', '--list', clean.worktree.branch).toString().trim())

      const dirty = await s.tm.dispatch({ brief: 'Add a file [write:new.txt]', cwd: repo, sessionId: 'S1', worktree: true })
      const dirtyDone = await s.tm.wait(dirty.id)
      assert.ok(!dirtyDone.worktree!.removed)
      assert.ok(existsSync(join(dirty.worktree!.top, 'new.txt')))
      assert.ok(!existsSync(join(repo, 'new.txt')), 'the main checkout is untouched')
      assert.ok(g('branch', '--list', dirty.worktree!.branch).toString().includes(dirty.worktree!.branch))

      // A follow-up on the removed worktree brings it back.
      const fu = await s.tm.followUp({ taskId: clean.id, message: 'Look again', sessionId: 'S1' })
      assert.ok(existsSync(fu.worktree!.top))
      await s.tm.wait(fu.id)
    } finally {
      await s.cleanup()
    }
  })

  test('worktree outside a git repository is rejected', async () => {
    const s = setup()
    try {
      await assert.rejects(s.tm.dispatch({ brief: 'x', cwd: s.dir, sessionId: 'S1', worktree: true }), /needs a git repository/)
    } finally {
      await s.cleanup()
    }
  })
})
