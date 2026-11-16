// Task state on disk, read by the mod and by a restarted helper (ADR 12).
// The index is rewritten atomically; transcripts are append-only.

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths } from '../shared/paths.ts'
import { STATE_FORMAT, type TaskRecord, type TasksIndex, type TranscriptEntry } from '../shared/protocol.ts'

export const DEFAULT_RETENTION_DAYS = 7

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* not ours to fix */ }
}

export function writeAtomic(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}

export function readIndex(file: string): TasksIndex | null {
  try {
    const idx = JSON.parse(readFileSync(file, 'utf8')) as TasksIndex
    return idx.format === STATE_FORMAT && Array.isArray(idx.tasks) ? idx : null
  } catch {
    return null
  }
}

export class StateStore {
  readonly paths: Paths
  private tasks = new Map<string, TaskRecord>()
  private timer: NodeJS.Timeout | null = null
  retentionMs: number

  constructor(paths: Paths, retentionDays = DEFAULT_RETENTION_DAYS) {
    this.paths = paths
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000
    ensureDir(paths.home)
    ensureDir(paths.dir)
    ensureDir(paths.tasksDir)
    writeAtomic(paths.accountFile, JSON.stringify({ format: STATE_FORMAT, agent: paths.agent, agentHome: paths.agentHome }, null, 2) + '\n')
  }

  // Loads the index a previous helper left. Tasks it was running can't be
  // reattached to, so they're marked failed.
  load(now = Date.now()): TaskRecord[] {
    const idx = readIndex(this.paths.tasksIndex)
    const orphaned: TaskRecord[] = []
    for (const t of idx?.tasks ?? []) {
      if (t.status === 'running') {
        t.status = 'failed'
        t.error = 'The Heinzel helper stopped while this task was running.'
        t.finishedAt = now
        t.updatedAt = now
        orphaned.push(t)
      }
      this.tasks.set(t.id, t)
    }
    for (const t of orphaned) this.append(t.id, { t: now, kind: 'status', status: 'failed', error: t.error })
    this.flush()
    return orphaned
  }

  get(id: string) {
    return this.tasks.get(id)
  }

  all(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  put(task: TaskRecord, opts: { now?: boolean } = {}) {
    this.tasks.set(task.id, task)
    if (opts.now) this.flush()
    else this.flushSoon()
  }

  transcriptPath(id: string) {
    return join(this.paths.tasksDir, `${id}.jsonl`)
  }

  append(id: string, entry: TranscriptEntry) {
    appendFileSync(this.transcriptPath(id), JSON.stringify(entry) + '\n', { mode: 0o600 })
  }

  readTranscript(id: string): TranscriptEntry[] {
    const file = this.transcriptPath(id)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line) as TranscriptEntry] } catch { return [] }
    })
  }

  // Drops finished tasks older than the retention period. Returns what went.
  prune(now = Date.now()): TaskRecord[] {
    const gone: TaskRecord[] = []
    for (const t of this.tasks.values()) {
      if (t.status !== 'running' && t.finishedAt !== null && now - t.finishedAt > this.retentionMs) gone.push(t)
    }
    for (const t of gone) {
      this.tasks.delete(t.id)
      rmSync(this.transcriptPath(t.id), { force: true })
    }
    if (gone.length) this.flush()
    return gone
  }

  private flushSoon() {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 200)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const idx: TasksIndex = {
      format: STATE_FORMAT,
      account: this.paths.account,
      agent: this.paths.agent,
      helperPid: process.pid,
      updatedAt: Date.now(),
      tasks: this.all(),
    }
    writeAtomic(this.paths.tasksIndex, JSON.stringify(idx, null, 2) + '\n')
  }
}
