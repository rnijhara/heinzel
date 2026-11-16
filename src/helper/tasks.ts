// Task lifecycle: start a Codex thread per task, follow its events into the
// transcript, and report when each turn ends (ADR 4, ADR 8, ADR 12).

import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { RpcError } from '../shared/jsonrpc.ts'
import {
  HelperErrors,
  type DispatchParams,
  type FollowUpParams,
  type Roster,
  type RosterAgent,
  type TaskRecord,
  type TranscriptEntry,
  type TranscriptResult,
} from '../shared/protocol.ts'
import { CodexAppServer } from './codex.ts'
import type { StateStore } from './state.ts'
import { createWorktree, removeIfUnchanged, restoreWorktree } from './worktree.ts'
import type { CommandAction, ThreadItem, Turn } from '../../protocol/codex/0.167.2/ts/v2/index.ts'

// Sent to every task as developer instructions (ADR 8).
export const CHILD_RULES = [
  'You are running a task handed to you by another coding agent. Nobody is watching this session.',
  '- Do the work yourself. Do not hand it off to other agents.',
  '- Do not ask questions. Make reasonable assumptions and say what they were.',
  '- Finish with a clear final message: what you changed, what you verified and how, and anything that is blocked or needs a decision.',
].join('\n')

const THREAD_SETTINGS = {
  approvalPolicy: 'on-request',
  approvalsReviewer: 'auto_review',
  sandbox: 'workspace-write',
  developerInstructions: CHILD_RULES,
} as const

const RECALL_GRACE_MS = 15_000
const OUTPUT_LIMIT = 4000

export interface TaskManagerOptions {
  codexArgv: string[]
  env: NodeJS.ProcessEnv
  log: (line: string) => void
  worktreesDir: string
}

function fail(code: number, message: string): never {
  throw new RpcError(code, message)
}

export function defaultLabel(brief: string): string {
  const first = brief.trim().split('\n')[0]!.replace(/\s+/g, ' ')
  const words = first.split(' ').slice(0, 7).join(' ')
  return (words.length > 48 ? words.slice(0, 47) + '…' : words) || 'Task'
}

function firstLine(text: string, max = 160) {
  const line = text.trim().split('\n').find(l => l.trim()) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

// A short title for a command from what Codex parsed it into, as Claude Code
// titles a tool call: "Read a.ts, b.ts", "Searched for "x" in src". Null when
// any part is a command Codex couldn't parse, so the command itself is shown.
export function commandTitle(actions: CommandAction[], cwd: string): string | null {
  if (!actions.length || actions.some(a => a.type === 'unknown')) return null
  const rel = (p: string | null) => (!p || p === cwd ? '.' : p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p)
  const reads = actions.filter(a => a.type === 'read').map(a => a.name)
  const parts: string[] = []
  if (reads.length) parts.push(reads.length > 3 ? `Read ${reads.length} files` : `Read ${reads.join(', ')}`)
  for (const a of actions) {
    if (a.type === 'listFiles') parts.push(`Listed files in ${rel(a.path)}`)
    if (a.type === 'search') parts.push(a.query ? `Searched for "${a.query}" in ${rel(a.path)}` : `Searched ${rel(a.path)}`)
  }
  const joined = parts.join(', ')
  return joined.length > 120 ? joined.slice(0, 119) + '…' : joined
}

// Lines added and removed by one file change. Codex sends a unified diff for
// an update, and the file's text for an add or a delete.
export function lineCounts(diff: string | undefined, kind: string): { added: number; removed: number } {
  const lines = (diff ?? '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (!lines.some(l => l.startsWith('@@'))) {
    return kind === 'delete' ? { added: 0, removed: lines.length } : { added: lines.length, removed: 0 }
  }
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++
    else if (l.startsWith('-') && !l.startsWith('---')) removed++
  }
  return { added, removed }
}

function clip(text: string | null | undefined, max = OUTPUT_LIMIT) {
  if (!text) return null
  return text.length > max ? text.slice(0, max) + `\n… (${text.length - max} more characters)` : text
}

