// Heinzel's display mod (ADR 11): a side panel listing tasks and their
// transcripts, and a band above the input while tasks run. It only reads the
// helper's state files (ADR 12, ADR 17) and never writes them.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, Selected, Task } from './types'
import { MARK, age, bandCounts, bandText, bandVisible, clip, parseIndex, parseTranscript, signature, sortTasks } from './model'

const PANE = 'heinzel'
const POLL_MS = 1500

const tasksAtom = atom({ plugin: 'heinzel', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const selectedAtom = atom({ plugin: 'heinzel', key: 'selected' } as const, null)
const transcriptAtom = atom({ plugin: 'heinzel', key: 'transcript' } as const, [], { shape: 'transcript-1' })
const bandHiddenAtom = atom({ plugin: 'heinzel', key: 'bandHiddenAt' } as const, 0)
const nowAtom = atom({ plugin: 'heinzel', key: 'now' } as const, 0)

let lastSignature = ''
let lastTranscript = ''

async function home($: EngineInterface): Promise<string> {
  const custom = await $.env.get('HEINZEL_HOME')
  if (custom) return custom
  return `${(await $.env.get('HOME')) ?? ''}/.heinzel`
}

async function refresh($: EngineInterface) {
  const root = await home($)
  let tasks: Task[] = []
  if (await $.fs.exists(root)) {
    for (const entry of await $.fs.list(root)) {
      if (entry.kind !== 'dir' || !entry.name.startsWith('codex-')) continue
      const dir = `${root}/${entry.name}`
      const text = await $.fs.read(`${dir}/tasks.json`).catch(() => null)
      if (typeof text === 'string') tasks.push(...parseIndex(text, dir))
    }
  }
  tasks = sortTasks(tasks)
  const sig = signature(tasks)
  if (sig !== lastSignature) {
    lastSignature = sig
    await update($, tasksAtom, () => tasks)
  }
  await update($, nowAtom, () => Date.now())
  const selected: Selected = await read($, selectedAtom)
  if (selected) {
    const text = await $.fs.read(`${selected.dir}/tasks/${selected.id}.jsonl`).catch(() => '')
    const key = `${selected.id}:${typeof text === 'string' ? text.length : 0}`
    if (key !== lastTranscript) {
      lastTranscript = key
      await update($, transcriptAtom, () => parseTranscript(typeof text === 'string' ? text : ''))
    }
  }
}

async function select($: EngineInterface, task: Task | null) {
  lastTranscript = ''
  await update($, selectedAtom, () => (task ? { id: task.id, dir: task.dir } : null))
  if (!task) await update($, transcriptAtom, () => [])
  await refresh($)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Heinzel' })
}

async function hideBand($: EngineInterface) {
  await update($, bandHiddenAtom, () => Date.now())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'heinzel', description: 'Show Heinzel tasks and their transcripts' })
    await refresh($).catch(() => {})
    $.clock.every(POLL_MS, () => { void refresh($).catch(() => {}) })
    return next(e)
  })

  on('command.run', { command: 'heinzel' }, async $ => {
    await refresh($).catch(() => {})
    await openPane($)
    return { text: 'Heinzel panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e) as any
    const tasks: Task[] = await read($, tasksAtom)
    const selected: Selected = await read($, selectedAtom)
    const now: number = (await read($, nowAtom)) || Date.now()
    const task = selected ? tasks.find(t => t.id === selected.id) : undefined

    if (selected && task) {
      const entries: Entry[] = await read($, transcriptAtom)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="← Tasks" onPress={() => select($, null)} />
          </Box>
          <Text bold>{MARK[task.status]} {task.label}</Text>
          <Text dimColor>
            {task.status} · {task.model ?? 'default model'}{task.effort ? ` · ${task.effort}` : ''} · {task.turns} turn{task.turns === 1 ? '' : 's'} · {task.id}
          </Text>
          {task.branch && <Text dimColor>Worktree {task.worktree} on {task.branch}</Text>}
          {entries.length === 0 && <Text dimColor>No transcript yet.</Text>}
          {entries.map(entry => renderEntry(entry, Box, Text, Markdown))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tasks.length === 0 && <Text dimColor>No Heinzel tasks yet. Ask Claude to dispatch one.</Text>}
        {tasks.map(t => (
          <Box key={t.id} flexDirection="column">
            <Button key={`open-${t.id}`} plain label={`${MARK[t.status]} ${clip(t.label, 60)}`} onPress={() => select($, t)} />
            <Text dimColor wrap="truncate-end">
              {age(now - t.createdAt)} · {t.status}{t.lastLine ? ` · ${clip(t.lastLine, 120)}` : ''}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tasks: Task[] = await read($, tasksAtom)
    const hiddenAt: number = await read($, bandHiddenAtom)
    if (e.props?.hasSurvey || !bandVisible(tasks, hiddenAt)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const counts = bandCounts(tasks, Date.now())
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text>{bandText(counts)}</Text>
        <Button key="heinzel-open" label="Open panel" onPress={() => openPane($)} />
        <Button key="heinzel-close" label="✕" role="dismiss" onPress={() => hideBand($)} />
      </Box>
    )
  })
}

function renderEntry(entry: Entry, Box: any, Text: any, Markdown: any) {
  const time = new Date(entry.t).toISOString().slice(11, 19)
  switch (entry.kind) {
    case 'brief':
    case 'follow_up':
      return (
        <Box flexDirection="column">
          <Text bold>{entry.kind === 'brief' ? 'Brief' : 'Follow-up'} · {time}</Text>
          <Text>{entry.text}</Text>
        </Box>
      )
    case 'message':
      return (
        <Box flexDirection="column">
          <Text bold dimColor={!entry.final}>{entry.final ? 'Final message' : 'Agent'} · {time}</Text>
          <Markdown text={entry.text} />
        </Box>
      )
    case 'command':
      return (
        <Box flexDirection="column">
          <Text mono>$ {entry.command}{entry.exitCode !== null && entry.exitCode !== 0 ? `  (exit ${entry.exitCode})` : ''}</Text>
          {entry.output && <Text mono dimColor>{clip(entry.output.trimEnd(), 800)}</Text>}
        </Box>
      )
    case 'edit':
      return <Text>Edited {entry.files.map(f => f.path.split('/').pop()).join(', ')}</Text>
    case 'tool':
      return <Text dimColor>Tool {entry.name}: {entry.status}</Text>
    case 'status':
      return <Text bold>{MARK[entry.status]} {entry.status}{entry.error ? `: ${entry.error}` : ''}</Text>
  }
}
