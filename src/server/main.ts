// The per-session relay: an MCP server over stdio that serves Heinzel's tools
// and forwards every call to the shared helper (ADR 2, ADR 4).

import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio'
import { paths as resolvePaths } from '../shared/paths.ts'
import { VERSION, type TaskRecord } from '../shared/protocol.ts'
import { HelperClient } from './helper-client.ts'
import { INSTRUCTIONS } from './instructions.ts'
import { formatFinished } from './format.ts'
import { registerTools } from './tools.ts'
import { TaskAwareTransport } from './tasks-extension.ts'

const HEARTBEAT_MS = 20_000

export const SETTINGS_NOTE = 'Note: Heinzel\'s background settings aren\'t set, so this call may have kept you waiting until the task finished. To let dispatch run in the background, the user can run /heinzel-setup, or add this to ~/.claude/settings.json and restart Claude Code: {"env": {"CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "1000", "CLAUDE_AUTO_BACKGROUND_TASKS": "1"}}'

// Whether Claude Code was started with the settings that move a dispatch to
// the background after about a second (ADR 5). MCP servers inherit Claude
// Code's environment, including the `env` block of settings.json.
export function backgroundSettingsMissing(env: NodeJS.ProcessEnv): boolean {
  const ms = Number(env.CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS)
  return !(ms > 0 && ms <= 5000) || env.CLAUDE_AUTO_BACKGROUND_TASKS !== '1'
}

export function sessionIdFrom(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || `relay-${process.pid}-${randomBytes(3).toString('hex')}`
}

export function createRelay(env: NodeJS.ProcessEnv = process.env) {
  const p = resolvePaths(env)
  const helper = new HelperClient(p, env, sessionIdFrom(env))
  const cwd = () => process.cwd()
  const settingsMissing = backgroundSettingsMissing(env)

  // Blocks until the task's turn ends, sending progress so the call isn't
  // treated as idle, and recalls the task if the call is cancelled.
  const wait = async (task: TaskRecord, ctx: any): Promise<string> => {
    const token = ctx?.mcpReq?._meta?.progressToken
    let progress = 0
    const send = (message: string) => {
      if (token === undefined) return
      void ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: ++progress, message } }).catch(() => {})
    }
    const onProgress = (params: { taskId: string; line: string }) => {
      if (params.taskId === task.id) send(params.line)
    }
    helper.on('task/progress', onProgress)
    const heartbeat = setInterval(() => send('Still working…'), HEARTBEAT_MS)
    const signal: AbortSignal | undefined = ctx?.mcpReq?.signal
    const onAbort = () => { void helper.call('recall', { taskId: task.id }).catch(() => {}) }
    // The call may have been cancelled while the task was starting.
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const done = await helper.call<TaskRecord>('wait', { taskId: task.id })
      return formatFinished(done, settingsMissing ? SETTINGS_NOTE : undefined)
    } catch (err) {
      return `Lost track of task "${task.label}" (${task.id}): ${(err as Error).message}. Call status with task_id "${task.id}" to see where it stands.`
    } finally {
      clearInterval(heartbeat)
      helper.off('task/progress', onProgress)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  // serveStdio may build one instance per protocol era it probes.
  const createServer = () => {
    const server = new McpServer({ name: 'heinzel', title: 'Heinzel', version: VERSION }, { instructions: INSTRUCTIONS })
    registerTools(server, helper, cwd, { wait })
    return server
  }
  return { createServer, helper }
}

export async function main() {
  const { createServer, helper } = createRelay()
  // serveStdio negotiates the protocol era (server/discover for 2026-07-28,
  // initialize for older clients). The tasks extension sits under it, on the wire.
  serveStdio(() => createServer(), {
    transport: new TaskAwareTransport(new StdioServerTransport(), helper),
    onerror: err => process.stderr.write(`heinzel: ${err.message}\n`),
  })
  const exit = () => {
    helper.close()
    process.exit(0)
  }
  process.stdin.on('close', exit)
  process.on('SIGTERM', exit)
}