export class TaskManager extends EventEmitter {
  private store: StateStore
  private opts: TaskManagerOptions
  private codex: CodexAppServer | null = null
  private starting: Promise<CodexAppServer> | null = null
  private byThread = new Map<string, string>()
  private loaded = new Set<string>()
  private waiters = new Map<string, Array<(t: TaskRecord) => void>>()
  private lastMessage = new Map<string, string>()
  private modelCache: { key: string; models: Awaited<ReturnType<CodexAppServer['modelList']>> } | null = null
  private settling = new Set<Promise<void>>()
  // Each finished task's clean-up; a follow-up waits for it (worktree removal).
  private settlingByTask = new Map<string, Promise<void>>()
  // Tasks a follow-up has claimed but not yet started, so a second one is refused.
  private claimed = new Set<string>()

  constructor(store: StateStore, opts: TaskManagerOptions) {
    super()
    this.store = store
    this.opts = opts
    for (const t of store.all()) if (t.threadId) this.byThread.set(t.threadId, t.id)
  }

  runningCount() {
    return this.store.all().filter(t => t.status === 'running').length
  }

  // --- Codex process ------------------------------------------------------

  async ensureCodex(): Promise<CodexAppServer> {
    if (this.codex && !this.codex.exited) return this.codex
    if (this.starting) return this.starting
    this.starting = (async () => {
      try {
        const codex = await CodexAppServer.start({ argv: this.opts.codexArgv, env: this.opts.env, log: this.opts.log })
        codex.on('notification', (method: string, params: any) => this.onNotification(method, params))
        codex.on('exit', (why: string) => this.onCodexExit(codex, why))
        this.codex = codex
        this.loaded.clear()
        return codex
      } catch (err) {
        fail(HelperErrors.AgentUnavailable, `${(err as Error).message}. Check that the Codex CLI is installed and signed in (run \`codex login\`).`)
      } finally {
        this.starting = null
      }
    })()
    return this.starting
  }

  private onCodexExit(codex: CodexAppServer, why: string) {
    if (this.codex === codex) this.codex = null
    this.loaded.clear()
    for (const t of this.store.all()) {
      if (t.status === 'running') this.finish(t, 'failed', null, `Codex stopped unexpectedly (its app-server ${why}). A fresh one starts with the next request, and follow_up can continue this thread.`)
    }
  }

  // --- Roster (ADR 9) --------------------------------------------------

  async roster(cwd?: string): Promise<Roster> {
    return { agents: [await this.codexRoster(cwd)] }
  }

  // The model list is cached per Codex version and user config. Defaults are
  // read each time from the config that applies in `cwd`, project config included.
  private async codexRoster(cwd?: string): Promise<RosterAgent> {
    const codex = await this.ensureCodex()
    let mtime = 0
    try { mtime = statSync(join(this.opts.env.CODEX_HOME || join(this.opts.env.HOME ?? '', '.codex'), 'config.toml')).mtimeMs } catch { /* no config */ }
    const key = `${codex.version}:${mtime}`
    if (this.modelCache?.key !== key) {
      this.modelCache = { key, models: (await codex.modelList()).filter(m => !m.hidden) }
    }
    const visible = this.modelCache.models
    const config = await codex.configRead(cwd).catch(() => null)
    const defaultModel = config?.config.model ?? visible.find(m => m.isDefault)?.id ?? null
    const chosen = visible.find(m => m.id === defaultModel)
    return {
      agent: 'codex',
      version: codex.version,
      defaultModel,
      defaultEffort: config?.config.model_reasoning_effort ?? chosen?.defaultReasoningEffort ?? null,
      models: visible.map(m => ({
        id: m.id,
        name: m.displayName,
        efforts: m.supportedReasoningEfforts.map(e => e.reasoningEffort),
        defaultEffort: m.defaultReasoningEffort,
      })),
    }
  }

  private async validate(model: string | undefined, effort: string | undefined, cwd: string) {
    if (!model && !effort) return
    const roster = await this.codexRoster(cwd)
    const name = model ?? roster.defaultModel
    const m = roster.models.find(x => x.id === name)
    if (model && !m) {
      fail(HelperErrors.InvalidInput, `Unknown model "${model}". Available Codex models: ${roster.models.map(x => x.id).join(', ')}.`)
    }
    if (effort && m && !m.efforts.includes(effort)) {
      fail(HelperErrors.InvalidInput, `${m.id} doesn't support effort "${effort}". Supported: ${m.efforts.join(', ')}.`)
    }
  }

