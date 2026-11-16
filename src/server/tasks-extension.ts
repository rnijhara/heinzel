// The MCP tasks extension (`io.modelcontextprotocol/tasks`, protocol revision
// 2026-07-28), implemented at the transport because SDK v2 has no support for
// it (ADR-0005, ADR-0015).
//
// When Claude Code's `tools/call` for dispatch or follow_up says it supports
// tasks, we answer at once with a task and serve `tasks/get` and
// `tasks/cancel` ourselves. Every other message passes through to the SDK.
// We also advertise the extension in the handshake and mark the two tools as
// task-capable in `tools/list`.

import type { Transport } from '@modelcontextprotocol/server'
import type { HelperClient } from './helper-client.ts'
import { formatFinished } from './format.ts'
import type { TaskRecord } from '../shared/protocol.ts'

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'
const CLIENT_CAPS = 'io.modelcontextprotocol/clientCapabilities'
const TASK_TOOLS = new Set(['dispatch', 'follow_up'])
const POLL_INTERVAL_MS = 2000

type Msg = Record<string, any>

interface McpTask {
  taskId: string
  status: 'working' | 'completed' | 'cancelled'
  createdAt: string
  lastUpdatedAt: string
  statusMessage?: string
  result?: { content: { type: 'text'; text: string }[]; isError?: boolean }
}

const iso = (ms: number) => new Date(ms).toISOString()

export function clientSupportsTasks(params: Msg | undefined): boolean {
  return Boolean(params?._meta?.[CLIENT_CAPS]?.extensions?.[TASKS_EXTENSION])
}

function toMcpTask(t: TaskRecord): McpTask {
  const base = { taskId: t.id, createdAt: iso(t.createdAt), lastUpdatedAt: iso(t.updatedAt) }
  if (t.status === 'running') return { ...base, status: 'working', ...(t.lastLine ? { statusMessage: t.lastLine } : {}) }
  if (t.status === 'cancelled') return { ...base, status: 'cancelled', statusMessage: 'Cancelled' }
  return { ...base, status: 'completed', result: { content: [{ type: 'text', text: formatFinished(t) }], ...(t.status === 'failed' ? { isError: true } : {}) } }
}

export class TaskAwareTransport implements Transport {
  private inner: Transport
  private helper: HelperClient
  private pendingMethods = new Map<string | number, string>()
  private tasks = new Map<string, TaskRecord>()
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: Transport['onmessage']
  sessionId?: string

  constructor(inner: Transport, helper: HelperClient) {
    this.inner = inner
    this.helper = helper
    helper.on('task/finished', ({ task }: { task: TaskRecord }) => {
      if (this.tasks.has(task.id)) this.tasks.set(task.id, task)
    })
    helper.on('task/progress', ({ taskId, line }: { taskId: string; line: string }) => {
      const t = this.tasks.get(taskId)
      if (t) this.tasks.set(taskId, { ...t, lastLine: line, updatedAt: Date.now() })
    })
  }

  get setProtocolVersion() {
    return this.inner.setProtocolVersion?.bind(this.inner)
  }

  async start() {
    this.inner.onclose = () => this.onclose?.()
    this.inner.onerror = err => this.onerror?.(err)
    this.inner.onmessage = (message, extra) => {
      void this.receive(message as Msg, extra)
    }
    await this.inner.start()
  }

  close() {
    return this.inner.close()
  }

  async send(message: any, options?: any) {
    const id = message?.id
    if (id !== undefined && message.result && this.pendingMethods.has(id)) {
      const method = this.pendingMethods.get(id)
      this.pendingMethods.delete(id)
      if (method === 'initialize' || method === 'server/discover') {
        const caps = (message.result.capabilities ??= {})
        caps.extensions = { ...(caps.extensions ?? {}), [TASKS_EXTENSION]: {} }
      } else if (method === 'tools/list') {
        for (const tool of message.result.tools ?? []) {
          if (TASK_TOOLS.has(tool.name)) tool.execution = { ...(tool.execution ?? {}), taskSupport: 'optional' }
        }
      }
    } else if (id !== undefined && (message.error || message.result)) {
      this.pendingMethods.delete(id)
    }
    return this.inner.send(message, options)
  }

  private reply(id: string | number, result: unknown) {
    return this.inner.send({ jsonrpc: '2.0', id, result } as any)
  }

  private replyError(id: string | number, code: number, msg: string) {
    return this.inner.send({ jsonrpc: '2.0', id, error: { code, message: msg } } as any)
  }

  private async receive(msg: Msg, extra: any) {
    const { id, method, params } = msg
    if (id !== undefined && method) {
      if (method === 'tools/call' && TASK_TOOLS.has(params?.name) && clientSupportsTasks(params) && this.validArgs(params)) {
        return this.startTask(id, params)
      }
      if (method === 'tasks/get' && this.tasks.has(params?.taskId)) return this.getTask(id, params.taskId)
      if (method === 'tasks/cancel' && this.tasks.has(params?.taskId)) return this.cancelTask(id, params.taskId)
      if (method === 'tasks/get' || method === 'tasks/cancel') return this.replyError(id, -32602, `Unknown task ${params?.taskId}`)
      this.pendingMethods.set(id, method)
    }
    this.onmessage?.(msg as any, extra)
  }

  private validArgs(params: Msg) {
    const a = params.arguments ?? {}
    return params.name === 'dispatch' ? typeof a.brief === 'string' && a.brief.trim() !== '' : typeof a.task_id === 'string' && typeof a.message === 'string'
  }

  private async startTask(id: string | number, params: Msg) {
    const a = params.arguments ?? {}
    try {
      const task = params.name === 'dispatch'
        ? await this.helper.call<TaskRecord>('dispatch', {
          brief: a.brief, model: a.model, effort: a.effort, label: a.label, worktree: a.worktree,
          cwd: process.cwd(), sessionId: this.helper.sessionId,
        })
        : await this.helper.call<TaskRecord>('followUp', { taskId: a.task_id, message: a.message, sessionId: this.helper.sessionId })
      this.tasks.set(task.id, task)
      // Keep the record fresh even if this session's notifications are missed.
      if (task.status === 'running') {
        void this.helper.call<TaskRecord>('wait', { taskId: task.id }).then(t => this.tasks.set(t.id, t)).catch(() => {})
      }
      return this.reply(id, { resultType: 'task', ...toMcpTask(task), ttlMs: null, pollIntervalMs: POLL_INTERVAL_MS })
    } catch (err) {
      // A plain tool error, as the SDK would return it.
      return this.reply(id, { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true })
    }
  }

  private async getTask(id: string | number, taskId: string) {
    let t = this.tasks.get(taskId)!
    if (t.status === 'running') {
      // Cheap: the helper answers from memory.
      t = await this.helper.call<TaskRecord>('status', { taskId }).catch(() => t)
      this.tasks.set(taskId, t)
    }
    return this.reply(id, { resultType: 'complete', ...toMcpTask(t), ttlMs: null, pollIntervalMs: POLL_INTERVAL_MS })
  }

  private async cancelTask(id: string | number, taskId: string) {
    const t = await this.helper.call<TaskRecord>('recall', { taskId }).catch(() => this.tasks.get(taskId)!)
    this.tasks.set(taskId, t)
    return this.reply(id, { resultType: 'complete', ...toMcpTask(t), ttlMs: null })
  }
}
