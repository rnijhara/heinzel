// How tool results read to Claude. Each result names the task, its status and a
// "Then:" line saying what to do next (ADR 6). Product text.

import type { Roster, TaskRecord, TranscriptEntry, TranscriptResult } from '../shared/protocol.ts'

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function header(t: TaskRecord) {
  const parts = [`agent codex`]
  if (t.model) parts.push(`model ${t.model}`)
  if (t.effort) parts.push(`effort ${t.effort}`)
  parts.push(`${t.turns} turn${t.turns === 1 ? '' : 's'}`)
  const lines = [parts.join(' · ')]
  if (t.worktree) {
    lines.push(t.worktree.removed
      ? `Worktree: removed, since the task left no changes (branch ${t.worktree.branch} deleted).`
      : `Worktree: ${t.worktree.path} on branch ${t.worktree.branch}. Merging and removing it is up to you or the user.`)
  }
  return lines.join('\n')
}

export function formatFinished(t: TaskRecord, note?: string): string {
  const name = `Task "${t.label}" (${t.id})`
  const out: string[] = []
  if (t.status === 'done') {
    out.push(`${name} is done.`, header(t), '', 'Final message from the agent:', t.result ?? '(none)', '')
    out.push(`Then: check the result before you rely on it. To continue this work, call follow_up with task_id "${t.id}". For a fresh review or re-check, dispatch a new task.`)
  } else if (t.status === 'failed') {
    out.push(`${name} failed.`, header(t), '', `Error: ${t.error ?? 'unknown'}`)
    if (t.result) out.push('', 'Last message from the agent:', t.result)
    out.push('', 'Then: tell the user what failed, or fix the cause and dispatch again. Don\'t switch to another agent or model unless the user asks.')
  } else if (t.status === 'cancelled') {
    out.push(`${name} was cancelled.`, header(t))
    if (t.result) out.push('', 'Last message from the agent:', t.result)
    out.push('', 'Then: nothing more will happen on this task unless you call follow_up.')
  } else {
    out.push(formatRunning(t))
  }
  if (note) out.push('', note)
  return out.join('\n')
}

export function formatRunning(t: TaskRecord): string {
  return [
    `Task "${t.label}" (${t.id}) is running (started ${ago(Date.now() - t.createdAt)} ago).`,
    header(t),
    t.lastLine ? `Latest: ${t.lastLine}` : '',
    '',
    'Then: don\'t poll. You\'ll be woken with the result when it finishes. Carry on with other work or end your turn.',
  ].filter((l, i) => l !== '' || i > 0).join('\n')
}

export function formatRoster(r: Roster): string {
  const out: string[] = []
  for (const a of r.agents) {
    out.push(`${a.agent} ${a.version}: default model ${a.defaultModel ?? 'unknown'}, default effort ${a.defaultEffort ?? 'unknown'}.`)
    for (const m of a.models) out.push(`- ${m.id} (${m.name}): efforts ${m.efforts.join(', ')}; default ${m.defaultEffort}`)
  }
  out.push('', 'Then: pass these ids as dispatch\'s model and effort only when the user asked for a specific model or effort. Otherwise leave them out to get the defaults.')
  return out.join('\n')
}

function entryText(e: TranscriptEntry): string {
  const time = new Date(e.t).toISOString().slice(11, 19)
  switch (e.kind) {
    case 'brief': return `[${time}] Brief:\n${e.text}`
    case 'follow_up': return `[${time}] Follow-up:\n${e.text}`
    case 'message': return `[${time}] ${e.final ? 'Agent (final)' : 'Agent'}:\n${e.text}`
    case 'command': return `[${time}] $ ${e.command}  (exit ${e.exitCode ?? '?'})${e.output ? '\n' + e.output.trimEnd() : ''}`
    case 'edit': return `[${time}] Edited: ${e.files.map(f => `${f.path} (${f.kind})`).join(', ')}`
    case 'tool': return `[${time}] Tool ${e.name}: ${e.status}`
    case 'status': return `[${time}] Status: ${e.status}${e.error ? ` (${e.error})` : ''}`
  }
}

const TRANSCRIPT_LIMIT = 60_000

export function formatTranscript(r: TranscriptResult): string {
  const t = r.task
  const parts = r.entries.map(entryText)
  let body = parts.join('\n\n')
  let dropped = r.omitted
  while (body.length > TRANSCRIPT_LIMIT && parts.length > 1) {
    parts.shift()
    dropped++
    body = parts.join('\n\n')
  }
  return [
    `Transcript of "${t.label}" (${t.id}), status ${t.status}.`,
    dropped ? `(${dropped} earlier entries left out; pass a smaller tail to read the end.)` : '',
    '',
    body || '(empty)',
  ].filter((l, i) => l !== '' || i > 1).join('\n')
}
