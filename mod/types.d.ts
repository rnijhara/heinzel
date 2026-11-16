// The mod's $.state contract (values the drawings read). Self-contained, as
// the engine requires: these mirror the types in model.ts.

export type Status = 'running' | 'done' | 'failed' | 'cancelled'

export type Task = {
  id: string
  label: string
  status: Status
  model: string | null
  effort: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  lastLine: string | null
  turns: number
  worktree: string | null
  branch: string | null
  dir: string
}

export type Entry =
  | { t: number; kind: 'brief' | 'follow_up'; text: string }
  | { t: number; kind: 'message'; text: string; final: boolean }
  | { t: number; kind: 'command'; command: string; exitCode: number | null; output: string | null }
  | { t: number; kind: 'edit'; files: { path: string; kind: string }[] }
  | { t: number; kind: 'tool'; name: string; status: string }
  | { t: number; kind: 'status'; status: Status; error?: string | null }

export type Selected = { id: string; dir: string } | null

declare module 'claude-code' {
  interface PluginState {
    heinzel: {
      tasks: Shaped<Task[]>
      selected: Selected
      transcript: Shaped<Entry[]>
      bandHiddenAt: number
      now: number
    }
  }
}