  // --- Tools --------------------------------------------------------------

  async dispatch(p: DispatchParams): Promise<TaskRecord> {
    const brief = p.brief?.trim()
    if (!brief) fail(HelperErrors.InvalidInput, 'brief is empty. Write the whole task in it: the agent sees nothing else.')
    const codex = await this.ensureCodex()
    await this.validate(p.model, p.effort, p.cwd)

    const id = `task_${randomBytes(4).toString('hex')}`
    const label = p.label?.trim() || defaultLabel(brief)
    let worktree = null
    if (p.worktree) {
      try {
        worktree = await createWorktree(p.cwd, this.opts.worktreesDir, id, label)
      } catch (err) {
        fail(HelperErrors.InvalidInput, (err as Error).message)
      }
    }
    const cwd = worktree?.path ?? p.cwd
    const now = Date.now()
    const task: TaskRecord = {
      id, label, agent: 'codex',
      model: p.model ?? null, effort: p.effort ?? null,
      status: 'running', sessionId: p.sessionId, cwd, worktree,
      threadId: null, turnId: null, turns: 1,
      createdAt: now, updatedAt: now, finishedAt: null,
      lastLine: 'Starting…', result: null, error: null,
    }
    try {
      this.store.put(task, { now: true })
      this.store.append(id, { t: now, kind: 'brief', text: brief, model: task.model, effort: task.effort, cwd })
      const started = await codex.threadStart({ ...THREAD_SETTINGS, cwd, ...(p.model ? { model: p.model } : {}) })
      task.threadId = started.thread.id
      task.model = started.model
      this.byThread.set(task.threadId, id)
      this.loaded.add(task.threadId)
      await this.startTurn(codex, task, brief)
    } catch (err) {
      this.finish(task, 'failed', null, `Could not start the task: ${(err as Error).message}`)
    }
    return { ...task }
  }

  private async startTurn(codex: CodexAppServer, task: TaskRecord, text: string) {
    this.lastMessage.delete(task.id)
    task.turnId = null
    const res = await codex.turnStart({
      threadId: task.threadId!,
      input: [{ type: 'text', text, text_elements: [] }],
      ...(task.effort ? { effort: task.effort } : {}),
    })
    task.turnId = res.turn.id
    task.updatedAt = Date.now()
    this.store.put(task, { now: true })
  }

  async followUp(p: FollowUpParams): Promise<TaskRecord> {
    const task = this.resolve(p.taskId, p.sessionId)
    const message = p.message?.trim()
    if (!message) fail(HelperErrors.InvalidInput, 'message is empty.')
    if (task.status === 'running' || this.claimed.has(task.id)) fail(HelperErrors.TaskBusy, `"${task.label}" is still running. Wait for it to finish, or recall it first.`)
    if (!task.threadId) fail(HelperErrors.InvalidInput, `"${task.label}" never started a thread, so there's nothing to continue. Dispatch a new task instead.`)
    // Claim the task before the first await, so a concurrent follow-up is refused.
    this.claimed.add(task.id)
    try {
      await this.settlingByTask.get(task.id)
      const codex = await this.ensureCodex()
      if (task.worktree?.removed) {
        task.worktree = await restoreWorktree(task.worktree)
      }
      if (!this.loaded.has(task.threadId)) {
        await codex.threadResume(task.threadId, { ...THREAD_SETTINGS, cwd: task.cwd, ...(task.model ? { model: task.model } : {}) })
        this.loaded.add(task.threadId)
        this.byThread.set(task.threadId, task.id)
      }
      const now = Date.now()
      Object.assign(task, { status: 'running', turns: task.turns + 1, finishedAt: null, result: null, error: null, lastLine: 'Continuing…', updatedAt: now, sessionId: p.sessionId ?? task.sessionId })
      try {
        this.store.put(task, { now: true })
        this.store.append(task.id, { t: now, kind: 'follow_up', text: message })
        await this.startTurn(codex, task, message)
      } catch (err) {
        this.finish(task, 'failed', null, `Could not continue the task: ${(err as Error).message}`)
      }
      return { ...task }
    } finally {
      this.claimed.delete(task.id)
    }
  }

