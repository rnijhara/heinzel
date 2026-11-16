// Pure helpers for the display mod: parsing the helper's state files and
// summarising them. No engine calls here, so plain tests can cover it.
// The mod only reads state (ADR-0002, ADR-0011, ADR-0012).

export const STATE_FORMAT = 1

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

// Reads one account folder's tasks.json text. Unknown formats are skipped
// rather than misread.
export function parseIndex(text: string, dir: string): Task[] {
  let idx: any
  try {
    idx = JSON.parse(text)
  } catch {
    return []
  }
  if (idx?.format !== STATE_FORMAT || !Array.isArray(idx.tasks)) return []
  return idx.tasks.map((t: any): Task => ({
    id: String(t.id),
    label: String(t.label ?? t.id),
    status: t.status,
    model: t.model ?? null,
    effort: t.effort ?? null,
    createdAt: Number(t.createdAt) || 0,
    updatedAt: Number(t.updatedAt) || 0,
    finishedAt: t.finishedAt ?? null,
    lastLine: t.lastLine ?? null,
    turns: Number(t.turns) || 1,
    worktree: t.worktree && !t.worktree.removed ? t.worktree.path : null,
    branch: t.worktree && !t.worktree.removed ? t.worktree.branch : null,
    dir,
  }))
}

export function parseTranscript(text: string, limit = 200): Entry[] {
  const lines = text.split('\n').filter(Boolean)
  return lines.slice(-limit).flatMap(line => {
    try {
      return [JSON.parse(line) as Entry]
    } catch {
      return []
    }
  })
}

export function sortTasks(tasks: Task[], max = 50): Task[] {
  return [...tasks].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.createdAt - a.createdAt).slice(0, max)
}

// A cheap fingerprint, so polling redraws only when something changed.
export function signature(tasks: Task[]): string {
  return tasks.map(t => `${t.id}:${t.status}:${t.updatedAt}:${t.lastLine ?? ''}`).join('|')
}

export const MARK: Record<Status, string> = { running: '●', done: '✓', failed: '✗', cancelled: '○' }

export const RECENT_MS = 30 * 60 * 1000

// The band's counts: running tasks, and tasks finished in the last half hour.
export function bandCounts(tasks: Task[], now: number) {
  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'done' && t.finishedAt !== null && now - t.finishedAt < RECENT_MS).length
  const failed = tasks.filter(t => (t.status === 'failed') && t.finishedAt !== null && now - t.finishedAt < RECENT_MS).length
  return { running, done, failed }
}

export function bandText(c: { running: number; done: number; failed: number }): string {
  const parts = [`● ${c.running} running`]
  if (c.done) parts.push(`✓ ${c.done} done`)
  if (c.failed) parts.push(`✗ ${c.failed} failed`)
  return `Heinzel ${parts.join(' ')}`
}

// The band shows while a task runs, unless the user closed it; a task that
// starts after it was closed brings it back.
export function bandVisible(tasks: Task[], hiddenAt: number): boolean {
  return tasks.some(t => t.status === 'running' && t.createdAt > hiddenAt)
    || (hiddenAt === 0 && tasks.some(t => t.status === 'running'))
}

export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
