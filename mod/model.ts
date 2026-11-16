// Pure helpers for the display mod: parsing the helper's state files and
// summarising them. No engine calls here, so plain tests can cover it.
// The mod only reads state (ADR 2, ADR 11, ADR 12).

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
  | { t: number; kind: 'brief' | 'follow_up'; text: string; cwd?: string }
  | { t: number; kind: 'message'; text: string; final: boolean }
  | { t: number; kind: 'command'; command: string; exitCode: number | null; output: string | null; title?: string }
  | { t: number; kind: 'edit'; files: { path: string; kind: string; added?: number; removed?: number }[] }
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

// Theme colors for each status.
export const STATUS_COLOR: Record<Status, string> = { running: 'claude', done: 'success', failed: 'error', cancelled: 'inactive' }

// Local wall-clock time, HH:MM:SS.
export function clock(t: number): string {
  const d = new Date(t)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}

export type Turn = { opener: Extract<Entry, { kind: 'brief' | 'follow_up' }> | null; items: Entry[] }

// Splits a transcript into turns: each brief or follow-up starts one.
export function turns(entries: Entry[]): Turn[] {
  const out: Turn[] = []
  for (const e of entries) {
    if (e.kind === 'brief' || e.kind === 'follow_up') out.push({ opener: e, items: [] })
    else {
      if (!out.length) out.push({ opener: null, items: [] })
      out[out.length - 1]!.items.push(e)
    }
  }
  return out
}

// The first lines of a command's output, as Claude Code shows a tool result;
// more when the command failed.
export function outputHead(output: string | null, failed: boolean, keep = failed ? 10 : 3): { text: string; hidden: number } | null {
  const lines = (output ?? '').trimEnd().split('\n')
  if (!lines.join('').trim()) return null
  return { text: lines.slice(0, keep).map(l => clip(l, 200)).join('\n'), hidden: Math.max(0, lines.length - keep) }
}

// The start of a long text: its first lines, and no more than `maxChars`.
// `cut` says whether anything was left out.
export function preview(text: string, maxLines = 6, maxChars = 600): { text: string; cut: boolean } {
  const lines = text.trimEnd().split('\n')
  let shown = lines.slice(0, maxLines).join('\n')
  if (shown.length > maxChars) shown = shown.slice(0, maxChars).trimEnd() + '…'
  return { text: shown, cut: shown !== text.trimEnd() }
}

// Claude Code's tool names for Codex's file change kinds.
export const EDIT_TOOL: Record<string, string> = { add: 'Write', update: 'Update', delete: 'Delete' }

// A path shown relative to the task's folder when it's inside it.
export function relPath(path: string, cwd: string | null): string {
  return cwd && path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
}

type Opener = Extract<Entry, { kind: 'brief' | 'follow_up' }>
type Action = Extract<Entry, { kind: 'command' | 'edit' | 'tool' }>

// The transcript as the desktop app shows its own: prompts, the agent's text,
// and each run of tool calls folded into one group.
export type Block =
  | { kind: 'prompt'; entry: Opener }
  | { kind: 'message'; text: string }
  | { kind: 'group'; key: string; items: Action[] }
  | { kind: 'status'; entry: Extract<Entry, { kind: 'status' }>; startedAt: number | null }

export function blocks(entries: Entry[]): Block[] {
  const out: Block[] = []
  let startedAt: number | null = null
  entries.forEach((e, i) => {
    if (e.kind === 'brief' || e.kind === 'follow_up') {
      startedAt = e.t
      out.push({ kind: 'prompt', entry: e })
    } else if (e.kind === 'message') {
      out.push({ kind: 'message', text: e.text })
    } else if (e.kind === 'status') {
      out.push({ kind: 'status', entry: e, startedAt })
    } else {
      // TypeScript can't narrow the brief/follow-up member out above.
      const action = e as Action
      const last = out[out.length - 1]
      if (last?.kind === 'group') last.items.push(action)
      else out.push({ kind: 'group', key: `${e.t}-${i}`, items: [action] })
    }
  })
  return out
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// One line for a group: "Ran 3 commands, edited 2 files", or "Edited a.ts"
// for a single file, with line counts and failures beside it.
export function summary(items: Action[]): { text: string; added: number; removed: number; failed: number } {
  const commands = items.filter(i => i.kind === 'command')
  const files = items.flatMap(i => (i.kind === 'edit' ? i.files : []))
  const tools = items.filter(i => i.kind === 'tool')
  const failed = commands.filter(c => c.exitCode !== null && c.exitCode !== 0).length + tools.filter(t => t.status === 'failed').length
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0)
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0)
  const paths = [...new Set(files.map(f => f.path))]
  let text: string
  if (!commands.length && !tools.length && paths.length === 1) {
    text = `Edited ${paths[0]!.split('/').pop()}`
  } else {
    const parts = []
    if (commands.length) parts.push(`ran ${plural(commands.length, 'command')}`)
    if (paths.length) parts.push(`edited ${plural(paths.length, 'file')}`)
    if (tools.length) parts.push(`used ${plural(tools.length, 'tool')}`)
    const joined = parts.join(', ')
    text = joined.charAt(0).toUpperCase() + joined.slice(1)
  }
  return { text, added, removed, failed }
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