  async recall(ref: string, sessionId?: string): Promise<TaskRecord> {
    const task = this.resolve(ref, sessionId)
    const taskId = task.id
    if (task.status !== 'running') return { ...task }
    const done = this.wait(taskId)
    if (this.codex && task.threadId && task.turnId) {
      try {
        await this.codex.turnInterrupt(task.threadId, task.turnId)
      } catch (err) {
        this.opts.log(`interrupt of ${taskId} failed: ${(err as Error).message}`)
      }
    }
    const timeout = new Promise<null>(r => setTimeout(() => r(null), RECALL_GRACE_MS).unref())
    const finished = await Promise.race([done, timeout])
    if (!finished && task.status === 'running') this.finish(task, 'cancelled', null, null)
    return { ...task }
  }

  status(ref: string, sessionId?: string): TaskRecord {
    return { ...this.resolve(ref, sessionId) }
  }

  wait(taskId: string): Promise<TaskRecord> {
    const task = this.mustGet(taskId)
    if (task.status !== 'running') {
      // Still cleaning up: answer once the worktree outcome is known.
      const settling = this.settlingByTask.get(taskId)
      return settling ? settling.then(() => ({ ...task })) : Promise.resolve({ ...task })
    }
    return new Promise(resolve => {
      const list = this.waiters.get(taskId) ?? []
      list.push(resolve)
      this.waiters.set(taskId, list)
    })
  }

  transcript(ref: string, tail?: number, sessionId?: string): TranscriptResult {
    const task = this.resolve(ref, sessionId)
    const all = this.store.readTranscript(task.id)
    const entries = tail && tail > 0 ? all.slice(-tail) : all
    return { task: { ...task }, entries, omitted: all.length - entries.length }
  }

  list(sessionId?: string): TaskRecord[] {
    return this.store.all().filter(t => !sessionId || t.sessionId === sessionId)
  }

  // Finds a task by id, or by label (ADR 18). A label prefers the asking
  // session's tasks, then running ones, then the newest. While a dispatch runs
  // in the background Claude only knows its label, not its id.
  resolve(ref: string, sessionId?: string): TaskRecord {
    const key = (ref ?? '').trim()
    const byId = this.store.get(key)
    if (byId) return byId
    const named = this.store.all().filter(t => t.label.toLowerCase() === key.toLowerCase())
    if (named.length) {
      const mine = named.filter(t => sessionId && t.sessionId === sessionId)
      const pool = mine.length ? mine : named
      const running = pool.filter(t => t.status === 'running')
      if (running.length > 1) fail(HelperErrors.InvalidInput, `${running.length} running tasks are labelled "${key}": ${running.map(t => t.id).join(', ')}. Pass one of these ids.`)
      return running[0] ?? pool[0]!
    }
    if (/^[a-z0-9]{6,12}$/.test(key) && !key.startsWith('task_')) {
      fail(HelperErrors.UnknownTask, `"${key}" looks like Claude Code's background task id, not a Heinzel task. Use TaskStop with it to cancel the dispatch, or pass the task's label or its task_ id here.`)
    }
    fail(HelperErrors.UnknownTask, `No task with id or label "${key}". It may have been pruned.`)
  }

  private mustGet(taskId: string): TaskRecord {
    const t = this.store.get(taskId)
    if (!t) fail(HelperErrors.UnknownTask, `No task with id "${taskId}". It may have been pruned.`)
    return t
  }

  // Stops Codex and waits for it to exit and for in-flight task endings
  // (worktree clean-up, state writes) to settle.
  async shutdown(): Promise<void> {
    const codex = this.codex
    this.codex = null
    await Promise.all([codex?.stop(), ...this.settling])
  }

  // --- Codex events -------------------------------------------------------

  private onNotification(method: string, params: any) {
    const taskId = params?.threadId ? this.byThread.get(params.threadId) : undefined
    const task = taskId ? this.store.get(taskId) : undefined
    if (!task) return
    if (method === 'item/completed') this.onItem(task, params.item as ThreadItem)
    else if (method === 'turn/completed') this.onTurnCompleted(task, params.turn as Turn)
  }

