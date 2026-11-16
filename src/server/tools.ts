// The six tools (ADR-0006). Names, inputs and descriptions are a public
// interface: renaming one needs a new ADR.

import * as z from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { HelperClient } from './helper-client.ts'
import { formatFinished, formatRoster, formatRunning, formatTranscript } from './format.ts'
import type { Roster, TaskRecord, TranscriptResult } from '../shared/protocol.ts'

export const TOOL_DESCRIPTIONS = {
  dispatch: 'Start a task on another coding agent (Codex). The agent sees only `brief`, so it must stand alone. It runs in the background and wakes you with the agent\'s final message: don\'t poll.',
  roster: 'List the agents and models you can dispatch to, with their reasoning efforts and the user\'s defaults. Call it once before your first dispatch in a conversation.',
  status: 'Report a task\'s state. Not for a running task: completion wakes you, so never poll.',
  recall: 'Cancel a running task, for example one that was replaced or is no longer needed.',
  follow_up: 'Send another message to an existing task\'s thread to continue the same piece of work. It runs in the background like dispatch.',
  transcript: 'Read a task\'s thread: the brief, the agent\'s messages, its commands and its edits. Pass tail to read only the last entries.',
} as const

export const dispatchInput = z.object({
  brief: z.string().min(1).describe('The whole task: goal, relevant files and facts, constraints, and what done looks like. The agent sees nothing else.'),
  model: z.string().optional().describe('A model id from roster. Leave it out to use the user\'s default.'),
  effort: z.string().optional().describe('A reasoning effort the model supports, from roster. Leave it out to use the default.'),
  label: z.string().max(80).optional().describe('A short title shown to the user.'),
  worktree: z.boolean().optional().describe('true runs the task in its own git worktree on a new branch. Default false: the session\'s working directory.'),
})

const taskId = z.string().min(1).describe('The task id (task_…) or the task\'s label. While a dispatch is still running in the background, use its label.')

export interface WaitHooks {
  // Waits for a task's turn to end and returns the tool result text.
  wait: (task: TaskRecord, ctx: any) => Promise<string>
}

export function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

export function errorResult(err: unknown) {
  return textResult(`Error: ${(err as Error)?.message ?? String(err)}`, true)
}

export function registerTools(server: McpServer, helper: HelperClient, cwd: () => string, hooks: WaitHooks) {
  server.registerTool('dispatch', {
    description: TOOL_DESCRIPTIONS.dispatch,
    inputSchema: dispatchInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (args, ctx) => {
    try {
      const task = await helper.call<TaskRecord>('dispatch', { ...args, cwd: cwd(), sessionId: helper.sessionId })
      if (task.status !== 'running') return textResult(formatFinished(task), task.status === 'failed')
      return textResult(await hooks.wait(task, ctx))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('roster', {
    description: TOOL_DESCRIPTIONS.roster,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      return textResult(formatRoster(await helper.call<Roster>('roster')))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('status', {
    description: TOOL_DESCRIPTIONS.status,
    inputSchema: z.object({ task_id: taskId }),
    annotations: { readOnlyHint: true },
  }, async ({ task_id }) => {
    try {
      const task = await helper.call<TaskRecord>('status', { taskId: task_id })
      return textResult(task.status === 'running' ? formatRunning(task) : formatFinished(task))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('recall', {
    description: TOOL_DESCRIPTIONS.recall,
    inputSchema: z.object({ task_id: taskId }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async ({ task_id }) => {
    try {
      const before = await helper.call<TaskRecord>('status', { taskId: task_id })
      const task = await helper.call<TaskRecord>('recall', { taskId: task_id })
      if (before.status !== 'running') return textResult(`Task "${task.label}" (${task.id}) wasn't running (status ${task.status}), so there was nothing to cancel.`)
      return textResult(formatFinished(task))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('follow_up', {
    description: TOOL_DESCRIPTIONS.follow_up,
    inputSchema: z.object({
      task_id: taskId,
      message: z.string().min(1).describe('What to do next on the same thread. The agent remembers its earlier turns on this thread.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ task_id, message }, ctx) => {
    try {
      const task = await helper.call<TaskRecord>('followUp', { taskId: task_id, message, sessionId: helper.sessionId })
      if (task.status !== 'running') return textResult(formatFinished(task), task.status === 'failed')
      return textResult(await hooks.wait(task, ctx))
    } catch (err) {
      return errorResult(err)
    }
  })

  server.registerTool('transcript', {
    description: TOOL_DESCRIPTIONS.transcript,
    inputSchema: z.object({
      task_id: taskId,
      tail: z.number().int().positive().optional().describe('Only the last this-many entries.'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ task_id, tail }) => {
    try {
      return textResult(formatTranscript(await helper.call<TranscriptResult>('transcript', { taskId: task_id, tail })))
    } catch (err) {
      return errorResult(err)
    }
  })
}
