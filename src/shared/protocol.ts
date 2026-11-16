// The messages between a session's relay (the MCP server) and the shared
// helper, and the task record both sides and the mod share (ADR 4, ADR 12).

export const VERSION = '0.1.0'

// Bumped when the relay <-> helper messages change incompatibly.
export const HELPER_PROTOCOL = 1

// Bumped when tasks.json or the transcript lines change incompatibly.
export const STATE_FORMAT = 1

export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface Worktree {
  // The worktree's root, and the folder the task runs in (the same, or the
  // matching subfolder when the session was in one).
  top: string
  path: string
  branch: string
  base: string
  repo: string
  removed?: boolean
}

export interface TaskRecord {
  id: string
  label: string
  agent: 'codex'
  model: string | null
  effort: string | null
  status: TaskStatus
  sessionId: string | null
  cwd: string
  worktree: Worktree | null
  threadId: string | null
  turnId: string | null
  turns: number
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  lastLine: string | null
  result: string | null
  error: string | null
}

export interface TasksIndex {
  format: number
  account: string
  agent: string
  helperPid: number | null
  updatedAt: number
  tasks: TaskRecord[]
}

// One line of tasks/<id>.jsonl.
export type TranscriptEntry =
  | { t: number; kind: 'brief'; text: string; model: string | null; effort: string | null; cwd: string }
  | { t: number; kind: 'follow_up'; text: string }
  | { t: number; kind: 'message'; text: string; final: boolean }
  | { t: number; kind: 'command'; command: string; exitCode: number | null; output: string | null }
  | { t: number; kind: 'edit'; files: { path: string; kind: string }[] }
  | { t: number; kind: 'tool'; name: string; status: string }
  | { t: number; kind: 'status'; status: TaskStatus; error?: string | null }

export interface RosterModel {
  id: string
  name: string
  efforts: string[]
  defaultEffort: string
}

export interface RosterAgent {
  agent: 'codex'
  version: string
  defaultModel: string | null
  defaultEffort: string | null
  models: RosterModel[]
}

export interface Roster {
  agents: RosterAgent[]
}

export interface HelloParams {
  version: string
  protocol: number
  sessionId: string
  pid: number
}

export interface HelloResult {
  version: string
  protocol: number
  pid: number
  account: string
  running: number
}

export interface DispatchParams {
  brief: string
  model?: string
  effort?: string
  label?: string
  worktree?: boolean
  cwd: string
  sessionId: string
}

export interface FollowUpParams {
  taskId: string
  message: string
  sessionId: string
}

export interface TranscriptResult {
  task: TaskRecord
  entries: TranscriptEntry[]
  omitted: number
}

// Error codes the helper uses for problems Claude should fix itself.
export const HelperErrors = {
  InvalidInput: -32602,
  UnknownTask: -32010,
  TaskBusy: -32011,
  AgentUnavailable: -32012,
} as const