  private onItem(task: TaskRecord, item: ThreadItem) {
    const t = Date.now()
    let entry: TranscriptEntry | null = null
    let line: string | null = null
    switch (item.type) {
      case 'agentMessage':
        if (!item.text) return
        this.lastMessage.set(task.id, item.text)
        entry = { t, kind: 'message', text: item.text, final: item.phase === 'final_answer' }
        line = firstLine(item.text)
        break
      case 'commandExecution': {
        const command = item.commandActions?.[0]?.command ?? item.command
        const title = commandTitle(item.commandActions ?? [], task.cwd)
        entry = { t, kind: 'command', command, exitCode: item.exitCode, output: clip(item.aggregatedOutput), ...(title ? { title } : {}) }
        line = firstLine(`$ ${command}`)
        break
      }
      case 'fileChange': {
        const files = item.changes.map(c => ({ path: c.path, kind: c.kind.type, ...lineCounts(c.diff, c.kind.type) }))
        entry = { t, kind: 'edit', files }
        line = firstLine(`Edited ${files.map(f => f.path.split('/').pop()).join(', ')}`)
        break
      }
      case 'mcpToolCall':
        entry = { t, kind: 'tool', name: `${item.server}.${item.tool}`, status: item.status }
        line = `Used ${item.server}.${item.tool}`
        break
      case 'dynamicToolCall':
        entry = { t, kind: 'tool', name: item.tool, status: item.status }
        line = `Used ${item.tool}`
        break
      case 'webSearch':
        entry = { t, kind: 'tool', name: 'web search', status: 'completed' }
        line = 'Searched the web'
        break
      default:
        return
    }
    this.persist(task.id, () => this.store.append(task.id, entry))
    if (line && task.status === 'running') {
      task.lastLine = line
      task.updatedAt = t
      this.persist(task.id, () => this.store.put(task))
      this.emit('progress', task, line)
    }
  }

  private onTurnCompleted(task: TaskRecord, turn: Turn) {
    if (task.status !== 'running') return
    if (task.turnId && turn.id !== task.turnId) return
    const final = [...(turn.items ?? [])].reverse().find(i => i.type === 'agentMessage') as Extract<ThreadItem, { type: 'agentMessage' }> | undefined
    const result = final?.text || this.lastMessage.get(task.id) || null
    if (turn.status === 'completed') this.finish(task, 'done', result ?? '(The agent finished without a final message.)', null)
    else if (turn.status === 'interrupted') this.finish(task, 'cancelled', result, null)
    else this.finish(task, 'failed', result, turn.error?.message ?? 'The turn failed.')
  }

  private finish(task: TaskRecord, status: TaskRecord['status'], result: string | null, error: string | null) {
    const now = Date.now()
    Object.assign(task, { status, result, error, finishedAt: now, updatedAt: now })
    task.lastLine = status === 'done' ? firstLine(result ?? 'Done') : status === 'cancelled' ? 'Cancelled' : firstLine(error ?? 'Failed')
    this.lastMessage.delete(task.id)
    // A failed write (say, the state dir was deleted) must not stop the wake-up.
    this.persist(task.id, () => {
      this.store.append(task.id, { t: now, kind: 'status', status, error })
      this.store.put(task, { now: true })
    })
    const settle = async () => {
      try {
        if (task.worktree && !task.worktree.removed) {
          const removed = await removeIfUnchanged(task.worktree)
          if (removed) {
            task.worktree = { ...task.worktree, removed: true }
            this.persist(task.id, () => this.store.put(task, { now: true }))
          }
        }
      } finally {
        const list = this.waiters.get(task.id) ?? []
        this.waiters.delete(task.id)
        for (const resolve of list) resolve({ ...task })
        this.emit('finished', task)
      }
    }
    const p: Promise<void> = settle().catch(err => this.opts.log(`clean-up of ${task.id} failed: ${(err as Error).message}`)).finally(() => {
      this.settling.delete(p)
      if (this.settlingByTask.get(task.id) === p) this.settlingByTask.delete(task.id)
    })
    this.settling.add(p)
    this.settlingByTask.set(task.id, p)
  }

  private persist(taskId: string, write: () => void) {
    try {
      write()
    } catch (err) {
      this.opts.log(`could not save state for ${taskId}: ${(err as Error).message}`)
    }
  }
}
