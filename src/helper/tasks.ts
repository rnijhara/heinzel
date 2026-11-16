// Task lifecycle: start a Codex thread per task, follow its events into the
// transcript, and report when each turn ends (ADR-0004, ADR-0008, ADR-0012).

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
import type { ThreadItem, Turn } from '../../protocol/codex/0.167.2/ts/v2/index.ts'

// Sent to every task as developer instructions (ADR-0008).
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
  private rosterCache: { key: string; roster: RosterAgent } | null = null

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

  // --- Roster (ADR-0009) --------------------------------------------------

  async roster(): Promise<Roster> {
    return { agents: [await this.codexRoster()] }
  }

  private async codexRoster(): Promise<RosterAgent> {
    const codex = await this.ensureCodex()
    let mtime = 0
    try { mtime = statSync(join(this.opts.env.CODEX_HOME || join(this.opts.env.HOME ?? '', '.codex'), 'config.toml')).mtimeMs } catch { /* no config */ }
    const key = `${codex.version}:${mtime}`
    if (this.rosterCache?.key === key) return this.rosterCache.roster
    const [models, config] = await Promise.all([codex.modelList(), codex.configRead().catch(() => null)])
    const visible = models.filter(m => !m.hidden)
    const defaultModel = config?.config.model ?? visible.find(m => m.isDefault)?.id ?? null
    const chosen = visible.find(m => m.id === defaultModel)
    const roster: RosterAgent = {
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
    this.rosterCache = { key, roster }
    return roster
  }

  private async validate(model: string | undefined, effort: string | undefined) {
    if (!model && !effort) return
    const roster = await this.codexRoster()
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
    await this.validate(p.model, p.effort)

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
    this.store.put(task, { now: true })
    this.store.append(id, { t: now, kind: 'brief', text: brief, model: task.model, effort: task.effort, cwd })

    try {
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
    const task = this.mustGet(p.taskId)
    const message = p.message?.trim()
    if (!message) fail(HelperErrors.InvalidInput, 'message is empty.')
    if (task.status === 'running') fail(HelperErrors.TaskBusy, `"${task.label}" is still running. Wait for it to finish, or recall it first.`)
    if (!task.threadId) fail(HelperErrors.InvalidInput, `"${task.label}" never started a thread, so there's nothing to continue. Dispatch a new task instead.`)
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
    this.store.put(task, { now: true })
    this.store.append(task.id, { t: now, kind: 'follow_up', text: message })
    try {
      await this.startTurn(codex, task, message)
    } catch (err) {
      this.finish(task, 'failed', null, `Could not continue the task: ${(err as Error).message}`)
    }
    return { ...task }
  }

  async recall(taskId: string): Promise<TaskRecord> {
    const task = this.mustGet(taskId)
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

  status(taskId: string): TaskRecord {
    return { ...this.mustGet(taskId) }
  }

  wait(taskId: string): Promise<TaskRecord> {
    const task = this.mustGet(taskId)
    if (task.status !== 'running') return Promise.resolve({ ...task })
    return new Promise(resolve => {
      const list = this.waiters.get(taskId) ?? []
      list.push(resolve)
      this.waiters.set(taskId, list)
    })
  }

  transcript(taskId: string, tail?: number): TranscriptResult {
    const task = this.mustGet(taskId)
    const all = this.store.readTranscript(taskId)
    const entries = tail && tail > 0 ? all.slice(-tail) : all
    return { task: { ...task }, entries, omitted: all.length - entries.length }
  }

  list(sessionId?: string): TaskRecord[] {
    return this.store.all().filter(t => !sessionId || t.sessionId === sessionId)
  }

  private mustGet(taskId: string): TaskRecord {
    const t = this.store.get(taskId)
    if (!t) fail(HelperErrors.UnknownTask, `No task with id "${taskId}". It may have been pruned.`)
    return t
  }

  shutdown() {
    this.codex?.kill()
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
        entry = { t, kind: 'command', command, exitCode: item.exitCode, output: clip(item.aggregatedOutput) }
        line = firstLine(`$ ${command}`)
        break
      }
      case 'fileChange': {
        const files = item.changes.map(c => ({ path: c.path, kind: c.kind.type }))
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
    this.store.append(task.id, entry)
    if (line && task.status === 'running') {
      task.lastLine = line
      task.updatedAt = t
      this.store.put(task)
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
    this.store.append(task.id, { t: now, kind: 'status', status, error })
    this.store.put(task, { now: true })
    const settle = async () => {
      if (task.worktree && !task.worktree.removed) {
        const removed = await removeIfUnchanged(task.worktree)
        if (removed) {
          task.worktree = { ...task.worktree, removed: true }
          this.store.put(task, { now: true })
        }
      }
      const list = this.waiters.get(task.id) ?? []
      this.waiters.delete(task.id)
      for (const resolve of list) resolve({ ...task })
      this.emit('finished', task)
    }
    void settle()
  }
}
